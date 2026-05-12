/**
 * Anchor-compatible transaction builders for the **Bitcoin collateral** path
 * of the LendGuard protocol — backed by Ika Secp256k1 dWallets.
 *
 * Flow:
 *   1. `buildRegisterBtcVaultIx`           — create BtcVaultAccount + Attestation PDA
 *   2. `buildVerifyBtcCustodyProofIx`      — parse Ika MessageApproval, mark VERIFIED
 *   3. `buildAttestBtcBalanceIx`           — keeper posts confirmed satoshi balance
 *   4. `buildRefreshBtcCustodyProofIx`     — extend proof TTL with a fresh approval
 *   5. `buildBorrowAgainstBtcCollateralIx` — mint LGUSD against attested BTC
 *   6. `buildRepayBtcBorrowIx`             — repay LGUSD debt (pass u64::MAX for "all")
 *   7. `buildLiquidateBtcPositionIx`       — keeper-triggered liquidation w/ Ika CPI
 *   8. `buildFinalizeBtcLiquidationIx`     — finalize after Bitcoin tx confirmation
 *
 * Framework-agnostic: no Anchor runtime needed.
 */

import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";

import {
  deriveAdminPriceFeedPda,
  deriveBtcAttestationPda,
  deriveBtcBorrowPositionPda,
  deriveBtcVaultPda,
  deriveIkaCpiAuthority,
  deriveLendingPoolPda,
  deriveProtocolStatePda,
  IKA_DWALLET_PROGRAM_ID,
  LENDGUARD_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  ASSET_BTC,
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

function vecU8(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + bytes.length);
  new DataView(out.buffer).setUint32(0, bytes.length, true);
  out.set(bytes, 4);
  return out;
}

// ─── 1. register_btc_vault ───────────────────────────────────────────────────

export interface RegisterBtcVaultParams {
  owner: PublicKey;
  /** 32-byte Ika dWallet pubkey (the on-chain dWallet account address). */
  ikaDwallet: PublicKey;
  /** 33-byte compressed Secp256k1 public key of the dWallet. */
  dwalletPubkey: Uint8Array;
  /** Bitcoin testnet bech32 address (tb1q… or tb1p…). */
  bitcoinAddress: string;
  programId?: PublicKey;
}

export async function buildRegisterBtcVaultIx(
  params: RegisterBtcVaultParams,
): Promise<{
  ix: TransactionInstruction;
  btcVaultPda: PublicKey;
  btcAttestationPda: PublicKey;
}> {
  if (params.dwalletPubkey.length !== 33) {
    throw new Error("dwalletPubkey must be 33 bytes (compressed Secp256k1)");
  }
  const programId = params.programId ?? LENDGUARD_PROGRAM_ID;
  const [btcVaultPda] = deriveBtcVaultPda(params.owner, params.ikaDwallet, programId);
  const [btcAttestationPda] = deriveBtcAttestationPda(btcVaultPda, programId);
  const [protocolStatePda] = deriveProtocolStatePda(programId);

  const data = concat(
    await sighash("register_btc_vault"),
    params.ikaDwallet.toBuffer(),
    params.dwalletPubkey,
    vecU8(new TextEncoder().encode(params.bitcoinAddress)),
  );

  const ix = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: btcVaultPda, isSigner: false, isWritable: true },
      { pubkey: btcAttestationPda, isSigner: false, isWritable: true },
      { pubkey: protocolStatePda, isSigner: false, isWritable: true },
      { pubkey: params.owner, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(data),
  });

  return { ix, btcVaultPda, btcAttestationPda };
}

// ─── 2. verify_btc_custody_proof ─────────────────────────────────────────────

export interface VerifyBtcCustodyProofParams {
  owner: PublicKey;
  btcVaultPda: PublicKey;
  /** Ika MessageApproval PDA produced by the dWallet signing ceremony. */
  messageApprovalPda: PublicKey;
  programId?: PublicKey;
}

export async function buildVerifyBtcCustodyProofIx(
  params: VerifyBtcCustodyProofParams,
): Promise<TransactionInstruction> {
  const programId = params.programId ?? LENDGUARD_PROGRAM_ID;
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: params.btcVaultPda, isSigner: false, isWritable: true },
      { pubkey: params.messageApprovalPda, isSigner: false, isWritable: false },
      { pubkey: params.owner, isSigner: true, isWritable: false },
    ],
    data: Buffer.from(await sighash("verify_btc_custody_proof")),
  });
}

