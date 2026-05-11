/**
 * Anchor-compatible transaction builders for the LendGuard lending protocol.
 *
 * These are framework-agnostic — no Anchor runtime needed. They produce raw
 * `TransactionInstruction`s that you can assemble into a `Transaction` and
 * sign with any wallet that exposes a `signTransaction` method.
 */

import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";

import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  deriveAdminPriceFeedPda,
  deriveAssociatedTokenAddress,
  deriveBorrowPositionPda,
  deriveLendingPoolPda,
  deriveProtocolStatePda,
  LENDGUARD_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "./constants.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function sighash(name: string): Promise<Uint8Array> {
  const data = new TextEncoder().encode(`global:${name}`);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return new Uint8Array(hash).slice(0, 8);
}

function concat(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((acc, a) => acc + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.length;
  }
  return out;
}

function u64ToLe(value: bigint): Uint8Array {
  const buf = new Uint8Array(8);
  new DataView(buf.buffer).setBigUint64(0, value, true);
  return buf;
}

function u16ToLe(value: number): Uint8Array {
  const buf = new Uint8Array(2);
  new DataView(buf.buffer).setUint16(0, value, true);
  return buf;
}

// ─── Borrower / liquidator side ──────────────────────────────────────────────

/**
 * ATA program "createIdempotent" instruction. Use to ensure a borrower or
 * liquidator has an LGUSD token account before transfers.
 */
export function buildCreateAssociatedTokenAccountIx(params: {
  payer: PublicKey;
  owner: PublicKey;
  mint: PublicKey;
}): { ix: TransactionInstruction; ataAddress: PublicKey } {
  const ataAddress = deriveAssociatedTokenAddress(params.owner, params.mint, true);
  const ix = new TransactionInstruction({
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: params.payer, isSigner: true, isWritable: true },
      { pubkey: ataAddress, isSigner: false, isWritable: true },
      { pubkey: params.owner, isSigner: false, isWritable: false },
      { pubkey: params.mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([1]),
  });
  return { ix, ataAddress };
}

export interface BorrowAgainstCollateralParams {
  owner: PublicKey;
  vaultPda: PublicKey;
  assetType: number;
  borrowAssetMint: PublicKey;
  poolTokenVault: PublicKey;
  borrowerTokenAccount: PublicKey;
  amount: bigint;
  healthCiphertext?: PublicKey;
  programId?: PublicKey;
}

export async function buildBorrowAgainstCollateralIx(
  params: BorrowAgainstCollateralParams,
): Promise<{
  ix: TransactionInstruction;
  lendingPoolPda: PublicKey;
  priceFeedPda: PublicKey;
  borrowPositionPda: PublicKey;
}> {
  const programId = params.programId ?? LENDGUARD_PROGRAM_ID;
  const [protocolStatePda] = deriveProtocolStatePda(programId);
  const [lendingPoolPda] = deriveLendingPoolPda(params.borrowAssetMint, programId);
  const [priceFeedPda] = deriveAdminPriceFeedPda(params.assetType, programId);
  const [borrowPositionPda] = deriveBorrowPositionPda(params.vaultPda, programId);

  const data = concat(
    await sighash("borrow_against_collateral"),
    u64ToLe(params.amount),
    (params.healthCiphertext ?? PublicKey.default).toBuffer(),
  );

  const ix = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: params.vaultPda, isSigner: false, isWritable: true },
      { pubkey: protocolStatePda, isSigner: false, isWritable: false },
      { pubkey: lendingPoolPda, isSigner: false, isWritable: true },
      { pubkey: priceFeedPda, isSigner: false, isWritable: false },
      { pubkey: borrowPositionPda, isSigner: false, isWritable: true },
      { pubkey: params.poolTokenVault, isSigner: false, isWritable: true },
      { pubkey: params.borrowerTokenAccount, isSigner: false, isWritable: true },
      { pubkey: params.owner, isSigner: true, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(data),
  });

  return { ix, lendingPoolPda, priceFeedPda, borrowPositionPda };
}

export interface RepayBorrowParams {
  owner: PublicKey;
  vaultPda: PublicKey;
  borrowAssetMint: PublicKey;
  poolTokenVault: PublicKey;
  borrowerTokenAccount: PublicKey;
  amount: bigint;
  programId?: PublicKey;
}

export async function buildRepayBorrowIx(params: RepayBorrowParams): Promise<{
  ix: TransactionInstruction;
  lendingPoolPda: PublicKey;
  borrowPositionPda: PublicKey;
}> {
  const programId = params.programId ?? LENDGUARD_PROGRAM_ID;
  const [lendingPoolPda] = deriveLendingPoolPda(params.borrowAssetMint, programId);
  const [borrowPositionPda] = deriveBorrowPositionPda(params.vaultPda, programId);

  const data = concat(await sighash("repay_borrow"), u64ToLe(params.amount));

  const ix = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: params.vaultPda, isSigner: false, isWritable: false },
      { pubkey: lendingPoolPda, isSigner: false, isWritable: true },
      { pubkey: borrowPositionPda, isSigner: false, isWritable: true },
      { pubkey: params.poolTokenVault, isSigner: false, isWritable: true },
      { pubkey: params.borrowerTokenAccount, isSigner: false, isWritable: true },
      { pubkey: params.owner, isSigner: true, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(data),
  });

  return { ix, lendingPoolPda, borrowPositionPda };
}

