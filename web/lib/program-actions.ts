/**
 * Raw Anchor-compatible transaction builders for the LendGuard program.
 *
 * We build instructions manually (without the IDL) by computing Anchor's
 * sighash discriminator: first 8 bytes of sha256("global:<method_snake_case>").
 *
 * This lets us interact with the deployed program from the browser without
 * shipping the IDL or pulling Anchor as a runtime dep.
 */

import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";

import {
  PROGRAM_ID,
  deriveProtocolStatePda,
  deriveRiskStatePda,
  deriveVaultPda,
  dwalletIdToBytes,
} from "./lendguard-client";

export {
  deriveProtocolStatePda,
  deriveRiskStatePda,
  deriveVaultPda,
} from "./lendguard-client";

// ─── Anchor discriminator helpers ────────────────────────────────────────────

async function sighash(name: string): Promise<Uint8Array> {
  const data = new TextEncoder().encode(`global:${name}`);
  const hash = await crypto.subtle.digest("SHA-256", data as BufferSource);
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
  const view = new DataView(buf.buffer);
  view.setBigUint64(0, value, true);
  return buf;
}

function u16ToLe(value: number): Uint8Array {
  const buf = new Uint8Array(2);
  const view = new DataView(buf.buffer);
  view.setUint16(0, value, true);
  return buf;
}

function labelToBytes8(s: string): Uint8Array {
  const out = new Uint8Array(8);
  const enc = new TextEncoder().encode(s);
  out.set(enc.slice(0, 8));
  return out;
}

// ─── PDA derivations for demo helpers ────────────────────────────────────────

const DEMO_MSG_APPROVAL_SEED = Buffer.from("demo_msg_approval");
const DEMO_CIPHERTEXT_SEED = Buffer.from("demo_ciphertext");
const LENDING_POOL_SEED = Buffer.from("lending_pool");
const BORROW_POSITION_SEED = Buffer.from("borrow_position");
const ADMIN_PRICE_FEED_SEED = Buffer.from("admin_price");
const BTC_VAULT_SEED = Buffer.from("btc_vault");
const BTC_ATTESTATION_SEED = Buffer.from("btc_attestation");
const BTC_BORROW_POSITION_SEED = Buffer.from("btc_borrow_position");

/** Ika dWallet program ID on Solana devnet (pre-alpha). */
export const IKA_DWALLET_PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_IKA_DWALLET_PROGRAM_ID ??
    "87W54kGYFQ1rgWqMeu4XTPHWXWmXSQCcjm8vCTfiq1oY",
);

/** Ika CPI authority seed — must match `CPI_AUTHORITY_SEED` in ika-dwallet-anchor. */
const IKA_CPI_AUTHORITY_SEED = Buffer.from("__ika_cpi_authority");

export function deriveIkaCpiAuthority(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([IKA_CPI_AUTHORITY_SEED], PROGRAM_ID);
}

// Real SPL token program / associated-token program IDs. Hardcoded to avoid
// pulling in @solana/spl-token at module load time on the frontend.
export const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
);
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
);

/**
 * Devnet LGUSD mint that the lending pool was bootstrapped with. Defined in
 * `contracts/lgusd-mint.json` and re-published here so the frontend doesn't
 * need to read the file at runtime.
 */
export const LGUSD_MINT = new PublicKey(
  process.env.NEXT_PUBLIC_LGUSD_MINT ??
    "9NuCY56MCS8FcGZ1i3wjpzffjwb9mnAQdX4CwgNWzhpZ",
);
export const LGUSD_DECIMALS = 6;

export function deriveDemoMessageApprovalPda(
  payer: PublicKey,
  dwalletId: Uint8Array,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [DEMO_MSG_APPROVAL_SEED, payer.toBuffer(), Buffer.from(dwalletId.slice(0, 32))],
    PROGRAM_ID,
  );
}

export function deriveDemoCiphertextPda(
  payer: PublicKey,
  label: string,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [DEMO_CIPHERTEXT_SEED, payer.toBuffer(), Buffer.from(labelToBytes8(label))],
    PROGRAM_ID,
  );
}

/**
 * Derive a user-owned associated token account for a given mint. Mirrors
 * `getAssociatedTokenAddressSync` from `@solana/spl-token` without pulling in
 * that package at runtime.
 */
