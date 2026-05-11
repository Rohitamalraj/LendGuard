/**
 * Anchor-compatible transaction builders for the LendGuard lending protocol.
 *
 * These are framework-agnostic — no Anchor runtime needed. They produce raw
 * `TransactionInstruction`s that you can assemble into a `Transaction` and
 * sign with any wallet that exposes a `signTransaction` method.
 */
import { PublicKey, SystemProgram, TransactionInstruction, } from "@solana/web3.js";
import { ASSOCIATED_TOKEN_PROGRAM_ID, deriveAdminPriceFeedPda, deriveAssociatedTokenAddress, deriveBorrowPositionPda, deriveLendingPoolPda, deriveProtocolStatePda, LENDGUARD_PROGRAM_ID, TOKEN_PROGRAM_ID, } from "./constants.js";
// ─── Helpers ─────────────────────────────────────────────────────────────────
async function sighash(name) {
    const data = new TextEncoder().encode(`global:${name}`);
    const hash = await crypto.subtle.digest("SHA-256", data);
    return new Uint8Array(hash).slice(0, 8);
}
function concat(...arrays) {
    const total = arrays.reduce((acc, a) => acc + a.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const a of arrays) {
        out.set(a, offset);
        offset += a.length;
    }
    return out;
}
function u64ToLe(value) {
    const buf = new Uint8Array(8);
    new DataView(buf.buffer).setBigUint64(0, value, true);
    return buf;
}
function u16ToLe(value) {
    const buf = new Uint8Array(2);
    new DataView(buf.buffer).setUint16(0, value, true);
    return buf;
}
// ─── Borrower / liquidator side ──────────────────────────────────────────────
/**
 * ATA program "createIdempotent" instruction. Use to ensure a borrower or
 * liquidator has an LGUSD token account before transfers.
 */
export function buildCreateAssociatedTokenAccountIx(params) {
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
export async function buildBorrowAgainstCollateralIx(params) {
    const programId = params.programId ?? LENDGUARD_PROGRAM_ID;
    const [protocolStatePda] = deriveProtocolStatePda(programId);
    const [lendingPoolPda] = deriveLendingPoolPda(params.borrowAssetMint, programId);
    const [priceFeedPda] = deriveAdminPriceFeedPda(params.assetType, programId);
    const [borrowPositionPda] = deriveBorrowPositionPda(params.vaultPda, programId);
    const data = concat(await sighash("borrow_against_collateral"), u64ToLe(params.amount), (params.healthCiphertext ?? PublicKey.default).toBuffer());
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
export async function buildRepayBorrowIx(params) {
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
export async function buildLiquidatePositionIx(params) {
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
export async function buildUpdateAdminPriceIx(params) {
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
export async function buildInitializeLendingPoolIx(params) {
    const programId = params.programId ?? LENDGUARD_PROGRAM_ID;
    const [lendingPoolPda] = deriveLendingPoolPda(params.borrowAssetMint, programId);
    const [priceFeedPda] = deriveAdminPriceFeedPda(params.assetType, programId);
    const data = concat(await sighash("initialize_lending_pool"), new Uint8Array([params.assetType & 0xff]), u64ToLe(params.initialLiquidity), u64ToLe(params.initialPriceUsd), u16ToLe(params.ltvBasisPoints), u16ToLe(params.liquidationThresholdBps), u16ToLe(params.liquidationBonusBps), u16ToLe(params.baseRateBps), u16ToLe(params.rateSlopeBps));
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
export async function buildInitializeAdminPriceFeedIx(params) {
    const programId = params.programId ?? LENDGUARD_PROGRAM_ID;
    const [priceFeedPda] = deriveAdminPriceFeedPda(params.assetType, programId);
    const data = concat(await sighash("initialize_admin_price_feed"), new Uint8Array([params.assetType & 0xff]), u64ToLe(params.initialPriceUsd));
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
