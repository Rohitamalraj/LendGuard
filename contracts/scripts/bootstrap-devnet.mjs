// Bootstrap a freshly deployed (or upgraded) LendGuard program on devnet.
//
// Flow (idempotent — every step skips if already done):
//   1. Close any stale `admin_price_feed` PDA (BTC) so we can re-init it
//      under the new pool layout.
//   2. Initialize `protocol_state` PDA if missing.
//   3. Create the LGUSD SPL mint (admin = current keypair, decimals = 6).
//   4. Create an associated token account owned by the future `lending_pool`
//      PDA, then mint initial supply into it (still using admin as mint
//      authority).
//   5. Transfer LGUSD mint authority from admin → `lending_pool` PDA so the
//      program can mint/burn via CPI in future phases.
//   6. Call `initialize_lending_pool` with the real mint + token vault.
//
// Output is a JSON summary printed to stdout. The mint pubkey is also
// persisted to `contracts/lgusd-mint.json` so subsequent runs reuse it.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  createMint,
  getMint,
  getOrCreateAssociatedTokenAccount,
  getAssociatedTokenAddress,
  mintTo,
  setAuthority,
  AuthorityType,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAccount,
} from '@solana/spl-token';

const PROGRAM_ID = new PublicKey('GQia1ewyLgtkgX7HSfuttJ42qNPpYJhUbxeyCPXtcJFR');
const RPC = process.env.LENDGUARD_RPC ?? 'https://api.devnet.solana.com';
const KEYPAIR_PATH =
  process.env.LENDGUARD_AUTHORITY_KEYPAIR ??
  '/mnt/d/Projects/LendGuard/contracts/lendguard-devnet.json';
const MINT_RECORD_PATH = '/mnt/d/Projects/LendGuard/contracts/lgusd-mint.json';

const ASSET_BTC = 0;
const ASSET_ETH = 1;
const ASSET_SOL = 2;
const LGUSD_DECIMALS = 6;
const INITIAL_LIQUIDITY = 1_000_000_000n; // 1,000 LGUSD (6 decimals)
const INITIAL_BTC_PRICE = 90_000_00000000n; // $90,000 (8 decimals)
const INITIAL_ETH_PRICE = 3_500_00000000n; //   $3,500 (8 decimals)
const INITIAL_SOL_PRICE = 150_00000000n; //     $150   (8 decimals)
const LTV_BPS = 6500;
const LIQUIDATION_THRESHOLD_BPS = 7500;
const LIQUIDATION_BONUS_BPS = 500;
const BASE_RATE_BPS = 200; // 2% APR at 0% utilization
const RATE_SLOPE_BPS = 1500; // up to +15% APR at 80% utilization (Phase 3 wires this in)

const PROTOCOL_STATE_SEED = Buffer.from('protocol_state');
const LENDING_POOL_SEED = Buffer.from('lending_pool');
const ADMIN_PRICE_FEED_SEED = Buffer.from('admin_price');

function sighash(name) {
  return crypto.createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
}
function u64ToLe(n) {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n));
  return b;
}
function u16ToLe(n) {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n);
  return b;
}

const secret = Uint8Array.from(JSON.parse(fs.readFileSync(KEYPAIR_PATH, 'utf-8')));
const admin = Keypair.fromSecretKey(secret);
const connection = new Connection(RPC, 'confirmed');

async function exists(pubkey) {
  return (await connection.getAccountInfo(pubkey)) !== null;
}

const [protocolStatePda] = PublicKey.findProgramAddressSync([PROTOCOL_STATE_SEED], PROGRAM_ID);
const [legacyPriceFeedPda] = PublicKey.findProgramAddressSync(
  [ADMIN_PRICE_FEED_SEED, Buffer.from([ASSET_BTC])],
  PROGRAM_ID,
);

// Step 1 used to close a legacy admin_price_feed during Phase 1 migration.
// That migration is now complete and re-running the close on every bootstrap
// would destroy the live BTC price feed. The function is intentionally kept
// (and unused) so the migration history is auditable.

// ─── Step 2: initialize_protocol if missing ──────────────────────────────────

async function initializeProtocol() {
  if (await exists(protocolStatePda)) {
    console.log('protocol_state already exists, skipping');
    return null;
  }
  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: protocolStatePda, isSigner: false, isWritable: true },
      { pubkey: admin.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(sighash('initialize_protocol')),
  });
  const sig = await sendAndConfirmTransaction(connection, new Transaction().add(ix), [admin], {
    commitment: 'confirmed',
  });
  console.log(`initialize_protocol tx: ${sig}`);
  return sig;
}