export function deriveAssociatedTokenAddress(
  owner: PublicKey,
  mint: PublicKey,
  allowOwnerOffCurve = false,
): PublicKey {
  if (!allowOwnerOffCurve && !PublicKey.isOnCurve(owner.toBuffer())) {
    throw new Error("ATA owner must be on-curve unless allowOwnerOffCurve is true");
  }
  const [pda] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  return pda;
}

export function deriveLendingPoolPda(borrowAssetMint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [LENDING_POOL_SEED, borrowAssetMint.toBuffer()],
    PROGRAM_ID,
  );
}

export function deriveAdminPriceFeedPda(assetType: number): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [ADMIN_PRICE_FEED_SEED, Buffer.from([assetType & 0xff])],
    PROGRAM_ID,
  );
}

export function deriveBorrowPositionPda(vaultPda: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [BORROW_POSITION_SEED, vaultPda.toBuffer()],
    PROGRAM_ID,
  );
}

// ─── BTC testnet PDAs ────────────────────────────────────────────────────────

export function deriveBtcVaultPda(
  owner: PublicKey,
  ikaDwallet: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [BTC_VAULT_SEED, owner.toBuffer(), ikaDwallet.toBuffer()],
    PROGRAM_ID,
  );
}

export function deriveBtcAttestationPda(
  btcVaultPda: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [BTC_ATTESTATION_SEED, btcVaultPda.toBuffer()],
    PROGRAM_ID,
  );
}

export function deriveBtcBorrowPositionPda(
  btcVaultPda: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [BTC_BORROW_POSITION_SEED, btcVaultPda.toBuffer()],
    PROGRAM_ID,
  );
}

// ─── Account existence check ─────────────────────────────────────────────────

export async function accountExists(
  connection: Connection,
  address: PublicKey,
): Promise<boolean> {
  const info = await connection.getAccountInfo(address);
  return info !== null;
}

// ─── initialize_protocol ─────────────────────────────────────────────────────

export async function buildInitializeProtocolIx(
  admin: PublicKey,
): Promise<TransactionInstruction> {
  const [protocolStatePda] = deriveProtocolStatePda();
  const disc = await sighash("initialize_protocol");

  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: protocolStatePda, isSigner: false, isWritable: true },
      { pubkey: admin, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(disc),
  });
}

// ─── register_vault ──────────────────────────────────────────────────────────

export async function buildRegisterVaultIx(params: {
  owner: PublicKey;
  dwalletId: Uint8Array;
  assetType: number;
}): Promise<{ ix: TransactionInstruction; vaultPda: PublicKey }> {
  const [protocolStatePda] = deriveProtocolStatePda();
  const [vaultPda] = deriveVaultPda(params.owner, params.dwalletId);
  const disc = await sighash("register_vault");

  const data = concat(
    disc,
    params.dwalletId.slice(0, 32),
    new Uint8Array([params.assetType]),
  );

  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: vaultPda, isSigner: false, isWritable: true },
      { pubkey: protocolStatePda, isSigner: false, isWritable: true },
      { pubkey: params.owner, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(data),
  });

  return { ix, vaultPda };
}

// ─── deposit_collateral ──────────────────────────────────────────────────────

export async function buildDepositCollateralIx(params: {
  owner: PublicKey;
  vaultPda: PublicKey;
  amountLamports: bigint;
}): Promise<TransactionInstruction> {
  const [protocolStatePda] = deriveProtocolStatePda();
  const disc = await sighash("deposit_collateral");
  const data = concat(disc, u64ToLe(params.amountLamports));

  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: params.vaultPda, isSigner: false, isWritable: true },
      { pubkey: protocolStatePda, isSigner: false, isWritable: true },
      { pubkey: params.owner, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(data),
  });
}

// ─── verify_custody_proof ────────────────────────────────────────────────────

export async function buildVerifyCustodyProofIx(params: {
  owner: PublicKey;
  vaultPda: PublicKey;
  messageApprovalPda: PublicKey;
  expectedDwalletId: Uint8Array;
}): Promise<TransactionInstruction> {
  const disc = await sighash("verify_custody_proof");
  const data = concat(disc, params.expectedDwalletId.slice(0, 32));

  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: params.vaultPda, isSigner: false, isWritable: true },
      { pubkey: params.messageApprovalPda, isSigner: false, isWritable: false },
      { pubkey: params.owner, isSigner: true, isWritable: true },
    ],
    data: Buffer.from(data),
  });
}

// ─── initialize_risk_state ───────────────────────────────────────────────────

