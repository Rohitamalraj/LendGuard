import { Connection, PublicKey } from "@solana/web3.js";

import { PROGRAM_ID } from "./lendguard-client";
import {
  deriveAdminPriceFeedPda,
  deriveBtcAttestationPda,
  deriveBtcBorrowPositionPda,
  deriveBorrowPositionPda,
  deriveLendingPoolPda,
  LGUSD_MINT,
} from "./program-actions";

export const ASSET_BTC = 0;
export const PRICE_SCALE = BigInt("100000000");
export const LGUSD_SCALE = BigInt("1000000");
export const SATOSHIS_PER_BTC = BigInt("100000000");
export const RAY = BigInt("1000000000000000000"); // 1e18

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

export interface BtcVaultAccount {
  vaultId: PublicKey;
  owner: PublicKey;
  ikaDwallet: PublicKey;
  dwalletPubkey: Uint8Array;
  bitcoinAddress: string;
  depositedSatoshis: bigint;
  lastAttestationSlot: bigint;
  proofStatus: number;
  proofTimestamp: number;
  frozen: boolean;
  liquidationInitiatedAt: number;
  liquidationSighash: Uint8Array;
  bump: number;
}

export interface BitcoinBalanceAttestationAccount {
  btcVault: PublicKey;
  bitcoinAddress: string;
  satoshis: bigint;
  bitcoinBlockHeight: bigint;
  bitcoinBlockHash: Uint8Array;
  attestedAtSlot: bigint;
  attestedAtUnix: number;
  keeper: PublicKey;
  bump: number;
}

export const LENDING_POOL_LEN =
  8 + 32 + 32 + 32 + 8 + 8 + 32 + 2 + 2 + 2 + 1 + 16 + 8 + 2 + 2 + 1;
export const ADMIN_PRICE_FEED_LEN = 8 + 1 + 8 + 8 + 32 + 1;
export const BORROW_POSITION_LEN =
  8 + 32 + 32 + 32 + 8 + 8 + 8 + 16 + 32 + 1;
export const BTC_VAULT_LEN =
  8 + 32 + 32 + 32 + 33 + 64 + 1 + 8 + 8 + 1 + 8 + 1 + 8 + 32 + 1;
export const BTC_ATTESTATION_LEN =
  8 + 32 + 64 + 1 + 8 + 8 + 32 + 8 + 8 + 32 + 1;

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

