// Bitcoin testnet balance keeper for LendGuard BTC collateral vaults.
//
// Polls all BtcVaultAccount accounts on Solana devnet, reads each `tb1…`
// address from mempool.space testnet, and posts `attest_btc_balance` with the
// latest satoshi balance. This is intentionally single-admin for hackathon
// speed; production swaps it for a 3-of-5 keeper quorum or SPV proof.
//
// Usage:
//   node contracts/scripts/btc-balance-keeper.mjs --once
//   POLL_MS=30000 node contracts/scripts/btc-balance-keeper.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROGRAM_ID = new PublicKey('GQia1ewyLgtkgX7HSfuttJ42qNPpYJhUbxeyCPXtcJFR');
const RPC = process.env.LENDGUARD_RPC ?? 'https://api.devnet.solana.com';
// Resolve the authority keypair relative to this script so the daemon works
// from PowerShell, WSL, or CI without depending on absolute paths.
const KEYPAIR_PATH =
  process.env.LENDGUARD_AUTHORITY_KEYPAIR ??
  path.resolve(__dirname, '..', 'lendguard-devnet.json');
const MEMPOOL_API = process.env.BTC_TESTNET_API ?? 'https://mempool.space/testnet/api';
const POLL_MS = Number(process.env.POLL_MS ?? '30000');
const ONCE = process.argv.includes('--once');

const BTC_ATTESTATION_SEED = Buffer.from('btc_attestation');
const PROTOCOL_STATE_SEED = Buffer.from('protocol_state');
const BTC_VAULT_LEN = 8 + 32 + 32 + 32 + 33 + 64 + 1 + 8 + 8 + 1 + 8 + 1 + 8 + 32 + 1;

function sighash(name) {
  return crypto.createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
}

function u64ToLe(n) {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n));
  return b;
}

function btcAttestationPda(btcVault) {
  return PublicKey.findProgramAddressSync(
    [BTC_ATTESTATION_SEED, btcVault.toBuffer()],
    PROGRAM_ID,
  )[0];
}

function protocolStatePda() {
  return PublicKey.findProgramAddressSync([PROTOCOL_STATE_SEED], PROGRAM_ID)[0];
}

function parseBtcVault(pubkey, data) {
  if (data.length < BTC_VAULT_LEN) return null;
  const addressOffset = 8 + 32 + 32 + 32 + 33;
  const addressBytes = data.subarray(addressOffset, addressOffset + 64);
  const addressLen = data[addressOffset + 64];
  const address = new TextDecoder().decode(addressBytes.subarray(0, addressLen));
  if (!address.startsWith('tb1')) return null;
  return { pubkey, address };
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} failed: ${res.status} ${await res.text()}`);
  return res.text();
}

async function fetchAddressSnapshot(address) {
  const [summary, tipHeight, tipHash] = await Promise.all([
    fetchJson(`${MEMPOOL_API}/address/${address}`),
    fetchText(`${MEMPOOL_API}/blocks/tip/height`),
    fetchText(`${MEMPOOL_API}/blocks/tip/hash`),
  ]);

  const chain = summary.chain_stats ?? {};
  const mempool = summary.mempool_stats ?? {};
  const funded =
    BigInt(chain.funded_txo_sum ?? 0) + BigInt(mempool.funded_txo_sum ?? 0);
  const spent =
    BigInt(chain.spent_txo_sum ?? 0) + BigInt(mempool.spent_txo_sum ?? 0);
  const satoshis = funded > spent ? funded - spent : 0n;
  const blockHash = Buffer.from(tipHash.trim(), 'hex');
  if (blockHash.length !== 32) {
    throw new Error(`Unexpected Bitcoin testnet block hash length ${blockHash.length}`);
  }

  return {
    satoshis,
    blockHeight: BigInt(tipHeight.trim()),
    blockHash,
  };
}

function buildAttestIx({ keeper, btcVault, satoshis, blockHeight, blockHash }) {
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: btcVault, isSigner: false, isWritable: true },
      { pubkey: btcAttestationPda(btcVault), isSigner: false, isWritable: true },
      { pubkey: protocolStatePda(), isSigner: false, isWritable: false },
      { pubkey: keeper, isSigner: true, isWritable: true },
    ],
    data: Buffer.concat([
      sighash('attest_btc_balance'),
      u64ToLe(satoshis),
      u64ToLe(blockHeight),
      blockHash,
    ]),
  });
}

async function keeperTick(connection, admin) {
  const accounts = await connection.getProgramAccounts(PROGRAM_ID, {
    commitment: 'confirmed',
    filters: [{ dataSize: BTC_VAULT_LEN }],
  });
  const vaults = accounts
    .map((a) => parseBtcVault(a.pubkey, a.account.data))
    .filter(Boolean);

  if (vaults.length === 0) {
    console.log('[btc-keeper] no BTC vaults found');
    return;
  }

  console.log(`[btc-keeper] ${vaults.length} BTC vault(s) found`);
  for (const vault of vaults) {
    try {
      const snap = await fetchAddressSnapshot(vault.address);
      const ix = buildAttestIx({
        keeper: admin.publicKey,
        btcVault: vault.pubkey,
        satoshis: snap.satoshis,
        blockHeight: snap.blockHeight,
        blockHash: snap.blockHash,
      });
      const sig = await sendAndConfirmTransaction(connection, new Transaction().add(ix), [admin], {
        commitment: 'confirmed',
      });
      console.log(
        `[btc-keeper] ${vault.address} = ${snap.satoshis} sats @ ${snap.blockHeight} -> ${sig}`,
      );
    } catch (err) {
      console.error(`[btc-keeper] ${vault.address} failed`, err);
    }
  }
}

const secret = Uint8Array.from(JSON.parse(fs.readFileSync(KEYPAIR_PATH, 'utf-8')));
const admin = Keypair.fromSecretKey(secret);
const connection = new Connection(RPC, 'confirmed');

console.log(`[btc-keeper] admin=${admin.publicKey.toBase58()} rpc=${RPC}`);

// Crash-resilient outer loop. Devnet RPC and mempool.space both return
// transient 502s and connect timeouts; one bad tick must not exit the daemon.
process.on('unhandledRejection', (reason) => {
  console.error('[btc-keeper] unhandledRejection (continuing):', reason);
});

do {
  try {
    await keeperTick(connection, admin);
  } catch (err) {
    console.error('[btc-keeper] tick failed (will retry):', err?.message ?? err);
  }
  if (ONCE) break;
  await new Promise((resolve) => setTimeout(resolve, POLL_MS));
} while (true);