export async function buildInitializeRiskStateIx(params: {
  owner: PublicKey;
  vaultPda: PublicKey;
  thresholdCiphertext: PublicKey;
}): Promise<TransactionInstruction> {
  const [riskStatePda] = deriveRiskStatePda(params.vaultPda);
  const disc = await sighash("initialize_risk_state");
  const data = concat(disc, params.thresholdCiphertext.toBuffer());

  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: riskStatePda, isSigner: false, isWritable: true },
      { pubkey: params.vaultPda, isSigner: false, isWritable: false },
      { pubkey: params.owner, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(data),
  });
}

// ─── update_backing_state ────────────────────────────────────────────────────

export async function buildUpdateBackingStateIx(params: {
  owner: PublicKey;
  vaultPda: PublicKey;
  backingCiphertextPda: PublicKey;
  newBackingAmount: bigint;
}): Promise<TransactionInstruction> {
  const [protocolStatePda] = deriveProtocolStatePda();
  const [riskStatePda] = deriveRiskStatePda(params.vaultPda);
  const disc = await sighash("update_backing_state");
  const data = concat(disc, u64ToLe(params.newBackingAmount));

  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: params.vaultPda, isSigner: false, isWritable: false },
      { pubkey: riskStatePda, isSigner: false, isWritable: true },
      { pubkey: protocolStatePda, isSigner: false, isWritable: false },
      // encrypt_program — not used in pre-alpha but must be present
      { pubkey: PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: params.backingCiphertextPda, isSigner: false, isWritable: true },
      { pubkey: params.owner, isSigner: true, isWritable: false }, // oracle
      { pubkey: params.owner, isSigner: true, isWritable: true }, // payer
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(data),
  });
}

// ─── trigger_risk_check ──────────────────────────────────────────────────────

export async function buildTriggerRiskCheckIx(params: {
  owner: PublicKey;
  vaultPda: PublicKey;
  backingCiphertextPda: PublicKey;
  thresholdCiphertextPda: PublicKey;
  resultCiphertextPda: PublicKey;
}): Promise<TransactionInstruction> {
  const [protocolStatePda] = deriveProtocolStatePda();
  const [riskStatePda] = deriveRiskStatePda(params.vaultPda);
  const disc = await sighash("trigger_risk_check");

  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: params.vaultPda, isSigner: false, isWritable: true },
      { pubkey: riskStatePda, isSigner: false, isWritable: true },
      { pubkey: protocolStatePda, isSigner: false, isWritable: true },
      { pubkey: PROGRAM_ID, isSigner: false, isWritable: false }, // encrypt_program (placeholder)
      { pubkey: params.backingCiphertextPda, isSigner: false, isWritable: false },
      { pubkey: params.thresholdCiphertextPda, isSigner: false, isWritable: false },
      { pubkey: params.resultCiphertextPda, isSigner: false, isWritable: true },
      { pubkey: params.owner, isSigner: true, isWritable: true }, // payer
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(disc),
  });
}

// ─── unfreeze_protocol_state ─────────────────────────────────────────────────

export async function buildUnfreezeProtocolStateIx(
  admin: PublicKey,
): Promise<TransactionInstruction> {
  const [protocolStatePda] = deriveProtocolStatePda();
  const disc = await sighash("unfreeze_protocol_state");

  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: protocolStatePda, isSigner: false, isWritable: true },
      { pubkey: admin, isSigner: true, isWritable: false },
    ],
    data: Buffer.from(disc),
  });
}

/**
 * Read the `protocol_state` PDA's `frozen` flag from chain. Layout:
 *   [8 disc | 32 admin | 1 frozen | ...]
 * Returns null if the account doesn't exist yet.
 */
export async function readProtocolFrozen(
  connection: Connection,
): Promise<boolean | null> {
  const [protocolStatePda] = deriveProtocolStatePda();
  const info = await connection.getAccountInfo(protocolStatePda);
  if (!info) return null;
  // discriminator(8) + admin(32) → frozen at offset 40
  return info.data[40] === 1;
}

// ─── approve_custody_signature (real Ika CPI) ────────────────────────────────

/**
 * Build the LendGuard `approve_custody_signature` instruction. This is the
 * real-Ika path: LendGuard CPIs into the dWallet program's `approve_message`,
 * creating an Ika-owned `MessageApproval` PDA. After it lands, the off-chain
 * Ika network signs the message asynchronously (call `requestSign` from
 * `ika-client.ts`).
 *
 * The dWallet's authority must already point to LendGuard's CPI authority
 * PDA (set via Ika `requestDKG` with `intended_chain_sender = cpiAuthority`).
 */
