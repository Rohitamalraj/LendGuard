/**
 * Real Ika dWallet pre-alpha integration via gRPC-Web.
 *
 * This module talks to the live Ika dWallet executor at
 * `pre-alpha-dev-1.ika.ika-network.net:443` using
 * `@ika.xyz/pre-alpha-solana-client/grpc-web` (fetch-based, no proxy).
 *
 * The Ika network exposes a single `submitTransaction` endpoint over gRPC.
 * The wrapper SDK provides three high-level operations:
 *
 *   1. `requestDKG(senderPubkey)` -> `{ dwalletAddr, publicKey }`
 *      Runs Distributed Key Generation. The 32-byte `dwalletAddr` is the
 *      identifier you pass to `register_vault` on LendGuard.
 *
 *   2. `requestPresign(senderPubkey, dwalletAddr)` -> `presignId`
 *      Pre-computes a one-shot signing nonce so subsequent signatures are
 *      cheap. Required before each `requestSign`.
 *
 *   3. `requestSign(senderPubkey, dwalletAddr, message, presignId, txSig)` ->
 *      `signature`. The Ika network signs the message and (per the docs)
 *      writes the signature on-chain into the `MessageApproval` PDA via the
 *      `CommitSignature` instruction.
 *
 * Notes / limitations (pre-alpha):
 * - Signing uses a single mock signer, not real distributed MPC. The wire
 *   format is final but the trust model is not.
 * - The dwallet program & all pre-alpha accounts are wiped periodically.
 * - The browser SDK's `requestSign` requires the on-chain `MessageApproval`
 *   PDA to exist first (created by the `approve_message` instruction). We
 *   currently do NOT call `approve_message` from the browser — the LendGuard
 *   demo creates a byte-compatible mock via the program's `demo_create_*`
 *   helper while the `approve_message` instruction-builder is wired up. The
 *   on-chain MessageApproval parser autodetects both layouts so the rest of
 *   the LendGuard flow can transition seamlessly.
 *
 * Env vars (web/.env.local):
 *   NEXT_PUBLIC_IKA_GRPC_URL  default: https://pre-alpha-dev-1.ika.ika-network.net:443
 *   NEXT_PUBLIC_IKA_PROGRAM   default: 87W54kGYFQ1rgWqMeu4XTPHWXWmXSQCcjm8vCTfiq1oY
 */

import { PublicKey } from "@solana/web3.js";
import {
  createIkaWebClient,
  type IkaDWalletWebClient,
  type DKGResult,
} from "@ika.xyz/pre-alpha-solana-client/grpc-web";

// ─── Constants ───────────────────────────────────────────────────────────────

export const IKA_GRPC_URL =
  process.env.NEXT_PUBLIC_IKA_GRPC_URL ??
  "https://pre-alpha-dev-1.ika.ika-network.net:443";

export const IKA_PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_IKA_PROGRAM ??
    "87W54kGYFQ1rgWqMeu4XTPHWXWmXSQCcjm8vCTfiq1oY",
);

/** Discriminator byte that opens a real Ika `MessageApproval` account (offset 0). */
export const REAL_MESSAGE_APPROVAL_DISCRIMINATOR = 14;

// ─── Client factory (lazy, browser-only) ─────────────────────────────────────

let cachedClient: IkaDWalletWebClient | null = null;

function getClient(): IkaDWalletWebClient {
  if (typeof window === "undefined") {
    throw new Error("Ika gRPC-Web client can only be created in the browser.");
  }
  if (!cachedClient) {
    cachedClient = createIkaWebClient(IKA_GRPC_URL);
  }
  return cachedClient;
}

// ─── Public API ──────────────────────────────────────────────────────────────

export interface RequestDkgResult {
  /** 32-byte dWallet identifier (used as `dwallet_id` in LendGuard `register_vault`). */
  dwalletAddr: Uint8Array;
  /** dWallet public key bytes (variable length depending on curve). */
  publicKey: Uint8Array;
}

/**
 * Run distributed key generation against the Ika network. Returns the new
 * dWallet identifier you can pass to LendGuard's `register_vault`.
 */
export async function requestDkg(
  senderPubkey: PublicKey,
): Promise<RequestDkgResult> {
  const client = getClient();
  const result: DKGResult = await client.requestDKG(senderPubkey.toBytes());
  return {
    dwalletAddr: new Uint8Array(result.dwalletAddr),
    publicKey: new Uint8Array(result.publicKey),
  };
}

/**
 * Pre-compute a signing nonce for a dWallet. Required before each `requestSign`.
 */
export async function requestPresign(
  senderPubkey: PublicKey,
  dwalletAddr: Uint8Array,
): Promise<Uint8Array> {
  const client = getClient();
  const presignId = await client.requestPresign(
    senderPubkey.toBytes(),
    dwalletAddr,
  );
  return new Uint8Array(presignId);
}

/**
 * Ask the Ika network to sign `message` using the given dWallet+presign.
 *
 * Per the Ika docs the network writes the signature into the on-chain
 * `MessageApproval` PDA via `CommitSignature` and also returns the bytes here.
 * `txSignature` is the Solana tx signature of the user-signed
 * `approve_message` call that created the MessageApproval; the network uses
 * it as the `ApprovalProof`.
 */
export async function requestSign(
  senderPubkey: PublicKey,
  dwalletAddr: Uint8Array,
  message: Uint8Array,
  presignId: Uint8Array,
  txSignature: Uint8Array,
): Promise<Uint8Array> {
  const client = getClient();
  const sig = await client.requestSign(
    senderPubkey.toBytes(),
    dwalletAddr,
    message,
    presignId,
    txSignature,
  );
  return new Uint8Array(sig);
}

// ─── Types re-exported for callers ───────────────────────────────────────────

export type { IkaDWalletWebClient, DKGResult };
