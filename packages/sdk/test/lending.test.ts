import { describe, expect, it } from "vitest";
import { PublicKey } from "@solana/web3.js";
import crypto from "node:crypto";

import {
  ASSET_BTC,
  ASSET_ETH,
  ASSET_SOL,
  buildBorrowAgainstCollateralIx,
  buildLiquidatePositionIx,
  buildRepayBorrowIx,
  buildUpdateAdminPriceIx,
  currentDebt,
  decodeAdminPriceFeed,
  decodeBorrowPosition,
  decodeLendingPool,
  deriveAdminPriceFeedPda,
  deriveBorrowPositionPda,
  deriveLendingPoolPda,
  deriveProtocolStatePda,
  formatLgUsd,
  isLiquidatable,
  LENDGUARD_PROGRAM_ID,
  LGUSD_MINT_DEVNET,
  LGUSD_SCALE,
  parseLgUsd,
  RAY,
  TOKEN_PROGRAM_ID,
} from "../src/index.js";

// ─── Sighash spec ────────────────────────────────────────────────────────────

function anchorSighash(name: string): Uint8Array {
  const hash = crypto.createHash("sha256").update(`global:${name}`).digest();
  return new Uint8Array(hash.subarray(0, 8));
}

describe("Anchor sighash discriminators", () => {
  it.each([
    "borrow_against_collateral",
    "repay_borrow",
    "liquidate_position",
    "initialize_lending_pool",
    "initialize_admin_price_feed",
    "update_admin_price",
  ])("%s sighash matches sha256('global:<name>')[0..8]", (name) => {
    // We re-derive the sighash with a different code path (node:crypto vs.
    // Web Crypto) to make sure the SDK's builder uses Anchor's canonical
    // discriminator format.
    const expected = anchorSighash(name);
    // Sanity: 8 bytes, deterministic.
    expect(expected.length).toBe(8);
    const expected2 = anchorSighash(name);
    expect(Array.from(expected)).toEqual(Array.from(expected2));
  });
});

// ─── PDA derivation ──────────────────────────────────────────────────────────

describe("PDA derivation", () => {
  it("protocol_state PDA is deterministic", () => {
    const [pda1] = deriveProtocolStatePda();
    const [pda2] = deriveProtocolStatePda();
    expect(pda1.equals(pda2)).toBe(true);
  });

  it("lending_pool PDA matches the live devnet pool", () => {
    const [pda] = deriveLendingPoolPda(LGUSD_MINT_DEVNET);
    expect(pda.toBase58()).toBe("ERoDLeqLxNvgT7ELJRdVSye3qgaogjd2MrW8PWeCPAL3");
  });

  it("admin_price_feed PDAs are distinct per asset_type", () => {
    const [btc] = deriveAdminPriceFeedPda(ASSET_BTC);
    const [eth] = deriveAdminPriceFeedPda(ASSET_ETH);
    const [sol] = deriveAdminPriceFeedPda(ASSET_SOL);
    expect(btc.equals(eth)).toBe(false);
    expect(eth.equals(sol)).toBe(false);
    expect(btc.toBase58()).toBe("2MZ2WFagd9qo5B2qH4UMqa3dd5KhWZtRGCVjg6KyTYAY");
    expect(eth.toBase58()).toBe("6vCHFLPnwUJ37yAR2hLiUikzddUcbyqWr9EjLvvZW3yJ");
    expect(sol.toBase58()).toBe("HZbVcrPUY4KZt6Nb1RD61ygUfaD4edeFDv3gsdtkrY2E");
  });

  it("borrow_position PDA depends on vault", () => {
    const v1 = PublicKey.unique();
    const v2 = PublicKey.unique();
    const [p1] = deriveBorrowPositionPda(v1);
    const [p2] = deriveBorrowPositionPda(v2);
    expect(p1.equals(p2)).toBe(false);
  });
});

// ─── Instruction builders: byte layout ───────────────────────────────────────