export async function buildApproveCustodySignatureIx(params: {
  owner: PublicKey;
  vaultPda: PublicKey;
  callerProgram: PublicKey; // = LendGuard program ID
  cpiAuthority: PublicKey;
  dwalletProgram: PublicKey; // Ika dWallet program ID
  coordinator: PublicKey;
  dwallet: PublicKey;
  messageApproval: PublicKey;
  messageApprovalBump: number;
  messageDigest: Uint8Array; // 32 bytes (keccak256)
  messageMetadataDigest?: Uint8Array; // 32 bytes; defaults to zeros
  userPubkey: Uint8Array; // 32 bytes
  signatureScheme: number; // u16
}): Promise<TransactionInstruction> {
  const disc = await sighash("approve_custody_signature");
  const metaDigest = params.messageMetadataDigest ?? new Uint8Array(32);
  const schemeBytes = new Uint8Array(2);
  new DataView(schemeBytes.buffer).setUint16(0, params.signatureScheme, true);

  const data = concat(
    disc,
    params.messageDigest.slice(0, 32),
    metaDigest.slice(0, 32),
    params.userPubkey.slice(0, 32),
    schemeBytes,
    new Uint8Array([params.messageApprovalBump]),
  );

  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: params.vaultPda, isSigner: false, isWritable: true },
      { pubkey: params.callerProgram, isSigner: false, isWritable: false },
      { pubkey: params.cpiAuthority, isSigner: false, isWritable: false },
      { pubkey: params.dwalletProgram, isSigner: false, isWritable: false },
      { pubkey: params.coordinator, isSigner: false, isWritable: false },
      { pubkey: params.dwallet, isSigner: false, isWritable: false },
      { pubkey: params.messageApproval, isSigner: false, isWritable: true },
      { pubkey: params.owner, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(data),
  });
}

// ─── Production lending protocol ─────────────────────────────────────────────

/**
 * Build an `Associated Token Account create` instruction (idempotent variant).
 * Used to ensure the borrower / liquidator has an ATA before transferring
 * LGUSD into it.
 */
export function buildCreateAssociatedTokenAccountIx(params: {
  payer: PublicKey;
  owner: PublicKey;
  mint: PublicKey;
}): { ix: TransactionInstruction; ataAddress: PublicKey } {
  const ataAddress = deriveAssociatedTokenAddress(params.owner, params.mint, true);
  // ATA program "createIdempotent" instruction discriminator = 1 byte (0x01).
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

export async function buildInitializeLendingPoolIx(params: {
  admin: PublicKey;
  borrowAssetMint: PublicKey;
  poolTokenVault: PublicKey;
  assetType: number;
  initialLiquidity: bigint;
  initialPriceUsd: bigint; // 8 decimals
  ltvBasisPoints: number;
  liquidationThresholdBps: number;
  liquidationBonusBps: number;
  baseRateBps: number;
  rateSlopeBps: number;
}): Promise<{
  ix: TransactionInstruction;
  lendingPoolPda: PublicKey;
  priceFeedPda: PublicKey;
}> {
  const [lendingPoolPda] = deriveLendingPoolPda(params.borrowAssetMint);
  const [priceFeedPda] = deriveAdminPriceFeedPda(params.assetType);
  const disc = await sighash("initialize_lending_pool");
  const data = concat(
    disc,
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
    programId: PROGRAM_ID,
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

export async function buildCloseAdminPriceFeedIx(params: {
  admin: PublicKey;
  assetType: number;
}): Promise<{ ix: TransactionInstruction; priceFeedPda: PublicKey }> {
  const [priceFeedPda] = deriveAdminPriceFeedPda(params.assetType);
  const disc = await sighash("close_admin_price_feed");
  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: priceFeedPda, isSigner: false, isWritable: true },
      { pubkey: params.admin, isSigner: true, isWritable: true },
    ],
    data: Buffer.from(disc),
  });
  return { ix, priceFeedPda };
}

export async function buildUpdateAdminPriceIx(params: {
  admin: PublicKey;
  assetType: number;
  newPriceUsd: bigint; // 8 decimals
}): Promise<{ ix: TransactionInstruction; priceFeedPda: PublicKey }> {
  const [priceFeedPda] = deriveAdminPriceFeedPda(params.assetType);
  const disc = await sighash("update_admin_price");
  const data = concat(disc, u64ToLe(params.newPriceUsd));

  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: priceFeedPda, isSigner: false, isWritable: true },
      { pubkey: params.admin, isSigner: true, isWritable: false },
    ],
    data: Buffer.from(data),
  });

  return { ix, priceFeedPda };
}

