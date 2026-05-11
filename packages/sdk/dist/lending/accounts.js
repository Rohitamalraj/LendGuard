/**
 * Account decoders + on-chain readers for the LendGuard lending protocol.
 * Mirrors the raw account layouts in `contracts/src/state/`.
 */
import { PublicKey } from "@solana/web3.js";
import { ASSET_BTC, COLLATERAL_DECIMALS, deriveAdminPriceFeedPda, deriveBorrowPositionPda, deriveLendingPoolPda, LENDGUARD_PROGRAM_ID, LGUSD_MINT_DEVNET, LGUSD_SCALE, PRICE_SCALE, RAY, } from "./constants.js";
export const LENDING_POOL_LEN = 8 + 32 + 32 + 32 + 8 + 8 + 32 + 2 + 2 + 2 + 1 + 16 + 8 + 2 + 2 + 1;
export const ADMIN_PRICE_FEED_LEN = 8 + 1 + 8 + 8 + 32 + 1;
export const BORROW_POSITION_LEN = 8 + 32 + 32 + 32 + 8 + 8 + 8 + 16 + 32 + 1;
function readBigUInt128LE(buf, off) {
    const lo = buf.readBigUInt64LE(off);
    const hi = buf.readBigUInt64LE(off + 8);
    return (hi << 64n) | lo;
}
export function decodeLendingPool(data) {
    if (data.length < LENDING_POOL_LEN)
        return null;
    let off = 8;
    const borrowAsset = new PublicKey(data.subarray(off, off + 32));
    off += 32;
    const borrowAssetMint = new PublicKey(data.subarray(off, off + 32));
    off += 32;
    const poolTokenVault = new PublicKey(data.subarray(off, off + 32));
    off += 32;
    const totalLiquidity = data.readBigUInt64LE(off);
    off += 8;
    const totalBorrowed = data.readBigUInt64LE(off);
    off += 8;
    const admin = new PublicKey(data.subarray(off, off + 32));
    off += 32;
    const ltvBasisPoints = data.readUInt16LE(off);
    off += 2;
    const liquidationThresholdBps = data.readUInt16LE(off);
    off += 2;
    const liquidationBonusBps = data.readUInt16LE(off);
    off += 2;
    const mintDecimals = data[off];
    off += 1;
    const borrowIndex = readBigUInt128LE(data, off);
    off += 16;
    const lastUpdateSlot = data.readBigUInt64LE(off);
    off += 8;
    const baseRateBps = data.readUInt16LE(off);
    off += 2;
    const rateSlopeBps = data.readUInt16LE(off);
    off += 2;
    const bump = data[off];
    return {
        borrowAsset,
        borrowAssetMint,
        poolTokenVault,
        totalLiquidity,
        totalBorrowed,
        admin,
        ltvBasisPoints,
        liquidationThresholdBps,
        liquidationBonusBps,
        mintDecimals,
        borrowIndex,
        lastUpdateSlot,
        baseRateBps,
        rateSlopeBps,
        bump,
    };
}
export function decodeAdminPriceFeed(data) {
    if (data.length < ADMIN_PRICE_FEED_LEN)
        return null;
    let off = 8;
    const assetType = data[off];
    off += 1;
    const priceUsd = data.readBigUInt64LE(off);
    off += 8;
    const updatedAt = Number(data.readBigInt64LE(off));
    off += 8;
    const admin = new PublicKey(data.subarray(off, off + 32));
    off += 32;
    const bump = data[off];
    return { assetType, priceUsd, updatedAt, admin, bump };
}
export function decodeBorrowPosition(data) {
    if (data.length < BORROW_POSITION_LEN)
        return null;
    let off = 8;
    const vault = new PublicKey(data.subarray(off, off + 32));
    off += 32;
    const owner = new PublicKey(data.subarray(off, off + 32));
    off += 32;
    const borrowAsset = new PublicKey(data.subarray(off, off + 32));
    off += 32;
    const principal = data.readBigUInt64LE(off);
    off += 8;
    const borrowedAt = Number(data.readBigInt64LE(off));
    off += 8;
    const lastUpdatedAt = Number(data.readBigInt64LE(off));
    off += 8;
    const borrowIndexSnapshot = readBigUInt128LE(data, off);
    off += 16;
    const healthCiphertext = new PublicKey(data.subarray(off, off + 32));
    off += 32;
    const bump = data[off];
    return {
        vault,
        owner,
        borrowAsset,
        principal,
        borrowedAt,
        lastUpdatedAt,
        borrowIndexSnapshot,
        healthCiphertext,
        bump,
    };
}
// ─── On-chain readers ────────────────────────────────────────────────────────
export async function readLendingPool(connection, borrowAssetMint = LGUSD_MINT_DEVNET, programId = LENDGUARD_PROGRAM_ID) {
    const [poolPda] = deriveLendingPoolPda(borrowAssetMint, programId);
    const info = await connection.getAccountInfo(poolPda);
    return { poolPda, pool: info ? decodeLendingPool(info.data) : null };
}
export async function readAdminPriceFeed(connection, assetType = ASSET_BTC, programId = LENDGUARD_PROGRAM_ID) {
    const [priceFeedPda] = deriveAdminPriceFeedPda(assetType, programId);
    const info = await connection.getAccountInfo(priceFeedPda);
    return {
        priceFeedPda,
        priceFeed: info ? decodeAdminPriceFeed(info.data) : null,
    };
}
export async function readBorrowPosition(connection, vaultPda, programId = LENDGUARD_PROGRAM_ID) {
    const [positionPda] = deriveBorrowPositionPda(vaultPda, programId);
    const info = await connection.getAccountInfo(positionPda);
    return {
        positionPda,
        position: info ? decodeBorrowPosition(info.data) : null,
    };
}
export async function listAllBorrowPositions(connection, programId = LENDGUARD_PROGRAM_ID) {
    const accounts = await connection.getProgramAccounts(programId, {
        commitment: "confirmed",
        filters: [{ dataSize: BORROW_POSITION_LEN }],
    });
    const out = [];
    for (const a of accounts) {
        const position = decodeBorrowPosition(a.account.data);
        if (!position)
            continue;
        out.push({ positionPda: a.pubkey, position });
    }
    return out;
}
// ─── Math utilities ──────────────────────────────────────────────────────────
/** Current debt = scaled principal × pool.borrow_index / RAY (Aave-style). */
export function currentDebt(scaledPrincipal, borrowIndex) {
    return (scaledPrincipal * borrowIndex) / RAY;
}
/** Mirror of the on-chain liquidation predicate. */
export function isLiquidatable(depositedLamports, priceUsd, debt, liquidationThresholdBps) {
    const collateralValue = (((depositedLamports * priceUsd) / COLLATERAL_DECIMALS) * LGUSD_SCALE) /
        PRICE_SCALE;
    const liquidationValue = (collateralValue * BigInt(liquidationThresholdBps)) / 10000n;
    return debt > liquidationValue;
}
export function formatLgUsd(amount) {
    const whole = amount / LGUSD_SCALE;
    const frac = amount % LGUSD_SCALE;
    const fracText = frac.toString().padStart(6, "0").replace(/0+$/, "");
    return fracText ? `${whole}.${fracText}` : whole.toString();
}
export function parseLgUsd(amount) {
    const [wholeRaw, fracRaw = ""] = amount.trim().split(".");
    const whole = BigInt(wholeRaw || "0") * LGUSD_SCALE;
    const fracPadded = (fracRaw + "000000").slice(0, 6);
    return whole + BigInt(fracPadded || "0");
}
export function formatPriceUsd(price) {
    const dollars = Number(price) / Number(PRICE_SCALE);
    return `$${dollars.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}
