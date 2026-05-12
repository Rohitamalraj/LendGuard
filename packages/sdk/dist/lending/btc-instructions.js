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
import { PublicKey, SystemProgram, TransactionInstruction, } from "@solana/web3.js";
import { deriveAdminPriceFeedPda, deriveBtcAttestationPda, deriveBtcBorrowPositionPda, deriveBtcVaultPda, deriveIkaCpiAuthority, deriveLendingPoolPda, deriveProtocolStatePda, IKA_DWALLET_PROGRAM_ID, LENDGUARD_PROGRAM_ID, TOKEN_PROGRAM_ID, ASSET_BTC, } from "./constants.js";
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
function vecU8(bytes) {
    const out = new Uint8Array(4 + bytes.length);
    new DataView(out.buffer).setUint32(0, bytes.length, true);
    out.set(bytes, 4);
    return out;
}
export async function buildRegisterBtcVaultIx(params) {
    if (params.dwalletPubkey.length !== 33) {
        throw new Error("dwalletPubkey must be 33 bytes (compressed Secp256k1)");
    }
    const programId = params.programId ?? LENDGUARD_PROGRAM_ID;
    const [btcVaultPda] = deriveBtcVaultPda(params.owner, params.ikaDwallet, programId);
    const [btcAttestationPda] = deriveBtcAttestationPda(btcVaultPda, programId);
    const [protocolStatePda] = deriveProtocolStatePda(programId);
    const data = concat(await sighash("register_btc_vault"), params.ikaDwallet.toBuffer(), params.dwalletPubkey, vecU8(new TextEncoder().encode(params.bitcoinAddress)));
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
export async function buildVerifyBtcCustodyProofIx(params) {
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
export async function buildRefreshBtcCustodyProofIx(params) {
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
export async function buildAttestBtcBalanceIx(params) {
    if (params.bitcoinBlockHash.length !== 32) {
        throw new Error("bitcoinBlockHash must be 32 bytes");
    }
    const programId = params.programId ?? LENDGUARD_PROGRAM_ID;
    const [btcAttestationPda] = deriveBtcAttestationPda(params.btcVaultPda, programId);
    const [protocolStatePda] = deriveProtocolStatePda(programId);
    const data = concat(await sighash("attest_btc_balance"), u64ToLe(params.satoshis), u64ToLe(params.bitcoinBlockHeight), params.bitcoinBlockHash);
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
export async function buildBorrowAgainstBtcCollateralIx(params) {
    const programId = params.programId ?? LENDGUARD_PROGRAM_ID;
    const [protocolStatePda] = deriveProtocolStatePda(programId);
    const [lendingPoolPda] = deriveLendingPoolPda(params.borrowAssetMint, programId);
    const [priceFeedPda] = deriveAdminPriceFeedPda(ASSET_BTC, programId);
    const [btcAttestationPda] = deriveBtcAttestationPda(params.btcVaultPda, programId);
    const [borrowPositionPda] = deriveBtcBorrowPositionPda(params.btcVaultPda, programId);
    const data = concat(await sighash("borrow_against_btc_collateral"), u64ToLe(params.amount), (params.healthCiphertext ?? PublicKey.default).toBuffer());
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
export async function buildRepayBtcBorrowIx(params) {
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
export async function buildLiquidateBtcPositionIx(params) {
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
    const data = concat(await sighash("liquidate_btc_position"), params.bitcoinSighash, meta.slice(0, 32), params.userPubkey.slice(0, 32), new Uint8Array([params.messageApprovalBump]));
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
export async function buildFinalizeBtcLiquidationIx(params) {
    if (params.bitcoinTxId.length !== 32) {
        throw new Error("bitcoinTxId must be 32 bytes");
    }
    const programId = params.programId ?? LENDGUARD_PROGRAM_ID;
    const [btcAttestationPda] = deriveBtcAttestationPda(params.btcVaultPda, programId);
    const [borrowPositionPda] = deriveBtcBorrowPositionPda(params.btcVaultPda, programId);
    const [protocolStatePda] = deriveProtocolStatePda(programId);
    const confBytes = new Uint8Array(4);
    new DataView(confBytes.buffer).setUint32(0, params.confirmations, true);
    const data = concat(await sighash("finalize_btc_liquidation"), params.bitcoinTxId, u64ToLe(params.bitcoinBlockHeight), confBytes, u64ToLe(params.remainingSatoshis));
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