export async function buildBorrowAgainstCollateralIx(params: {
  owner: PublicKey;
  vaultPda: PublicKey;
  assetType: number;
  borrowAssetMint: PublicKey;
  poolTokenVault: PublicKey;
  borrowerTokenAccount: PublicKey;
  amount: bigint; // 6 decimals
  healthCiphertext?: PublicKey;
}): Promise<{
  ix: TransactionInstruction;
  lendingPoolPda: PublicKey;
  priceFeedPda: PublicKey;
  borrowPositionPda: PublicKey;
}> {
  const [protocolStatePda] = deriveProtocolStatePda();
  const [lendingPoolPda] = deriveLendingPoolPda(params.borrowAssetMint);
  const [priceFeedPda] = deriveAdminPriceFeedPda(params.assetType);
  const [borrowPositionPda] = deriveBorrowPositionPda(params.vaultPda);
  const disc = await sighash("borrow_against_collateral");
  const data = concat(
    disc,
    u64ToLe(params.amount),
    (params.healthCiphertext ?? PublicKey.default).toBuffer(),
  );

  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
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

export async function buildRepayBorrowIx(params: {
  owner: PublicKey;
  vaultPda: PublicKey;
  borrowAssetMint: PublicKey;
  poolTokenVault: PublicKey;
  borrowerTokenAccount: PublicKey;
  amount: bigint; // 6 decimals
}): Promise<{
  ix: TransactionInstruction;
  lendingPoolPda: PublicKey;
  borrowPositionPda: PublicKey;
}> {
  const [lendingPoolPda] = deriveLendingPoolPda(params.borrowAssetMint);
  const [borrowPositionPda] = deriveBorrowPositionPda(params.vaultPda);
  const disc = await sighash("repay_borrow");
  const data = concat(disc, u64ToLe(params.amount));

  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
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

export async function buildLiquidatePositionIx(params: {
  liquidator: PublicKey;
  vaultPda: PublicKey;
  assetType: number;
  borrowAssetMint: PublicKey;
  poolTokenVault: PublicKey;
  liquidatorTokenAccount: PublicKey;
}): Promise<{
  ix: TransactionInstruction;
  lendingPoolPda: PublicKey;
  priceFeedPda: PublicKey;
  borrowPositionPda: PublicKey;
}> {
  const [protocolStatePda] = deriveProtocolStatePda();
  const [lendingPoolPda] = deriveLendingPoolPda(params.borrowAssetMint);
  const [priceFeedPda] = deriveAdminPriceFeedPda(params.assetType);
  const [borrowPositionPda] = deriveBorrowPositionPda(params.vaultPda);
  const disc = await sighash("liquidate_position");

  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
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
    data: Buffer.from(disc),
  });

  return { ix, lendingPoolPda, priceFeedPda, borrowPositionPda };
}

// ─── demo_create_message_approval ────────────────────────────────────────────

export async function buildDemoCreateMessageApprovalIx(params: {
  payer: PublicKey;
  dwalletId: Uint8Array;
  isSigned: boolean;
}): Promise<{ ix: TransactionInstruction; messageApprovalPda: PublicKey }> {
  const [messageApprovalPda] = deriveDemoMessageApprovalPda(
    params.payer,
    params.dwalletId,
  );
  const disc = await sighash("demo_create_message_approval");
  const data = concat(
    disc,
    params.dwalletId.slice(0, 32),
    new Uint8Array([params.isSigned ? 1 : 0]),
  );

  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: messageApprovalPda, isSigner: false, isWritable: true },
      { pubkey: params.payer, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(data),
  });

  return { ix, messageApprovalPda };
}

// ─── demo_create_ciphertext ──────────────────────────────────────────────────

export async function buildDemoCreateCiphertextIx(params: {
  payer: PublicKey;
  label: string; // up to 8 ASCII chars; padded with 0s
  value: number; // 0..255
}): Promise<{ ix: TransactionInstruction; ciphertextPda: PublicKey }> {
  const [ciphertextPda] = deriveDemoCiphertextPda(params.payer, params.label);
  const disc = await sighash("demo_create_ciphertext");
  const labelBytes = labelToBytes8(params.label);
  const data = concat(disc, labelBytes, new Uint8Array([params.value & 0xff]));

  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: ciphertextPda, isSigner: false, isWritable: true },
      { pubkey: params.payer, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(data),
  });

  return { ix, ciphertextPda };
}