// ─── 3. refresh_btc_custody_proof ────────────────────────────────────────────

export interface RefreshBtcCustodyProofParams {
  owner: PublicKey;
  btcVaultPda: PublicKey;
  /** Fresh Ika MessageApproval PDA — used to extend the proof TTL. */
  messageApprovalPda: PublicKey;
  programId?: PublicKey;
}

export async function buildRefreshBtcCustodyProofIx(
  params: RefreshBtcCustodyProofParams,
): Promise<TransactionInstruction> {
  const programId = params.programId ?? LENDGUARD_PROGRAM_ID;
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: params.btcVaultPda, isSigner: false, isWritable: true },
      { pubkey: params.messageApprovalPda, isSigner: false, isWritable: false },
      { pubkey: params.owner, isSigner: true, isWritable: false },
    ],
    data: Buffer.from(await sighash("refresh_btc_custody_proof")),
  });
}

// ─── 4. attest_btc_balance ───────────────────────────────────────────────────

export interface AttestBtcBalanceParams {
  /** Authorized keeper wallet (must match `protocol_state.admin` on devnet). */
  keeper: PublicKey;
  btcVaultPda: PublicKey;
  satoshis: bigint;
  bitcoinBlockHeight: bigint;
  /** 32-byte block hash at which the balance was observed. */
  bitcoinBlockHash: Uint8Array;
  programId?: PublicKey;
}

export async function buildAttestBtcBalanceIx(
  params: AttestBtcBalanceParams,
): Promise<TransactionInstruction> {
  if (params.bitcoinBlockHash.length !== 32) {
    throw new Error("bitcoinBlockHash must be 32 bytes");
  }
  const programId = params.programId ?? LENDGUARD_PROGRAM_ID;
  const [btcAttestationPda] = deriveBtcAttestationPda(params.btcVaultPda, programId);
  const [protocolStatePda] = deriveProtocolStatePda(programId);

  const data = concat(
    await sighash("attest_btc_balance"),
    u64ToLe(params.satoshis),
    u64ToLe(params.bitcoinBlockHeight),
    params.bitcoinBlockHash,
  );

  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: params.btcVaultPda, isSigner: false, isWritable: true },
      { pubkey: btcAttestationPda, isSigner: false, isWritable: true },
      { pubkey: protocolStatePda, isSigner: false, isWritable: false },
      { pubkey: params.keeper, isSigner: true, isWritable: true },
    ],
    data: Buffer.from(data),
  });
}

// ─── 5. borrow_against_btc_collateral ────────────────────────────────────────

export interface BorrowAgainstBtcCollateralParams {
  owner: PublicKey;
  btcVaultPda: PublicKey;
  borrowAssetMint: PublicKey;
  poolTokenVault: PublicKey;
  borrowerTokenAccount: PublicKey;
  amount: bigint;
  /** Optional Encrypt FHE health ciphertext account (defaults to Pubkey::default). */
  healthCiphertext?: PublicKey;
  programId?: PublicKey;
}

export async function buildBorrowAgainstBtcCollateralIx(
  params: BorrowAgainstBtcCollateralParams,
): Promise<{
  ix: TransactionInstruction;
  lendingPoolPda: PublicKey;
  priceFeedPda: PublicKey;
  btcAttestationPda: PublicKey;
  borrowPositionPda: PublicKey;
}> {
  const programId = params.programId ?? LENDGUARD_PROGRAM_ID;
  const [protocolStatePda] = deriveProtocolStatePda(programId);
  const [lendingPoolPda] = deriveLendingPoolPda(params.borrowAssetMint, programId);
  const [priceFeedPda] = deriveAdminPriceFeedPda(ASSET_BTC, programId);
  const [btcAttestationPda] = deriveBtcAttestationPda(params.btcVaultPda, programId);
  const [borrowPositionPda] = deriveBtcBorrowPositionPda(params.btcVaultPda, programId);

  const data = concat(
    await sighash("borrow_against_btc_collateral"),
    u64ToLe(params.amount),
    (params.healthCiphertext ?? PublicKey.default).toBuffer(),
  );

  const ix = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: params.btcVaultPda, isSigner: false, isWritable: true },
      { pubkey: protocolStatePda, isSigner: false, isWritable: false },
      { pubkey: lendingPoolPda, isSigner: false, isWritable: true },
      { pubkey: priceFeedPda, isSigner: false, isWritable: false },
      { pubkey: btcAttestationPda, isSigner: false, isWritable: false },
      { pubkey: borrowPositionPda, isSigner: false, isWritable: true },
      { pubkey: params.poolTokenVault, isSigner: false, isWritable: true },
      { pubkey: params.borrowerTokenAccount, isSigner: false, isWritable: true },
      { pubkey: params.owner, isSigner: true, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(data),
  });

  return { ix, lendingPoolPda, priceFeedPda, btcAttestationPda, borrowPositionPda };
}