// ─── Step 3: create or reuse LGUSD mint ──────────────────────────────────────

async function getOrCreateLgUsdMint() {
  let mintRecord = null;
  if (fs.existsSync(MINT_RECORD_PATH)) {
    mintRecord = JSON.parse(fs.readFileSync(MINT_RECORD_PATH, 'utf-8'));
  }
  if (mintRecord?.mint) {
    const mintPubkey = new PublicKey(mintRecord.mint);
    if (await exists(mintPubkey)) {
      console.log(`reusing existing LGUSD mint: ${mintPubkey.toBase58()}`);
      return mintPubkey;
    }
  }
  console.log('creating new LGUSD mint…');
  const mintPubkey = await createMint(
    connection,
    admin,
    admin.publicKey, // initial mint authority
    null, // freeze authority — none
    LGUSD_DECIMALS,
    undefined,
    { commitment: 'confirmed' },
    TOKEN_PROGRAM_ID,
  );
  fs.writeFileSync(
    MINT_RECORD_PATH,
    JSON.stringify({ mint: mintPubkey.toBase58(), decimals: LGUSD_DECIMALS }, null, 2),
  );
  fs.chmodSync(MINT_RECORD_PATH, 0o600);
  console.log(`LGUSD mint: ${mintPubkey.toBase58()}`);
  return mintPubkey;
}

// ─── Step 4 + 5: ensure pool_token_vault has supply, transfer mint authority ─

async function ensurePoolTokenVault(mintPubkey, lendingPoolPda) {
  // ATA owned by the lending_pool PDA. allowOwnerOffCurve=true because PDAs
  // are off-curve points.
  const poolAtaAddress = await getAssociatedTokenAddress(
    mintPubkey,
    lendingPoolPda,
    true, // allowOwnerOffCurve
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );

  let needsCreate = !(await exists(poolAtaAddress));
  if (needsCreate) {
    console.log('creating pool token vault (ATA owned by lending_pool PDA)…');
    const ata = await getOrCreateAssociatedTokenAccount(
      connection,
      admin,
      mintPubkey,
      lendingPoolPda,
      true,
      'confirmed',
      undefined,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );
    console.log(`pool token vault: ${ata.address.toBase58()}`);
  }

  const acct = await getAccount(connection, poolAtaAddress, 'confirmed');
  if (acct.amount < INITIAL_LIQUIDITY) {
    const mintInfo = await getMint(connection, mintPubkey);
    if (mintInfo.mintAuthority?.toBase58() !== admin.publicKey.toBase58()) {
      throw new Error(
        `Mint authority is ${mintInfo.mintAuthority?.toBase58()} but expected ${admin.publicKey.toBase58()} — cannot mint initial liquidity. Did mint authority transfer happen too early?`,
      );
    }
    const toMint = INITIAL_LIQUIDITY - acct.amount;
    console.log(`minting ${toMint} base units of LGUSD into pool vault…`);
    await mintTo(
      connection,
      admin,
      mintPubkey,
      poolAtaAddress,
      admin,
      toMint,
      [],
      { commitment: 'confirmed' },
      TOKEN_PROGRAM_ID,
    );
  } else {
    console.log(`pool token vault already has ${acct.amount} base units, skipping mint`);
  }

  // Transfer mint authority → lending_pool PDA (idempotent: if already set,
  // setAuthority will fail; we catch).
  const mintInfo = await getMint(connection, mintPubkey);
  if (mintInfo.mintAuthority?.toBase58() !== lendingPoolPda.toBase58()) {
    console.log('transferring LGUSD mint authority → lending_pool PDA…');
    await setAuthority(
      connection,
      admin,
      mintPubkey,
      admin,
      AuthorityType.MintTokens,
      lendingPoolPda,
      [],
      { commitment: 'confirmed' },
      TOKEN_PROGRAM_ID,
    );
  } else {
    console.log('LGUSD mint authority already == lending_pool PDA');
  }

  return poolAtaAddress;
}

// ─── Step 6: initialize_lending_pool ────────────────────────────────────────