// ─── BTC testnet collateral builders ─────────────────────────────────────────

function vecU8(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + bytes.length);
  new DataView(out.buffer).setUint32(0, bytes.length, true);
  out.set(bytes, 4);
  return out;
}

const ASSET_BTC = 0;

export async function buildRegisterBtcVaultIx(params: {
  owner: PublicKey;
  ikaDwallet: PublicKey;
  dwalletPubkey: Uint8Array; // 33 bytes compressed
  bitcoinAddress: string; // tb1q… or tb1p…
}): Promise<{
  ix: TransactionInstruction;
  btcVaultPda: PublicKey;
  btcAttestationPda: PublicKey;
}> {
  if (params.dwalletPubkey.length !== 33) {
    throw new Error("dwalletPubkey must be 33 bytes (compressed Secp256k1)");
  }
  const [btcVaultPda] = deriveBtcVaultPda(params.owner, params.ikaDwallet);
  const [btcAttestationPda] = deriveBtcAttestationPda(btcVaultPda);
  const [protocolStatePda] = deriveProtocolStatePda();
  const disc = await sighash("register_btc_vault");
  const addrBytes = new TextEncoder().encode(params.bitcoinAddress);

  const data = concat(
    disc,
    params.ikaDwallet.toBuffer(),
    params.dwalletPubkey,
    vecU8(addrBytes),
  );

  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
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

export async function buildAttestBtcBalanceIx(params: {
  keeper: PublicKey;
  btcVaultPda: PublicKey;
  satoshis: bigint;
  bitcoinBlockHeight: bigint;
  bitcoinBlockHash: Uint8Array; // 32 bytes
}): Promise<TransactionInstruction> {
  if (params.bitcoinBlockHash.length !== 32) {
    throw new Error("bitcoinBlockHash must be 32 bytes");
  }
  const [btcAttestationPda] = deriveBtcAttestationPda(params.btcVaultPda);
  const [protocolStatePda] = deriveProtocolStatePda();
  const disc = await sighash("attest_btc_balance");
  const data = concat(
    disc,
    u64ToLe(params.satoshis),
    u64ToLe(params.bitcoinBlockHeight),
    params.bitcoinBlockHash,
  );

  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: params.btcVaultPda, isSigner: false, isWritable: true },
      { pubkey: btcAttestationPda, isSigner: false, isWritable: true },
      { pubkey: protocolStatePda, isSigner: false, isWritable: false },
      { pubkey: params.keeper, isSigner: true, isWritable: true },
    ],
    data: Buffer.from(data),
  });
}

export async function buildVerifyBtcCustodyProofIx(params: {
  owner: PublicKey;
  btcVaultPda: PublicKey;
  messageApprovalPda: PublicKey;
}): Promise<TransactionInstruction> {
  const disc = await sighash("verify_btc_custody_proof");
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: params.btcVaultPda, isSigner: false, isWritable: true },
      { pubkey: params.messageApprovalPda, isSigner: false, isWritable: false },
      { pubkey: params.owner, isSigner: true, isWritable: false },
    ],
    data: Buffer.from(disc),
  });
}

export async function buildRefreshBtcCustodyProofIx(params: {
  owner: PublicKey;
  btcVaultPda: PublicKey;
  messageApprovalPda: PublicKey;
}): Promise<TransactionInstruction> {
  const disc = await sighash("refresh_btc_custody_proof");
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: params.btcVaultPda, isSigner: false, isWritable: true },
      { pubkey: params.messageApprovalPda, isSigner: false, isWritable: false },
      { pubkey: params.owner, isSigner: true, isWritable: false },
    ],
    data: Buffer.from(disc),
  });
}

