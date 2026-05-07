/**
 * Ika dWallet program PDA derivations.
 *
 * Mirrors the seeds used by the Ika dWallet program at
 * `87W54kGYFQ1rgWqMeu4XTPHWXWmXSQCcjm8vCTfiq1oY`. Sources:
 *   - https://solana-pre-alpha.ika.xyz/on-chain/
 *   - chains/solana/program-sdk/anchor/src/lib.rs (`CPI_AUTHORITY_SEED`)
 *   - chains/solana/examples/voting/native/tests/litesvm.rs (canonical seeds)
 */

import { PublicKey } from "@solana/web3.js";

import { IKA_PROGRAM_ID } from "./ika-client";
import { PROGRAM_ID as LENDGUARD_PROGRAM_ID } from "./lendguard-client";

/** Seed for the LendGuard CPI authority PDA on the Ika dWallet program. */
export const IKA_CPI_AUTHORITY_SEED = Buffer.from("__ika_cpi_authority");

const DWALLET_COORDINATOR_SEED = Buffer.from("dwallet_coordinator");
const DWALLET_SEED = Buffer.from("dwallet");
const MESSAGE_APPROVAL_SEED = Buffer.from("message_approval");

/**
 * `LendGuard CPI authority PDA` — what the Ika dWallet program expects when
 * LendGuard performs a CPI (`invoke_signed`) into `approve_message`.
 *
 * Seed: `[b"__ika_cpi_authority"]`, program: LendGuard.
 */
export function deriveIkaCpiAuthorityPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [IKA_CPI_AUTHORITY_SEED],
    LENDGUARD_PROGRAM_ID,
  );
}

/**
 * `DWalletCoordinator PDA` on the Ika dWallet program. Singleton, holds the
 * current epoch and the global authority pubkey.
 */
export function deriveDwalletCoordinatorPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [DWALLET_COORDINATOR_SEED],
    IKA_PROGRAM_ID,
  );
}

/**
 * dWallet account PDA. Seed = `[b"dwallet", chunks_of_32(curve_byte || pubkey)]`.
 *
 * - `curve` is one byte (Curve25519=0, Secp256k1=1, Secp256r1=2 — see
 *   chain spec). The on-chain program packs `curve || pubkey` into a single
 *   buffer, then splits into 32-byte chunks because Solana's `MAX_SEED_LEN`
 *   is 32 bytes per individual seed.
 * - The dWallet's address depends on `(curve, pubkey)` so the same key
 *   always derives the same PDA across all clients.
 */
export function deriveDwalletPda(
  curve: number,
  publicKey: Uint8Array,
): [PublicKey, number] {
  const payload = new Uint8Array(1 + publicKey.length);
  payload[0] = curve & 0xff;
  payload.set(publicKey, 1);

  const seeds: Buffer[] = [DWALLET_SEED];
  for (let i = 0; i < payload.length; i += 32) {
    seeds.push(Buffer.from(payload.slice(i, Math.min(i + 32, payload.length))));
  }
  return PublicKey.findProgramAddressSync(seeds, IKA_PROGRAM_ID);
}

/**
 * `MessageApproval` PDA derivation. Seed = `[b"message_approval", dwallet_pubkey, message_digest]`.
 *
 * Idempotency: the same `(dwallet, message_digest)` pair always derives the
 * same PDA. Trying to create one that already exists fails (the dWallet
 * program enforces it must be empty), which prevents duplicate signing
 * requests.
 *
 * Note: the docs show extra seed components (`scheme`, `message_metadata_digest`)
 * for the more complex layout. The voting LiteSVM tests use the simpler
 * 3-seed form; we mirror that here.
 */
export function deriveMessageApprovalPda(
  dwallet: PublicKey,
  messageDigest: Uint8Array,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [MESSAGE_APPROVAL_SEED, dwallet.toBuffer(), Buffer.from(messageDigest)],
    IKA_PROGRAM_ID,
  );
}

/** Curve byte → human label, for logging. */
export const CURVE_LABELS: Record<number, string> = {
  0: "Curve25519",
  1: "Secp256k1",
  2: "Secp256r1",
};

/** Signature scheme u16 → human label, for logging. */
export const SIGNATURE_SCHEME_LABELS: Record<number, string> = {
  0: "Ed25519",
  1: "Secp256k1",
  2: "Secp256r1",
};
