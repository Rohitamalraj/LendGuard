/**
 * Anchor-compatible transaction builders for the LendGuard lending protocol.
 *
 * These are framework-agnostic — no Anchor runtime needed. They produce raw
 * `TransactionInstruction`s that you can assemble into a `Transaction` and
 * sign with any wallet that exposes a `signTransaction` method.
 */
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
/**
 * ATA program "createIdempotent" instruction. Use to ensure a borrower or
 * liquidator has an LGUSD token account before transfers.
 */
export declare function buildCreateAssociatedTokenAccountIx(params: {
    payer: PublicKey;
    owner: PublicKey;
    mint: PublicKey;
}): {
    ix: TransactionInstruction;
    ataAddress: PublicKey;
};
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
export declare function buildBorrowAgainstCollateralIx(params: BorrowAgainstCollateralParams): Promise<{
    ix: TransactionInstruction;
    lendingPoolPda: PublicKey;
    priceFeedPda: PublicKey;
    borrowPositionPda: PublicKey;
}>;
export interface RepayBorrowParams {
    owner: PublicKey;
    vaultPda: PublicKey;
    borrowAssetMint: PublicKey;
    poolTokenVault: PublicKey;
    borrowerTokenAccount: PublicKey;
    amount: bigint;
    programId?: PublicKey;
}
export declare function buildRepayBorrowIx(params: RepayBorrowParams): Promise<{
    ix: TransactionInstruction;
    lendingPoolPda: PublicKey;
    borrowPositionPda: PublicKey;
}>;
export interface LiquidatePositionParams {
    liquidator: PublicKey;
    vaultPda: PublicKey;
    assetType: number;
    borrowAssetMint: PublicKey;
    poolTokenVault: PublicKey;
    liquidatorTokenAccount: PublicKey;
    programId?: PublicKey;
}
export declare function buildLiquidatePositionIx(params: LiquidatePositionParams): Promise<{
    ix: TransactionInstruction;
    lendingPoolPda: PublicKey;
    priceFeedPda: PublicKey;
    borrowPositionPda: PublicKey;
}>;
export interface UpdateAdminPriceParams {
    admin: PublicKey;
    assetType: number;
    newPriceUsd: bigint;
    programId?: PublicKey;
}
export declare function buildUpdateAdminPriceIx(params: UpdateAdminPriceParams): Promise<{
    ix: TransactionInstruction;
    priceFeedPda: PublicKey;
}>;
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
export declare function buildInitializeLendingPoolIx(params: InitializeLendingPoolParams): Promise<{
    ix: TransactionInstruction;
    lendingPoolPda: PublicKey;
    priceFeedPda: PublicKey;
}>;
export interface InitializeAdminPriceFeedParams {
    admin: PublicKey;
    assetType: number;
    initialPriceUsd: bigint;
    programId?: PublicKey;
}
export declare function buildInitializeAdminPriceFeedIx(params: InitializeAdminPriceFeedParams): Promise<{
    ix: TransactionInstruction;
    priceFeedPda: PublicKey;
}>;