export async function buildBorrowAgainstBtcCollateralIx(params: {
  owner: PublicKey;
  btcVaultPda: PublicKey;
  borrowAssetMint: PublicKey;
  poolTokenVault: PublicKey;
  borrowerTokenAccount: PublicKey;
  amount: bigint;
  healthCiphertext?: PublicKey;
}): Promise<{
  ix: TransactionInstruction;
  lendingPoolPda: PublicKey;
  priceFeedPda: PublicKey;
  btcAttestationPda: PublicKey;
  borrowPositionPda: PublicKey;
}> {
  const [protocolStatePda] = deriveProtocolStatePda();
  const [lendingPoolPda] = deriveLendingPoolPda(params.borrowAssetMint);
  const [priceFeedPda] = deriveAdminPriceFeedPda(ASSET_BTC);
  const [btcAttestationPda] = deriveBtcAttestationPda(params.btcVaultPda);
  const [borrowPositionPda] = deriveBtcBorrowPositionPda(params.btcVaultPda);
  const disc = await sighash("borrow_against_btc_collateral");
  const healthCt = params.healthCiphertext ?? PublicKey.default;
  const data = concat(disc, u64ToLe(params.amount), healthCt.toBuffer());

  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
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

export async function buildRepayBtcBorrowIx(params: {
  owner: PublicKey;
  btcVaultPda: PublicKey;
  borrowAssetMint: PublicKey;
  poolTokenVault: PublicKey;
  borrowerTokenAccount: PublicKey;
  amount: bigint; // pass u64::MAX (== 2^64 - 1) as bigint for "repay all"
}): Promise<TransactionInstruction> {
  const [lendingPoolPda] = deriveLendingPoolPda(params.borrowAssetMint);
  const [borrowPositionPda] = deriveBtcBorrowPositionPda(params.btcVaultPda);
  const disc = await sighash("repay_btc_borrow");
  const data = concat(disc, u64ToLe(params.amount));

  return new TransactionInstruction({
    programId: PROGRAM_ID,
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

export async function buildLiquidateBtcPositionIx(params: {
  liquidator: PublicKey;
  btcVaultPda: PublicKey;
  ikaDwallet: PublicKey;
  borrowAssetMint: PublicKey;
  poolTokenVault: PublicKey;
  liquidatorTokenAccount: PublicKey;
  coordinator: PublicKey;
  messageApproval: PublicKey;
  bitcoinSighash: Uint8Array; // 32 bytes — BIP143 double-SHA256 sighash
  messageMetadataDigest?: Uint8Array; // 32 bytes; defaults to zeros
  userPubkey: Uint8Array; // 32 bytes (Ed25519 signer in user_pubkey field)
  messageApprovalBump: number;
}): Promise<TransactionInstruction> {
  if (params.bitcoinSighash.length !== 32) {
    throw new Error("bitcoinSighash must be 32 bytes");
  }
  if (params.userPubkey.length !== 32) {
    throw new Error("userPubkey must be 32 bytes");
  }
  const [protocolStatePda] = deriveProtocolStatePda();
  const [lendingPoolPda] = deriveLendingPoolPda(params.borrowAssetMint);
  const [priceFeedPda] = deriveAdminPriceFeedPda(ASSET_BTC);
  const [btcAttestationPda] = deriveBtcAttestationPda(params.btcVaultPda);
  const [borrowPositionPda] = deriveBtcBorrowPositionPda(params.btcVaultPda);
  const [cpiAuthority] = deriveIkaCpiAuthority();
  const disc = await sighash("liquidate_btc_position");
  const meta = params.messageMetadataDigest ?? new Uint8Array(32);
  const data = concat(
    disc,
    params.bitcoinSighash,
    meta.slice(0, 32),
    params.userPubkey.slice(0, 32),
    new Uint8Array([params.messageApprovalBump]),
  );

  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: params.btcVaultPda, isSigner: false, isWritable: true },
      { pubkey: protocolStatePda, isSigner: false, isWritable: false },
      { pubkey: lendingPoolPda, isSigner: false, isWritable: true },
      { pubkey: priceFeedPda, isSigner: false, isWritable: false },
      { pubkey: btcAttestationPda, isSigner: false, isWritable: false },
      { pubkey: borrowPositionPda, isSigner: false, isWritable: true },
      { pubkey: params.poolTokenVault, isSigner: false, isWritable: true },
      { pubkey: params.liquidatorTokenAccount, isSigner: false, isWritable: true },
      { pubkey: PROGRAM_ID, isSigner: false, isWritable: false }, // caller_program
      { pubkey: cpiAuthority, isSigner: false, isWritable: false },
      { pubkey: IKA_DWALLET_PROGRAM_ID, isSigner: false, isWritable: false },
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

export async function buildFinalizeBtcLiquidationIx(params: {
  keeper: PublicKey;
  btcVaultPda: PublicKey;
  bitcoinTxId: Uint8Array; // 32 bytes
  bitcoinBlockHeight: bigint;
  confirmations: number;
  remainingSatoshis: bigint;
}): Promise<TransactionInstruction> {
  if (params.bitcoinTxId.length !== 32) {
    throw new Error("bitcoinTxId must be 32 bytes");
  }
  const [btcAttestationPda] = deriveBtcAttestationPda(params.btcVaultPda);
  const [borrowPositionPda] = deriveBtcBorrowPositionPda(params.btcVaultPda);
  const [protocolStatePda] = deriveProtocolStatePda();
  const disc = await sighash("finalize_btc_liquidation");
  const confBytes = new Uint8Array(4);
  new DataView(confBytes.buffer).setUint32(0, params.confirmations, true);
  const data = concat(
    disc,
    params.bitcoinTxId,
    u64ToLe(params.bitcoinBlockHeight),
    confBytes,
    u64ToLe(params.remainingSatoshis),
  );

  return new TransactionInstruction({
    programId: PROGRAM_ID,
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

// ─── high-level helpers ──────────────────────────────────────────────────────

export interface SendIxOptions {
  connection: Connection;
  payer: PublicKey;
  signTransaction: (tx: Transaction) => Promise<Transaction>;
}

export async function sendIx(
  ix: TransactionInstruction | TransactionInstruction[],
  opts: SendIxOptions,
): Promise<string> {
  const tx = new Transaction();
  if (Array.isArray(ix)) {
    ix.forEach((i) => tx.add(i));
  } else {
    tx.add(ix);
  }
  tx.feePayer = opts.payer;
  const { blockhash, lastValidBlockHeight } =
    await opts.connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;

  // Pre-flight simulation against OUR devnet RPC. Phantom defaults to mainnet
  // for its wallet-side sim, which always fails for devnet-only programs (the
  // mint, the LendGuard program ID and the borrow-position PDA don't exist on
  // mainnet). When that happens Phantom shows a scary "Simulation failed"
  // banner even though the tx will succeed once submitted. By doing our own
  // sim here we (a) surface real contract errors with their on-chain message
  // and (b) let the user safely ignore Phantom's bogus warning.
  try {
    const sim = await opts.connection.simulateTransaction(tx, undefined, true);
    if (sim.value.err) {
      const logs = sim.value.logs ?? [];
      const programErr = logs
        .map((l) => /Program log: AnchorError.*Error Message: (.*)\./.exec(l)?.[1])
        .find(Boolean);
      const errStr =
        programErr ??
        (typeof sim.value.err === "string"
          ? sim.value.err
          : JSON.stringify(sim.value.err));
      throw new Error(
        `On-chain pre-flight simulation failed: ${errStr}. ` +
          `(If your wallet's simulation also failed but this one passed, ` +
          `enable Testnet Mode in your wallet — it's simulating against mainnet.)`,
      );
    }
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("On-chain pre-flight")) {
      throw e;
    }
    // RPC issue, not a contract error — swallow and let the actual submit retry.
    console.warn("[sendIx] pre-flight sim could not run:", e);
  }

  const signed = await opts.signTransaction(tx);
  const sig = await opts.connection.sendRawTransaction(signed.serialize(), {
    skipPreflight: false,
  });

  await opts.connection.confirmTransaction(
    { signature: sig, blockhash, lastValidBlockHeight },
    "confirmed",
  );

  return sig;
}

/**
 * Generate a deterministic-but-unique 32-byte dwallet ID for demo purposes.
 * Real Ika dWallets are produced by the 2PC-MPC DKG ceremony — this is a
 * demo-side stand-in that uniquely identifies a vault per (owner, session).
 */
export async function generateDemoDwalletId(
  owner: PublicKey,
  salt = "",
): Promise<Uint8Array> {
  // SHA-256 the full seed so the timestamp + pubkey + salt all contribute
  // entropy. `dwalletIdToBytes` was truncating the seed to its first 32 bytes,
  // which made every call collide on `lendguard-demo:<pubkey-prefix>` and
  // produce the same vault PDA — second `register_vault` failed with
  // "account already in use".
  const seed = `lendguard-demo:${owner.toBase58()}:${salt}:${Date.now()}:${Math.random()}`;
  const data = new TextEncoder().encode(seed);
  const hash = await crypto.subtle.digest("SHA-256", data as BufferSource);
  return new Uint8Array(hash);
}

export function explorerTxUrl(sig: string): string {
  return `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
}

export function explorerAccountUrl(addr: string): string {
  return `https://explorer.solana.com/address/${addr}?cluster=devnet`;
}
