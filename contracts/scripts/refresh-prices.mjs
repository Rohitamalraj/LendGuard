// Refresh BTC / ETH / SOL admin price feeds in a single tx.
//
// The contract rejects any borrow whose price feed is older than
// PRICE_STALENESS_SECONDS (= 1 hour). Run this script before a demo, or
// schedule it on a cron (every 15–30 min) to keep feeds fresh.
//
// Usage:
//   node contracts/scripts/refresh-prices.mjs                 # one-shot
//   POLL_MS=600000 node scripts/refresh-prices.mjs            # daemon (every 10 min)
//   BTC_USD=92000 ETH_USD=3600 SOL_USD=160 node refresh-prices.mjs
//
// Requires the same admin keypair the program was deployed with.

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

const ASSET_BTC = 0;
const ASSET_ETH = 1;
const ASSET_SOL = 2;

// Prices are stored on-chain with 8 decimals (so $1.00 → 100_000_000).
const PRICE_SCALE = 100_000_000n;
const BTC_USD = BigInt(Math.round(Number(process.env.BTC_USD ?? '90000')));
const ETH_USD = BigInt(Math.round(Number(process.env.ETH_USD ?? '3500')));
const SOL_USD = BigInt(Math.round(Number(process.env.SOL_USD ?? '150')));

const ADMIN_PRICE_FEED_SEED = Buffer.from('admin_price');

function sighash(name) {
  return crypto.createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
}
function u64ToLe(n) {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n));
  return b;
}

const secret = Uint8Array.from(JSON.parse(fs.readFileSync(KEYPAIR_PATH, 'utf-8')));
const admin = Keypair.fromSecretKey(secret);
const connection = new Connection(RPC, 'confirmed');

function priceFeedPda(assetType) {
  return PublicKey.findProgramAddressSync(
    [ADMIN_PRICE_FEED_SEED, Buffer.from([assetType])],
    PROGRAM_ID,
  )[0];
}

function buildUpdatePriceIx(assetType, priceScaled) {
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: priceFeedPda(assetType), isSigner: false, isWritable: true },
      { pubkey: admin.publicKey, isSigner: true, isWritable: false },
    ],
    data: Buffer.concat([sighash('update_admin_price'), u64ToLe(priceScaled)]),
  });
}

const updates = [
  { name: 'BTC', assetType: ASSET_BTC, priceUsd: BTC_USD, scaled: BTC_USD * PRICE_SCALE },
  { name: 'ETH', assetType: ASSET_ETH, priceUsd: ETH_USD, scaled: ETH_USD * PRICE_SCALE },
  { name: 'SOL', assetType: ASSET_SOL, priceUsd: SOL_USD, scaled: SOL_USD * PRICE_SCALE },
];

const missing = [];
for (const u of updates) {
  const info = await connection.getAccountInfo(priceFeedPda(u.assetType));
  if (!info) missing.push(u.name);
}
if (missing.length) {
  console.error(
    `error: ${missing.join(', ')} price feed PDA(s) do not exist. Run bootstrap-devnet.mjs first.`,
  );
  process.exit(1);
}

console.log(`admin: ${admin.publicKey.toBase58()}`);

async function refreshOnce() {
  const tx = new Transaction();
  for (const u of updates) {
    tx.add(buildUpdatePriceIx(u.assetType, u.scaled));
  }
  console.log(
    `[refresh-prices] ${new Date().toISOString()} BTC=$${BTC_USD} ETH=$${ETH_USD} SOL=$${SOL_USD}`,
  );
  try {
    const sig = await sendAndConfirmTransaction(connection, tx, [admin], {
      commitment: 'confirmed',
    });
    console.log(`[refresh-prices] ok tx=${sig}`);
  } catch (err) {
    console.error('[refresh-prices] failed:', err.message ?? err);
  }
}

const POLL_MS = Number(process.env.POLL_MS ?? '0');
const ONCE = process.argv.includes('--once') || POLL_MS === 0;

await refreshOnce();
if (!ONCE) {
  console.log(`[refresh-prices] daemon mode — polling every ${POLL_MS}ms`);
  while (true) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    await refreshOnce();
  }
}