async function initializeLendingPool(mintPubkey, poolAtaAddress, lendingPoolPda, priceFeedPda) {
  if (await exists(lendingPoolPda)) {
    console.log(`lending_pool ${lendingPoolPda.toBase58()} already exists, skipping`);
    return null;
  }

  const data = Buffer.concat([
    Buffer.from(sighash('initialize_lending_pool')),
    Buffer.from([ASSET_BTC & 0xff]),
    u64ToLe(INITIAL_LIQUIDITY),
    u64ToLe(INITIAL_BTC_PRICE),
    u16ToLe(LTV_BPS),
    u16ToLe(LIQUIDATION_THRESHOLD_BPS),
    u16ToLe(LIQUIDATION_BONUS_BPS),
    u16ToLe(BASE_RATE_BPS),
    u16ToLe(RATE_SLOPE_BPS),
  ]);

  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: lendingPoolPda, isSigner: false, isWritable: true },
      { pubkey: priceFeedPda, isSigner: false, isWritable: true },
      { pubkey: mintPubkey, isSigner: false, isWritable: false },
      { pubkey: poolAtaAddress, isSigner: false, isWritable: true },
      { pubkey: admin.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data,
  });

  const sig = await sendAndConfirmTransaction(connection, new Transaction().add(ix), [admin], {
    commitment: 'confirmed',
  });
  console.log(`initialize_lending_pool tx: ${sig}`);
  return sig;
}

async function initializeAdminPriceFeed(assetType, initialPrice) {
  const [feedPda] = PublicKey.findProgramAddressSync(
    [ADMIN_PRICE_FEED_SEED, Buffer.from([assetType])],
    PROGRAM_ID,
  );
  if (await exists(feedPda)) {
    console.log(`price feed asset_type=${assetType} already exists, skipping`);
    return null;
  }
  const data = Buffer.concat([
    Buffer.from(sighash('initialize_admin_price_feed')),
    Buffer.from([assetType & 0xff]),
    u64ToLe(initialPrice),
  ]);
  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: feedPda, isSigner: false, isWritable: true },
      { pubkey: admin.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
  const sig = await sendAndConfirmTransaction(connection, new Transaction().add(ix), [admin], {
    commitment: 'confirmed',
  });
  console.log(`initialize_admin_price_feed asset_type=${assetType} tx: ${sig}`);
  return sig;
}

async function main() {
  console.log(`admin: ${admin.publicKey.toBase58()}`);
  console.log(`program: ${PROGRAM_ID.toBase58()}`);

  await initializeProtocol();

  const mint = await getOrCreateLgUsdMint();
  const [lendingPoolPda, lendingPoolBump] = PublicKey.findProgramAddressSync(
    [LENDING_POOL_SEED, mint.toBuffer()],
    PROGRAM_ID,
  );
  const [priceFeedPda] = PublicKey.findProgramAddressSync(
    [ADMIN_PRICE_FEED_SEED, Buffer.from([ASSET_BTC])],
    PROGRAM_ID,
  );

  const poolAta = await ensurePoolTokenVault(mint, lendingPoolPda);
  await initializeLendingPool(mint, poolAta, lendingPoolPda, priceFeedPda);

  // Heal idempotently if the BTC price feed got closed by a previous
  // migration step but the lending_pool already exists (so initialize_pool
  // would skip and not recreate it).
  await initializeAdminPriceFeed(ASSET_BTC, INITIAL_BTC_PRICE);

  // Multi-asset bootstrap: ETH + SOL price feeds (for borrowing against ETH
  // or SOL collateral vaults respectively).
  await initializeAdminPriceFeed(ASSET_ETH, INITIAL_ETH_PRICE);
  await initializeAdminPriceFeed(ASSET_SOL, INITIAL_SOL_PRICE);

  const [ethFeedPda] = PublicKey.findProgramAddressSync(
    [ADMIN_PRICE_FEED_SEED, Buffer.from([ASSET_ETH])],
    PROGRAM_ID,
  );
  const [solFeedPda] = PublicKey.findProgramAddressSync(
    [ADMIN_PRICE_FEED_SEED, Buffer.from([ASSET_SOL])],
    PROGRAM_ID,
  );

  console.log('\n--- bootstrap summary ---');
  console.log(JSON.stringify({
    programId: PROGRAM_ID.toBase58(),
    admin: admin.publicKey.toBase58(),
    protocolStatePda: protocolStatePda.toBase58(),
    lgusdMint: mint.toBase58(),
    lendingPoolPda: lendingPoolPda.toBase58(),
    lendingPoolBump,
    btcPriceFeedPda: priceFeedPda.toBase58(),
    ethPriceFeedPda: ethFeedPda.toBase58(),
    solPriceFeedPda: solFeedPda.toBase58(),
    poolTokenVault: poolAta.toBase58(),
  }, null, 2));
}

main().catch((e) => {
  console.error('bootstrap failed:', e);
  process.exit(1);
});