// ─── 6. repay_btc_borrow ─────────────────────────────────────────────────────

export interface RepayBtcBorrowParams {
  owner: PublicKey;
  btcVaultPda: PublicKey;
  borrowAssetMint: PublicKey;
  poolTokenVault: PublicKey;
  borrowerTokenAccount: PublicKey;
  /**
   * Repay amount in LGUSD base units. Pass `(1n << 64n) - 1n` (u64::MAX) to
   * repay the entire outstanding debt — the program silently caps and closes
   * the BorrowPosition account on full repayment (rent refunded to owner).
   */
  amount: bigint;
  programId?: PublicKey;
}

export async function buildRepayBtcBorrowIx(
  params: RepayBtcBorrowParams,
): Promise<TransactionInstruction> {
  const programId = params.programId ?? LENDGUARD_PROGRAM_ID;
  const [lendingPoolPda] = deriveLendingPoolPda(params.borrowAssetMint, programId);
  const [borrowPositionPda] = deriveBtcBorrowPositionPda(params.btcVaultPda, programId);

  const data = concat(await sighash("repay_btc_borrow"), u64ToLe(params.amount));

  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: params.btcVaultPda, isSigner: false, isWritable: false },
      { pubkey: lendingPoolPda, isSigner: false, isWritable: true },
      { pubkey: borrowPositionPda, isSigner: false, isWritable: true },
      { pubkey: params.poolTokenVault, isSigner: false, isWritable: true },
      { pubkey: params.borrowerTokenAccount, isSigner: false, isWritable: true },
      { pubkey: params.owner, isSigner: true, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(data),
  });
}

// ─── 7. liquidate_btc_position ───────────────────────────────────────────────

export interface LiquidateBtcPositionParams {
  liquidator: PublicKey;
  btcVaultPda: PublicKey;
  /** Ika dWallet account (matches `BtcVaultAccount.ika_dwallet`). */
  ikaDwallet: PublicKey;
  borrowAssetMint: PublicKey;
  poolTokenVault: PublicKey;
  liquidatorTokenAccount: PublicKey;
  /** Ika dWallet coordinator account. */
  coordinator: PublicKey;
  /** Pre-created Ika MessageApproval PDA the dWallet will sign. */
  messageApproval: PublicKey;
  /** 32-byte BIP143 double-SHA256 sighash for the sweep transaction. */
  bitcoinSighash: Uint8Array;
  /** Optional 32-byte metadata digest — defaults to zero bytes. */
  messageMetadataDigest?: Uint8Array;
  /** 32-byte Ed25519 user pubkey to record in the approval (the owner). */
  userPubkey: Uint8Array;
  /** Bump byte returned by `findProgramAddress` for the MessageApproval PDA. */
  messageApprovalBump: number;
  /** Optional override for the Ika dWallet program ID. */
  ikaDwalletProgramId?: PublicKey;
  programId?: PublicKey;
}

