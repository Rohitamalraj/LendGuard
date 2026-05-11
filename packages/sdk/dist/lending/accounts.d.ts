/**
 * Account decoders + on-chain readers for the LendGuard lending protocol.
 * Mirrors the raw account layouts in `contracts/src/state/`.
 */
import { Connection, PublicKey } from "@solana/web3.js";
export interface LendingPoolAccount {
    borrowAsset: PublicKey;
    borrowAssetMint: PublicKey;
    poolTokenVault: PublicKey;
    totalLiquidity: bigint;
    totalBorrowed: bigint;
    admin: PublicKey;
    ltvBasisPoints: number;
    liquidationThresholdBps: number;
    liquidationBonusBps: number;
    mintDecimals: number;
    borrowIndex: bigint;
    lastUpdateSlot: bigint;
    baseRateBps: number;
    rateSlopeBps: number;
    bump: number;
}
export interface AdminPriceFeedAccount {
    assetType: number;
    priceUsd: bigint;
    updatedAt: number;
    admin: PublicKey;
    bump: number;
}
export interface BorrowPositionAccount {
    vault: PublicKey;
    owner: PublicKey;
    borrowAsset: PublicKey;
    principal: bigint;
    borrowedAt: number;
    lastUpdatedAt: number;
    borrowIndexSnapshot: bigint;
    healthCiphertext: PublicKey;
    bump: number;
}
export declare const LENDING_POOL_LEN: number;
export declare const ADMIN_PRICE_FEED_LEN: number;
export declare const BORROW_POSITION_LEN: number;
export declare function decodeLendingPool(data: Buffer): LendingPoolAccount | null;
export declare function decodeAdminPriceFeed(data: Buffer): AdminPriceFeedAccount | null;
export declare function decodeBorrowPosition(data: Buffer): BorrowPositionAccount | null;
export declare function readLendingPool(connection: Connection, borrowAssetMint?: PublicKey, programId?: PublicKey): Promise<{
    poolPda: PublicKey;
    pool: LendingPoolAccount | null;
}>;
export declare function readAdminPriceFeed(connection: Connection, assetType?: number, programId?: PublicKey): Promise<{
    priceFeedPda: PublicKey;
    priceFeed: AdminPriceFeedAccount | null;
}>;
export declare function readBorrowPosition(connection: Connection, vaultPda: PublicKey, programId?: PublicKey): Promise<{
    positionPda: PublicKey;
    position: BorrowPositionAccount | null;
}>;
export declare function listAllBorrowPositions(connection: Connection, programId?: PublicKey): Promise<{
    positionPda: PublicKey;
    position: BorrowPositionAccount;
}[]>;
/** Current debt = scaled principal × pool.borrow_index / RAY (Aave-style). */
export declare function currentDebt(scaledPrincipal: bigint, borrowIndex: bigint): bigint;
/** Mirror of the on-chain liquidation predicate. */
export declare function isLiquidatable(depositedLamports: bigint, priceUsd: bigint, debt: bigint, liquidationThresholdBps: number): boolean;
export declare function formatLgUsd(amount: bigint): string;
export declare function parseLgUsd(amount: string): bigint;
export declare function formatPriceUsd(price: bigint): string;