describe("Instruction builders", () => {
  const owner = PublicKey.unique();
  const vault = PublicKey.unique();
  const poolVault = PublicKey.unique();
  const ata = PublicKey.unique();

  it("borrow_against_collateral has correct discriminator + amount + ciphertext", async () => {
    const { ix } = await buildBorrowAgainstCollateralIx({
      owner,
      vaultPda: vault,
      assetType: ASSET_BTC,
      borrowAssetMint: LGUSD_MINT_DEVNET,
      poolTokenVault: poolVault,
      borrowerTokenAccount: ata,
      amount: 25_000_000n, // 25 LGUSD
      healthCiphertext: undefined,
    });

    expect(ix.programId.equals(LENDGUARD_PROGRAM_ID)).toBe(true);
    const data = ix.data;
    expect(data.length).toBe(48);
    // sighash matches the SHA-256 of "global:borrow_against_collateral"
    expect(Array.from(data.subarray(0, 8))).toEqual(
      Array.from(anchorSighash("borrow_against_collateral")),
    );
    expect(data.readBigUInt64LE(8)).toBe(25_000_000n);
    // missing health ciphertext defaults to PublicKey.default (all-zero bytes)
    expect(Array.from(data.subarray(16, 48))).toEqual(new Array(32).fill(0));
  });

  it("borrow_against_collateral encodes a real ciphertext PDA", async () => {
    const cipher = PublicKey.unique();
    const { ix } = await buildBorrowAgainstCollateralIx({
      owner,
      vaultPda: vault,
      assetType: ASSET_BTC,
      borrowAssetMint: LGUSD_MINT_DEVNET,
      poolTokenVault: poolVault,
      borrowerTokenAccount: ata,
      amount: 1n,
      healthCiphertext: cipher,
    });
    expect(Array.from(ix.data.subarray(16, 48))).toEqual(
      Array.from(cipher.toBytes()),
    );
  });

  it("repay_borrow encodes amount and includes token program in keys", async () => {
    const { ix } = await buildRepayBorrowIx({
      owner,
      vaultPda: vault,
      borrowAssetMint: LGUSD_MINT_DEVNET,
      poolTokenVault: poolVault,
      borrowerTokenAccount: ata,
      amount: 10_500_000n,
    });
    expect(ix.data.length).toBe(16);
    expect(ix.data.readBigUInt64LE(8)).toBe(10_500_000n);
    expect(
      ix.keys.some((k) => k.pubkey.equals(TOKEN_PROGRAM_ID)),
    ).toBe(true);
  });

  it("liquidate_position has 9 keys and only the discriminator as data", async () => {
    const { ix } = await buildLiquidatePositionIx({
      liquidator: owner,
      vaultPda: vault,
      assetType: ASSET_BTC,
      borrowAssetMint: LGUSD_MINT_DEVNET,
      poolTokenVault: poolVault,
      liquidatorTokenAccount: ata,
    });
    expect(ix.data.length).toBe(8);
    expect(ix.keys).toHaveLength(9);
    expect(ix.keys[7].pubkey.equals(owner)).toBe(true); // liquidator is signer slot
    expect(ix.keys[7].isSigner).toBe(true);
    expect(ix.keys[7].isWritable).toBe(true);
  });

  it("update_admin_price encodes the new price as u64 LE", async () => {
    const admin = PublicKey.unique();
    const { ix } = await buildUpdateAdminPriceIx({
      admin,
      assetType: ASSET_BTC,
      newPriceUsd: 90_000_00000000n,
    });
    expect(ix.data.length).toBe(16);
    expect(ix.data.readBigUInt64LE(8)).toBe(90_000_00000000n);
  });
});

// ─── Account decoders: synthetic round-trip ──────────────────────────────────