export async function readBtcVault(
  connection: Connection,
  btcVaultPda: PublicKey,
): Promise<{
  btcVaultPda: PublicKey;
  btcVault: BtcVaultAccount | null;
  btcAttestationPda: PublicKey;
  btcAttestation: BitcoinBalanceAttestationAccount | null;
  borrowPositionPda: PublicKey;
  borrowPosition: BorrowPositionAccount | null;
}> {
  const [btcAttestationPda] = deriveBtcAttestationPda(btcVaultPda);
  const [borrowPositionPda] = deriveBtcBorrowPositionPda(btcVaultPda);
  const [vaultInfo, attestInfo, positionInfo] = await Promise.all([
    connection.getAccountInfo(btcVaultPda),
    connection.getAccountInfo(btcAttestationPda),
    connection.getAccountInfo(borrowPositionPda),
  ]);
  return {
    btcVaultPda,
    btcVault: vaultInfo ? decodeBtcVault(vaultInfo.data) : null,
    btcAttestationPda,
    btcAttestation: attestInfo ? decodeBitcoinBalanceAttestation(attestInfo.data) : null,
    borrowPositionPda,
    borrowPosition: positionInfo ? decodeBorrowPosition(positionInfo.data) : null,
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

export function decodeBtcVault(data: Buffer): BtcVaultAccount | null {
  if (data.length < BTC_VAULT_LEN) return null;
  let off = 8;
  const vaultId = new PublicKey(data.subarray(off, off + 32));
  off += 32;
  const owner = new PublicKey(data.subarray(off, off + 32));
  off += 32;
  const ikaDwallet = new PublicKey(data.subarray(off, off + 32));
  off += 32;
  const dwalletPubkey = new Uint8Array(data.subarray(off, off + 33));
  off += 33;
  const addressBytes = data.subarray(off, off + 64);
  off += 64;
  const bitcoinAddressLen = data[off];
  off += 1;
  const bitcoinAddress = new TextDecoder().decode(
    addressBytes.subarray(0, bitcoinAddressLen),
  );
  const depositedSatoshis = data.readBigUInt64LE(off);
  off += 8;
  const lastAttestationSlot = data.readBigUInt64LE(off);
  off += 8;
  const proofStatus = data[off];
  off += 1;
  const proofTimestamp = Number(data.readBigInt64LE(off));
  off += 8;
  const frozen = data[off] === 1;
  off += 1;
  const liquidationInitiatedAt = Number(data.readBigInt64LE(off));
  off += 8;
  const liquidationSighash = new Uint8Array(data.subarray(off, off + 32));
  off += 32;
  const bump = data[off];
  return {
    vaultId,
    owner,
    ikaDwallet,
    dwalletPubkey,
    bitcoinAddress,
    depositedSatoshis,
    lastAttestationSlot,
    proofStatus,
    proofTimestamp,
    frozen,
    liquidationInitiatedAt,
    liquidationSighash,
    bump,
  };
}

export function decodeBitcoinBalanceAttestation(
  data: Buffer,
): BitcoinBalanceAttestationAccount | null {
  if (data.length < BTC_ATTESTATION_LEN) return null;
  let off = 8;
  const btcVault = new PublicKey(data.subarray(off, off + 32));
  off += 32;
  const addressBytes = data.subarray(off, off + 64);
  off += 64;
  const bitcoinAddressLen = data[off];
  off += 1;
  const bitcoinAddress = new TextDecoder().decode(
    addressBytes.subarray(0, bitcoinAddressLen),
  );
  const satoshis = data.readBigUInt64LE(off);
  off += 8;
  const bitcoinBlockHeight = data.readBigUInt64LE(off);
  off += 8;
  const bitcoinBlockHash = new Uint8Array(data.subarray(off, off + 32));
  off += 32;
  const attestedAtSlot = data.readBigUInt64LE(off);
  off += 8;
  const attestedAtUnix = Number(data.readBigInt64LE(off));
  off += 8;
  const keeper = new PublicKey(data.subarray(off, off + 32));
  off += 32;
  const bump = data[off];
  return {
    btcVault,
    bitcoinAddress,
    satoshis,
    bitcoinBlockHeight,
    bitcoinBlockHash,
    attestedAtSlot,
    attestedAtUnix,
    keeper,
    bump,
  };
}

function readBigUInt128LE(buf: Buffer, off: number): bigint {
  const lo = buf.readBigUInt64LE(off);
  const hi = buf.readBigUInt64LE(off + 8);
  return (hi << BigInt(64)) | lo;
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
  const COLLATERAL_DECIMALS = BigInt("1000000000");
  const collateralValueBorrowUnits =
    (((depositedLamports * priceUsd) / COLLATERAL_DECIMALS) * LGUSD_SCALE) /
    PRICE_SCALE;
  const liquidationValue =
    (collateralValueBorrowUnits * BigInt(liquidationThresholdBps)) / BigInt(10_000);
  return debt > liquidationValue;
}

export function formatBtc(satoshis: bigint): string {
  const whole = satoshis / SATOSHIS_PER_BTC;
  const frac = satoshis % SATOSHIS_PER_BTC;
  const fracText = frac.toString().padStart(8, "0").replace(/0+$/, "");
  return fracText ? `${whole}.${fracText}` : whole.toString();
}

export function isBtcLiquidatable(
  satoshis: bigint,
  priceUsd: bigint,
  debt: bigint,
  liquidationThresholdBps: number,
): boolean {
  const collateralValueBorrowUnits =
    (((satoshis * priceUsd) / SATOSHIS_PER_BTC) * LGUSD_SCALE) / PRICE_SCALE;
  const liquidationValue =
    (collateralValueBorrowUnits * BigInt(liquidationThresholdBps)) / BigInt(10_000);
  return debt > liquidationValue;
}
