// Bitcoin testnet liquidation broadcaster / finalizer.
//
// `liquidate_btc_position` CPIs into Ika and commits a Bitcoin testnet
// sighash on Solana. Once the Ika `MessageApproval` contains a signature,
// the liquidator or a keeper packages it into a raw Bitcoin testnet tx.
// This script broadcasts that raw tx through mempool.space testnet, waits for
// confirmations, polls the remaining `tb1…` balance, and calls
// `finalize_btc_liquidation`.
//
// Usage:
//   BTC_VAULT=<btc_vault_pda> \\
//   BTC_ADDRESS=<tb1q...> \\
//   RAW_TX_HEX=<signed_testnet_tx_hex> \\
//   node contracts/scripts/btc-liquidation-broadcaster.mjs
//
// If the tx is already broadcast, pass BTC_TXID instead of RAW_TX_HEX.

import fs from 'node:fs';
import crypto from 'node:crypto';
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';

const PROGRAM_ID = new PublicKey('GQia1ewyLgtkgX7HSfuttJ42qNPpYJhUbxeyCPXtcJFR');
const RPC = process.env.LENDGUARD_RPC ?? 'https://api.devnet.solana.com';
const KEYPAIR_PATH =
  process.env.LENDGUARD_AUTHORITY_KEYPAIR ??
  '/mnt/d/Projects/LendGuard/contracts/lendguard-devnet.json';
const MEMPOOL_API = process.env.BTC_TESTNET_API ?? 'https://mempool.space/testnet/api';
const MIN_CONFIRMATIONS = Number(process.env.MIN_CONFIRMATIONS ?? '1');

const BTC_VAULT = process.env.BTC_VAULT ? new PublicKey(process.env.BTC_VAULT) : null;
const BTC_ADDRESS = process.env.BTC_ADDRESS;
const RAW_TX_HEX = process.env.RAW_TX_HEX;
let BTC_TXID = process.env.BTC_TXID;

const BTC_ATTESTATION_SEED = Buffer.from('btc_attestation');
const BTC_BORROW_POSITION_SEED = Buffer.from('btc_borrow_position');
const PROTOCOL_STATE_SEED = Buffer.from('protocol_state');

function sighash(name) {
  return crypto.createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
}

function u64ToLe(n) {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n));
  return b;
}

function u32ToLe(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(Number(n));
  return b;
}

function pda(seed, key) {
  return PublicKey.findProgramAddressSync([seed, key.toBuffer()], PROGRAM_ID)[0];
}

function protocolStatePda() {
  return PublicKey.findProgramAddressSync([PROTOCOL_STATE_SEED], PROGRAM_ID)[0];
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function broadcast(rawTxHex) {
  const res = await fetch(`${MEMPOOL_API}/tx`, {
    method: 'POST',
    headers: { 'content-type': 'text/plain' },
    body: rawTxHex,
  });
  const text = await res.text();
  if (!res.ok && !text.toLowerCase().includes('already in block chain')) {
    throw new Error(`broadcast failed ${res.status}: ${text}`);
  }
  return text.trim();
}

async function waitForConfirmations(txid) {
  for (;;) {
    const tx = await fetchJson(`${MEMPOOL_API}/tx/${txid}`);
    const status = tx.status ?? {};
    if (status.confirmed) {
      const tip = Number(await (await fetch(`${MEMPOOL_API}/blocks/tip/height`)).text());
      const blockHeight = Number(status.block_height ?? 0);
      const confs = blockHeight > 0 ? tip - blockHeight + 1 : 0;
      if (confs >= MIN_CONFIRMATIONS) {
        return { blockHeight, confirmations: confs };
      }
      console.log(`[btc-broadcaster] tx ${txid} confirmed with ${confs}, waiting...`);
    } else {
      console.log(`[btc-broadcaster] tx ${txid} in mempool, waiting...`);
    }
    await new Promise((resolve) => setTimeout(resolve, 30_000));
  }
}

async function addressBalance(address) {
  const summary = await fetchJson(`${MEMPOOL_API}/address/${address}`);
  const chain = summary.chain_stats ?? {};
  const mempool = summary.mempool_stats ?? {};
  const funded =
    BigInt(chain.funded_txo_sum ?? 0) + BigInt(mempool.funded_txo_sum ?? 0);
  const spent =
    BigInt(chain.spent_txo_sum ?? 0) + BigInt(mempool.spent_txo_sum ?? 0);
  return funded > spent ? funded - spent : 0n;
}

function buildFinalizeIx({ keeper, btcVault, txid, blockHeight, confirmations, remainingSats }) {
  const txidBytes = Buffer.from(txid, 'hex');
  if (txidBytes.length !== 32) throw new Error('txid must be 32-byte hex');
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: btcVault, isSigner: false, isWritable: true },
      { pubkey: pda(BTC_ATTESTATION_SEED, btcVault), isSigner: false, isWritable: true },
      { pubkey: pda(BTC_BORROW_POSITION_SEED, btcVault), isSigner: false, isWritable: true },
      { pubkey: protocolStatePda(), isSigner: false, isWritable: false },
      { pubkey: keeper, isSigner: true, isWritable: true },
    ],
    data: Buffer.concat([
      sighash('finalize_btc_liquidation'),
      txidBytes,
      u64ToLe(blockHeight),
      u32ToLe(confirmations),
      u64ToLe(remainingSats),
    ]),
  });
}

if (!BTC_VAULT || !BTC_ADDRESS) {
  throw new Error('Set BTC_VAULT and BTC_ADDRESS');
}
if (!BTC_TXID && !RAW_TX_HEX) {
  throw new Error('Set RAW_TX_HEX or BTC_TXID');
}

const secret = Uint8Array.from(JSON.parse(fs.readFileSync(KEYPAIR_PATH, 'utf-8')));
const admin = Keypair.fromSecretKey(secret);
const connection = new Connection(RPC, 'confirmed');

if (!BTC_TXID) {
  console.log('[btc-broadcaster] broadcasting raw tx...');
  BTC_TXID = await broadcast(RAW_TX_HEX);
}
console.log(`[btc-broadcaster] txid=${BTC_TXID}`);

const { blockHeight, confirmations } = await waitForConfirmations(BTC_TXID);
const remainingSats = await addressBalance(BTC_ADDRESS);
console.log(
  `[btc-broadcaster] confirmed=${confirmations} block=${blockHeight} remaining=${remainingSats}`,
);

const ix = buildFinalizeIx({
  keeper: admin.publicKey,
  btcVault: BTC_VAULT,
  txid: BTC_TXID,
  blockHeight,
  confirmations,
  remainingSats,
});
const sig = await sendAndConfirmTransaction(connection, new Transaction().add(ix), [admin], {
  commitment: 'confirmed',
});
console.log(`[btc-broadcaster] finalized on Solana: ${sig}`);