export async function buildLiquidateBtcPositionIx(
  params: LiquidateBtcPositionParams,
): Promise<TransactionInstruction> {
  if (params.bitcoinSighash.length !== 32) {
    throw new Error("bitcoinSighash must be 32 bytes");
  }
  if (params.userPubkey.length !== 32) {
    throw new Error("userPubkey must be 32 bytes");
  }
  const programId = params.programId ?? LENDGUARD_PROGRAM_ID;
  const ikaProgram = params.ikaDwalletProgramId ?? IKA_DWALLET_PROGRAM_ID;
  const [protocolStatePda] = deriveProtocolStatePda(programId);
  const [lendingPoolPda] = deriveLendingPoolPda(params.borrowAssetMint, programId);
  const [priceFeedPda] = deriveAdminPriceFeedPda(ASSET_BTC, programId);
  const [btcAttestationPda] = deriveBtcAttestationPda(params.btcVaultPda, programId);
  const [borrowPositionPda] = deriveBtcBorrowPositionPda(params.btcVaultPda, programId);
  const [cpiAuthority] = deriveIkaCpiAuthority(programId);

  const meta = params.messageMetadataDigest ?? new Uint8Array(32);
  const data = concat(
    await sighash("liquidate_btc_position"),
    params.bitcoinSighash,
    meta.slice(0, 32),
    params.userPubkey.slice(0, 32),
    new Uint8Array([params.messageApprovalBump]),
  );

  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: params.btcVaultPda, isSigner: false, isWritable: true },
      { pubkey: protocolStatePda, isSigner: false, isWritable: false },
      { pubkey: lendingPoolPda, isSigner: false, isWritable: true },
      { pubkey: priceFeedPda, isSigner: false, isWritable: false },
      { pubkey: btcAttestationPda, isSigner: false, isWritable: false },
      { pubkey: borrowPositionPda, isSigner: false, isWritable: true },
      { pubkey: params.poolTokenVault, isSigner: false, isWritable: true },
      { pubkey: params.liquidatorTokenAccount, isSigner: false, isWritable: true },
      { pubkey: programId, isSigner: false, isWritable: false }, // caller_program
      { pubkey: cpiAuthority, isSigner: false, isWritable: false },
      { pubkey: ikaProgram, isSigner: false, isWritable: false },
      { pubkey: params.coordinator, isSigner: false, isWritable: false },
      { pubkey: params.ikaDwallet, isSigner: false, isWritable: false },
      { pubkey: params.messageApproval, isSigner: false, isWritable: true },
      { pubkey: params.liquidator, isSigner: true, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(data),
  });
}

// ─── 8. finalize_btc_liquidation ─────────────────────────────────────────────

export interface FinalizeBtcLiquidationParams {
  keeper: PublicKey;
  btcVaultPda: PublicKey;
  /** 32-byte Bitcoin txid of the broadcast sweep transaction. */
  bitcoinTxId: Uint8Array;
  bitcoinBlockHeight: bigint;
  /** Number of confirmations (typically >= 1 for testnet, >= 6 for mainnet). */
  confirmations: number;
  /** Satoshis remaining in the dWallet address after the sweep. */
  remainingSatoshis: bigint;
  programId?: PublicKey;
}

export async function buildFinalizeBtcLiquidationIx(
  params: FinalizeBtcLiquidationParams,
): Promise<TransactionInstruction> {
  if (params.bitcoinTxId.length !== 32) {
    throw new Error("bitcoinTxId must be 32 bytes");
  }
  const programId = params.programId ?? LENDGUARD_PROGRAM_ID;
  const [btcAttestationPda] = deriveBtcAttestationPda(params.btcVaultPda, programId);
  const [borrowPositionPda] = deriveBtcBorrowPositionPda(params.btcVaultPda, programId);
  const [protocolStatePda] = deriveProtocolStatePda(programId);

  const confBytes = new Uint8Array(4);
  new DataView(confBytes.buffer).setUint32(0, params.confirmations, true);
  const data = concat(
    await sighash("finalize_btc_liquidation"),
    params.bitcoinTxId,
    u64ToLe(params.bitcoinBlockHeight),
    confBytes,
    u64ToLe(params.remainingSatoshis),
  );

  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: params.btcVaultPda, isSigner: false, isWritable: true },
      { pubkey: btcAttestationPda, isSigner: false, isWritable: true },
      { pubkey: borrowPositionPda, isSigner: false, isWritable: true },
      { pubkey: protocolStatePda, isSigner: false, isWritable: false },
      { pubkey: params.keeper, isSigner: true, isWritable: true },
    ],
    data: Buffer.from(data),
  });
}