export interface LiquidatePositionParams {
  liquidator: PublicKey;
  vaultPda: PublicKey;
  assetType: number;
  borrowAssetMint: PublicKey;
  poolTokenVault: PublicKey;
  liquidatorTokenAccount: PublicKey;
  programId?: PublicKey;
}

export async function buildLiquidatePositionIx(
  params: LiquidatePositionParams,
): Promise<{
  ix: TransactionInstruction;
  lendingPoolPda: PublicKey;
  priceFeedPda: PublicKey;
  borrowPositionPda: PublicKey;
}> {
  const programId = params.programId ?? LENDGUARD_PROGRAM_ID;
  const [protocolStatePda] = deriveProtocolStatePda(programId);
  const [lendingPoolPda] = deriveLendingPoolPda(params.borrowAssetMint, programId);
  const [priceFeedPda] = deriveAdminPriceFeedPda(params.assetType, programId);
  const [borrowPositionPda] = deriveBorrowPositionPda(params.vaultPda, programId);

  const data = await sighash("liquidate_position");

  const ix = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: params.vaultPda, isSigner: false, isWritable: true },
      { pubkey: protocolStatePda, isSigner: false, isWritable: false },
      { pubkey: lendingPoolPda, isSigner: false, isWritable: true },
      { pubkey: priceFeedPda, isSigner: false, isWritable: false },
      { pubkey: borrowPositionPda, isSigner: false, isWritable: true },
      { pubkey: params.poolTokenVault, isSigner: false, isWritable: true },
      { pubkey: params.liquidatorTokenAccount, isSigner: false, isWritable: true },
      { pubkey: params.liquidator, isSigner: true, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(data),
  });

  return { ix, lendingPoolPda, priceFeedPda, borrowPositionPda };
}

// ─── Admin side ──────────────────────────────────────────────────────────────

export interface UpdateAdminPriceParams {
  admin: PublicKey;
  assetType: number;
  newPriceUsd: bigint;
  programId?: PublicKey;
}

export async function buildUpdateAdminPriceIx(
  params: UpdateAdminPriceParams,
): Promise<{ ix: TransactionInstruction; priceFeedPda: PublicKey }> {
  const programId = params.programId ?? LENDGUARD_PROGRAM_ID;
  const [priceFeedPda] = deriveAdminPriceFeedPda(params.assetType, programId);
  const data = concat(await sighash("update_admin_price"), u64ToLe(params.newPriceUsd));

  const ix = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: priceFeedPda, isSigner: false, isWritable: true },
      { pubkey: params.admin, isSigner: true, isWritable: false },
    ],
    data: Buffer.from(data),
  });

  return { ix, priceFeedPda };
}

export interface InitializeLendingPoolParams {
  admin: PublicKey;
  borrowAssetMint: PublicKey;
  poolTokenVault: PublicKey;
  assetType: number;
  initialLiquidity: bigint;
  initialPriceUsd: bigint;
  ltvBasisPoints: number;
  liquidationThresholdBps: number;
  liquidationBonusBps: number;
  baseRateBps: number;
  rateSlopeBps: number;
  programId?: PublicKey;
}

export async function buildInitializeLendingPoolIx(
  params: InitializeLendingPoolParams,
): Promise<{
  ix: TransactionInstruction;
  lendingPoolPda: PublicKey;
  priceFeedPda: PublicKey;
}> {
  const programId = params.programId ?? LENDGUARD_PROGRAM_ID;
  const [lendingPoolPda] = deriveLendingPoolPda(params.borrowAssetMint, programId);
  const [priceFeedPda] = deriveAdminPriceFeedPda(params.assetType, programId);

  const data = concat(
    await sighash("initialize_lending_pool"),
    new Uint8Array([params.assetType & 0xff]),
    u64ToLe(params.initialLiquidity),
    u64ToLe(params.initialPriceUsd),
    u16ToLe(params.ltvBasisPoints),
    u16ToLe(params.liquidationThresholdBps),
    u16ToLe(params.liquidationBonusBps),
    u16ToLe(params.baseRateBps),
    u16ToLe(params.rateSlopeBps),
  );

  const ix = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: lendingPoolPda, isSigner: false, isWritable: true },
      { pubkey: priceFeedPda, isSigner: false, isWritable: true },
      { pubkey: params.borrowAssetMint, isSigner: false, isWritable: false },
      { pubkey: params.poolTokenVault, isSigner: false, isWritable: true },
      { pubkey: params.admin, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(data),
  });

  return { ix, lendingPoolPda, priceFeedPda };
}

export interface InitializeAdminPriceFeedParams {
  admin: PublicKey;
  assetType: number;
  initialPriceUsd: bigint;
  programId?: PublicKey;
}

export async function buildInitializeAdminPriceFeedIx(
  params: InitializeAdminPriceFeedParams,
): Promise<{ ix: TransactionInstruction; priceFeedPda: PublicKey }> {
  const programId = params.programId ?? LENDGUARD_PROGRAM_ID;
  const [priceFeedPda] = deriveAdminPriceFeedPda(params.assetType, programId);
  const data = concat(
    await sighash("initialize_admin_price_feed"),
    new Uint8Array([params.assetType & 0xff]),
    u64ToLe(params.initialPriceUsd),
  );
  const ix = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: priceFeedPda, isSigner: false, isWritable: true },
      { pubkey: params.admin, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(data),
  });
  return { ix, priceFeedPda };
}
