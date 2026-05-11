import { Connection, PublicKey } from "@solana/web3.js";

import { PROGRAM_ID } from "./lendguard-client";
import {
  deriveAdminPriceFeedPda,
  deriveBorrowPositionPda,
  deriveLendingPoolPda,
  LGUSD_MINT,
} from "./program-actions";

export const ASSET_BTC = 0;
export const PRICE_SCALE = 100_000_000n;
export const LGUSD_SCALE = 1_000_000n;
export const RAY = 1_000_000_000_000_000_000n; // 1e18

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

export interface BorrowPositionListing {
  positionPda: PublicKey;
  position: BorrowPositionAccount;
}

export const LENDING_POOL_LEN =
  8 + 32 + 32 + 32 + 8 + 8 + 32 + 2 + 2 + 2 + 1 + 16 + 8 + 2 + 2 + 1;
export const ADMIN_PRICE_FEED_LEN = 8 + 1 + 8 + 8 + 32 + 1;
export const BORROW_POSITION_LEN =
  8 + 32 + 32 + 32 + 8 + 8 + 8 + 16 + 32 + 1;

export function defaultBorrowAssetMint(): PublicKey {
  return LGUSD_MINT;
}

export async function readDefaultLendingPool(connection: Connection): Promise<{
  poolPda: PublicKey;
  priceFeedPda: PublicKey;
  pool: LendingPoolAccount | null;
  priceFeed: AdminPriceFeedAccount | null;
}> {
  const mint = defaultBorrowAssetMint();
  const [poolPda] = deriveLendingPoolPda(mint);
  const [priceFeedPda] = deriveAdminPriceFeedPda(ASSET_BTC);
  const [poolInfo, priceInfo] = await Promise.all([
    connection.getAccountInfo(poolPda),
    connection.getAccountInfo(priceFeedPda),
  ]);
  return {
    poolPda,
    priceFeedPda,
    pool: poolInfo ? decodeLendingPool(poolInfo.data) : null,
    priceFeed: priceInfo ? decodeAdminPriceFeed(priceInfo.data) : null,
  };
}

export async function readBorrowPosition(
  connection: Connection,
  vaultPda: PublicKey,
): Promise<{ positionPda: PublicKey; position: BorrowPositionAccount | null }> {
  const [positionPda] = deriveBorrowPositionPda(vaultPda);
  const info = await connection.getAccountInfo(positionPda);
  return {
    positionPda,
    position: info ? decodeBorrowPosition(info.data) : null,
  };
}

export async function listBorrowPositionsForOwner(
  connection: Connection,
  owner: PublicKey,
): Promise<BorrowPositionListing[]> {
  const accounts = await connection.getProgramAccounts(PROGRAM_ID, {
    commitment: "confirmed",
    filters: [
      { dataSize: BORROW_POSITION_LEN },
      {
        memcmp: {
          offset: 8 + 32,
          bytes: owner.toBase58(),
        },
      },
    ],
  });

  const out: BorrowPositionListing[] = [];
  for (const a of accounts) {
    const position = decodeBorrowPosition(a.account.data);
    if (!position) continue;
    out.push({ positionPda: a.pubkey, position });
  }
  out.sort((a, b) => b.position.borrowedAt - a.position.borrowedAt);
  return out;
}

export async function listAllBorrowPositions(
  connection: Connection,
): Promise<BorrowPositionListing[]> {
  const accounts = await connection.getProgramAccounts(PROGRAM_ID, {
    commitment: "confirmed",
    filters: [{ dataSize: BORROW_POSITION_LEN }],
  });
  const out: BorrowPositionListing[] = [];
  for (const a of accounts) {
    const position = decodeBorrowPosition(a.account.data);
    if (!position) continue;
    out.push({ positionPda: a.pubkey, position });
  }
  return out;
}

export function decodeLendingPool(data: Buffer): LendingPoolAccount | null {
  if (data.length < LENDING_POOL_LEN) return null;
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

export function decodeAdminPriceFeed(data: Buffer): AdminPriceFeedAccount | null {
  if (data.length < ADMIN_PRICE_FEED_LEN) return null;
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

export function decodeBorrowPosition(data: Buffer): BorrowPositionAccount | null {
  if (data.length < BORROW_POSITION_LEN) return null;
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

function readBigUInt128LE(buf: Buffer, off: number): bigint {
  const lo = buf.readBigUInt64LE(off);
  const hi = buf.readBigUInt64LE(off + 8);
  return (hi << 64n) | lo;
}

export function formatLgUsd(amount: bigint): string {
  const whole = amount / LGUSD_SCALE;
  const frac = amount % LGUSD_SCALE;
  const fracText = frac.toString().padStart(6, "0").replace(/0+$/, "");
  return fracText ? `${whole}.${fracText}` : whole.toString();
}

export function parseLgUsd(amount: string): bigint {
  const [wholeRaw, fracRaw = ""] = amount.trim().split(".");
  const whole = BigInt(wholeRaw || "0") * LGUSD_SCALE;
  const fracPadded = (fracRaw + "000000").slice(0, 6);
  return whole + BigInt(fracPadded || "0");
}

export function formatPriceUsd(price: bigint): string {
  const dollars = Number(price) / Number(PRICE_SCALE);
  return `$${dollars.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

/**
 * Compute the on-chain debt of a position right now: principal is stored in
 * SCALED units (Aave-style), so the actual debt at this instant is
 * `principal × borrow_index / RAY`.
 */
export function currentDebt(
  scaledPrincipal: bigint,
  borrowIndex: bigint,
): bigint {
  return (scaledPrincipal * borrowIndex) / RAY;
}

/**
 * Compute the (plaintext) liquidation predicate exactly the way the on-chain
 * program does — used by the UI to decide which positions to surface as
 * liquidatable.
 */
export function isLiquidatable(
  depositedLamports: bigint,
  priceUsd: bigint,
  debt: bigint,
  liquidationThresholdBps: number,
): boolean {
  const COLLATERAL_DECIMALS = 1_000_000_000n;
  const collateralValueBorrowUnits =
    (((depositedLamports * priceUsd) / COLLATERAL_DECIMALS) * LGUSD_SCALE) /
    PRICE_SCALE;
  const liquidationValue =
    (collateralValueBorrowUnits * BigInt(liquidationThresholdBps)) / 10_000n;
  return debt > liquidationValue;
}