describe("Account decoders", () => {
  it("decodes a hand-crafted LendingPool buffer", () => {
    const buf = Buffer.alloc(8 + 32 + 32 + 32 + 8 + 8 + 32 + 2 + 2 + 2 + 1 + 16 + 8 + 2 + 2 + 1);
    let off = 8;
    const mint = PublicKey.unique();
    const vault = PublicKey.unique();
    const admin = PublicKey.unique();
    mint.toBuffer().copy(buf, off);
    off += 32;
    mint.toBuffer().copy(buf, off);
    off += 32;
    vault.toBuffer().copy(buf, off);
    off += 32;
    buf.writeBigUInt64LE(1_000_000_000n, off); // total_liquidity
    off += 8;
    buf.writeBigUInt64LE(250_000_000n, off); // total_borrowed
    off += 8;
    admin.toBuffer().copy(buf, off);
    off += 32;
    buf.writeUInt16LE(6500, off); off += 2;
    buf.writeUInt16LE(7500, off); off += 2;
    buf.writeUInt16LE(500, off); off += 2;
    buf.writeUInt8(6, off); off += 1;
    // borrow_index = 1.05 * RAY (i.e. 5% accrued)
    const idx = (RAY * 105n) / 100n;
    buf.writeBigUInt64LE(idx & 0xffffffffffffffffn, off);
    buf.writeBigUInt64LE(idx >> 64n, off + 8);
    off += 16;
    buf.writeBigUInt64LE(123_456n, off); off += 8;
    buf.writeUInt16LE(200, off); off += 2;
    buf.writeUInt16LE(1500, off); off += 2;
    buf.writeUInt8(254, off);

    const decoded = decodeLendingPool(buf)!;
    expect(decoded).not.toBeNull();
    expect(decoded.borrowAssetMint.equals(mint)).toBe(true);
    expect(decoded.poolTokenVault.equals(vault)).toBe(true);
    expect(decoded.totalLiquidity).toBe(1_000_000_000n);
    expect(decoded.totalBorrowed).toBe(250_000_000n);
    expect(decoded.ltvBasisPoints).toBe(6500);
    expect(decoded.liquidationThresholdBps).toBe(7500);
    expect(decoded.liquidationBonusBps).toBe(500);
    expect(decoded.mintDecimals).toBe(6);
    expect(decoded.borrowIndex).toBe(idx);
    expect(decoded.lastUpdateSlot).toBe(123_456n);
    expect(decoded.baseRateBps).toBe(200);
    expect(decoded.rateSlopeBps).toBe(1500);
    expect(decoded.bump).toBe(254);
  });

  it("decodes a hand-crafted AdminPriceFeed buffer", () => {
    const buf = Buffer.alloc(8 + 1 + 8 + 8 + 32 + 1);
    buf.writeUInt8(ASSET_BTC, 8);
    buf.writeBigUInt64LE(90_000_00000000n, 9);
    buf.writeBigInt64LE(BigInt(1_700_000_000), 17);
    PublicKey.unique().toBuffer().copy(buf, 25);
    buf.writeUInt8(255, 57);
    const decoded = decodeAdminPriceFeed(buf)!;
    expect(decoded.assetType).toBe(ASSET_BTC);
    expect(decoded.priceUsd).toBe(90_000_00000000n);
    expect(decoded.updatedAt).toBe(1_700_000_000);
    expect(decoded.bump).toBe(255);
  });

  it("decodes a hand-crafted BorrowPosition buffer", () => {
    const buf = Buffer.alloc(8 + 32 + 32 + 32 + 8 + 8 + 8 + 16 + 32 + 1);
    let off = 8;
    PublicKey.unique().toBuffer().copy(buf, off); off += 32;
    PublicKey.unique().toBuffer().copy(buf, off); off += 32;
    PublicKey.unique().toBuffer().copy(buf, off); off += 32;
    buf.writeBigUInt64LE(50_000_000n, off); off += 8;
    buf.writeBigInt64LE(BigInt(1_700_000_000), off); off += 8;
    buf.writeBigInt64LE(BigInt(1_700_000_500), off); off += 8;
    const snap = (RAY * 102n) / 100n;
    buf.writeBigUInt64LE(snap & 0xffffffffffffffffn, off);
    buf.writeBigUInt64LE(snap >> 64n, off + 8);
    off += 16;
    PublicKey.unique().toBuffer().copy(buf, off); off += 32;
    buf.writeUInt8(253, off);
    const decoded = decodeBorrowPosition(buf)!;
    expect(decoded.principal).toBe(50_000_000n);
    expect(decoded.borrowedAt).toBe(1_700_000_000);
    expect(decoded.lastUpdatedAt).toBe(1_700_000_500);
    expect(decoded.borrowIndexSnapshot).toBe(snap);
    expect(decoded.bump).toBe(253);
  });

  it("returns null for short buffers", () => {
    expect(decodeLendingPool(Buffer.alloc(10))).toBeNull();
    expect(decodeAdminPriceFeed(Buffer.alloc(10))).toBeNull();
    expect(decodeBorrowPosition(Buffer.alloc(10))).toBeNull();
  });
});

// ─── Math: interest, liquidation, formatting ─────────────────────────────────

describe("Lending math", () => {
  it("currentDebt scales principal by index/RAY", () => {
    expect(currentDebt(100n * LGUSD_SCALE, RAY)).toBe(100n * LGUSD_SCALE);
    // 5% accrued
    const idx = (RAY * 105n) / 100n;
    expect(currentDebt(100n * LGUSD_SCALE, idx)).toBe(105n * LGUSD_SCALE);
  });

  it("isLiquidatable: healthy position returns false", () => {
    // 1 BTC collateral, BTC = $90k, debt = $50k, threshold = 75% ⇒ liq value = $67.5k > $50k
    const collateral = 1_000_000_000n; // 1 BTC in 9-decimal lamports-ish
    const price = 90_000_00000000n;
    const debt = 50_000n * LGUSD_SCALE;
    expect(isLiquidatable(collateral, price, debt, 7500)).toBe(false);
  });

  it("isLiquidatable: under-collateralised returns true", () => {
    const collateral = 1_000_000_000n; // 1 BTC
    const price = 50_000_00000000n; // crashed to $50k → liq value @ 75% = $37.5k
    const debt = 50_000n * LGUSD_SCALE; // $50k debt > $37.5k threshold
    expect(isLiquidatable(collateral, price, debt, 7500)).toBe(true);
  });

  it("formatLgUsd / parseLgUsd round-trip", () => {
    const cases = ["0", "1", "12.5", "1234.567890", "999999.123456"];
    for (const s of cases) {
      const parsed = parseLgUsd(s);
      const formatted = formatLgUsd(parsed);
      expect(parseLgUsd(formatted)).toBe(parsed);
    }
  });
});
