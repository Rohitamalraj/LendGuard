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
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
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
export declare function buildRegisterBtcVaultIx(params: RegisterBtcVaultParams): Promise<{
    ix: TransactionInstruction;
    btcVaultPda: PublicKey;
    btcAttestationPda: PublicKey;
}>;
export interface VerifyBtcCustodyProofParams {
    owner: PublicKey;
    btcVaultPda: PublicKey;
    /** Ika MessageApproval PDA produced by the dWallet signing ceremony. */
    messageApprovalPda: PublicKey;
    programId?: PublicKey;
}
export declare function buildVerifyBtcCustodyProofIx(params: VerifyBtcCustodyProofParams): Promise<TransactionInstruction>;
export interface RefreshBtcCustodyProofParams {
    owner: PublicKey;
    btcVaultPda: PublicKey;
    /** Fresh Ika MessageApproval PDA — used to extend the proof TTL. */
    messageApprovalPda: PublicKey;
    programId?: PublicKey;
}
export declare function buildRefreshBtcCustodyProofIx(params: RefreshBtcCustodyProofParams): Promise<TransactionInstruction>;
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
export declare function buildAttestBtcBalanceIx(params: AttestBtcBalanceParams): Promise<TransactionInstruction>;
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
export declare function buildBorrowAgainstBtcCollateralIx(params: BorrowAgainstBtcCollateralParams): Promise<{
    ix: TransactionInstruction;
    lendingPoolPda: PublicKey;
    priceFeedPda: PublicKey;
    btcAttestationPda: PublicKey;
    borrowPositionPda: PublicKey;
}>;
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
export declare function buildRepayBtcBorrowIx(params: RepayBtcBorrowParams): Promise<TransactionInstruction>;
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
export declare function buildLiquidateBtcPositionIx(params: LiquidateBtcPositionParams): Promise<TransactionInstruction>;
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
export declare function buildFinalizeBtcLiquidationIx(params: FinalizeBtcLiquidationParams): Promise<TransactionInstruction>;
