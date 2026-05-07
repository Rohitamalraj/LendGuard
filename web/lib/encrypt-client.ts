/**
 * Real Encrypt pre-alpha integration via gRPC-Web.
 *
 * This module talks to the live Encrypt executor at
 * `pre-alpha-dev-1.encrypt.ika-network.net:443` from the browser using
 * `@encrypt.xyz/pre-alpha-solana-client/grpc-web` (fetch-based, no proxy).
 *
 * `createEncryptInput()` calls the Encrypt network's gRPC service which:
 *   1. Validates the (mock) ciphertext bytes & ZK proof
 *   2. Signs a Solana transaction creating a ciphertext PDA on-chain
 *   3. Returns the on-chain ciphertext pubkey(s)
 *
 * The resulting accounts live under the Encrypt program
 * (`4ebfzWdKnrnGseuQpezXdG8yCdHqwQ1SSBHD3bWArND8`) and can be read by any
 * program — including LendGuard's `update_backing_state` /
 * `trigger_risk_check`, which currently only need the pubkey for state
 * tracking.
 *
 * Env vars (web/.env.local):
 *   NEXT_PUBLIC_ENCRYPT_GRPC_URL  default: https://pre-alpha-dev-1.encrypt.ika-network.net:443
 *   NEXT_PUBLIC_ENCRYPT_PROGRAM   default: 4ebfzWdKnrnGseuQpezXdG8yCdHqwQ1SSBHD3bWArND8
 */

import { PublicKey } from "@solana/web3.js";
import {
  createEncryptWebClient,
  encryptValue,
  Chain,
} from "@encrypt.xyz/pre-alpha-solana-client/grpc-web";

// ─── Constants ───────────────────────────────────────────────────────────────

export const ENCRYPT_GRPC_URL =
  process.env.NEXT_PUBLIC_ENCRYPT_GRPC_URL ??
  "https://pre-alpha-dev-1.encrypt.ika-network.net:443";

export const ENCRYPT_PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_ENCRYPT_PROGRAM ??
    "4ebfzWdKnrnGseuQpezXdG8yCdHqwQ1SSBHD3bWArND8",
);

/**
 * In pre-alpha there is no real FHE — the network encryption "key" is a
 * 32-byte placeholder filled with 0x55 (matches every example in the
 * encrypt-pre-alpha repo). When mainnet ships this becomes a real public key.
 */
export const NETWORK_ENCRYPTION_KEY = new Uint8Array(32).fill(0x55);

/** FHE type discriminants used by Encrypt. */
export const FHE_TYPES = {
  EBool: 0,
  EUint8: 1,
  EUint16: 2,
  EUint32: 3,
  EUint64: 4,
} as const;

// ─── Client factory (lazy, browser-only) ─────────────────────────────────────

type EncryptWebClient = ReturnType<typeof createEncryptWebClient>;
let cachedClient: EncryptWebClient | null = null;

function getClient(): EncryptWebClient {
  if (typeof window === "undefined") {
    throw new Error(
      "Encrypt gRPC-Web client can only be created in the browser.",
    );
  }
  if (!cachedClient) {
    cachedClient = createEncryptWebClient(ENCRYPT_GRPC_URL);
  }
  return cachedClient;
}

// ─── Public API ──────────────────────────────────────────────────────────────

export interface CreateEncryptInputParams {
  /** Plaintext value to encrypt. Will be passed through `encryptValue()`. */
  value: number | bigint;
  /** FHE type — defaults to EUint64. */
  fheType?: number;
  /**
   * Program (or wallet) authorized to use this ciphertext as input.
   * For LendGuard, this is the LendGuard program ID so only our program
   * can reference these ciphertexts.
   */
  authorizedProgram: PublicKey;
}

/**
 * Submit one encrypted value to the Encrypt network. Returns the pubkey of the
 * on-chain ciphertext account created by the executor.
 *
 * The whole request goes over gRPC-Web (TLS, fetch-based) — the user's wallet
 * never signs anything; the Encrypt executor pays rent and signs the on-chain
 * tx server-side.
 */
export async function createEncryptInput(
  params: CreateEncryptInputParams,
): Promise<PublicKey> {
  const fheType = params.fheType ?? FHE_TYPES.EUint64;
  const ciphertextBytes = encryptValue(params.value, fheType);

  const client = getClient();
  const ids = await client.createInput({
    chain: Chain.SOLANA,
    inputs: [{ ciphertextBytes, fheType }],
    authorized: params.authorizedProgram.toBytes(),
    networkEncryptionPublicKey: NETWORK_ENCRYPTION_KEY,
  });

  if (!ids || ids.length === 0) {
    throw new Error("Encrypt executor returned no ciphertext identifiers");
  }
  return new PublicKey(ids[0]);
}

/**
 * Batch variant — submit multiple inputs in one gRPC call.
 * Returns one pubkey per input, in the same order.
 */
export async function createEncryptInputs(
  inputs: CreateEncryptInputParams[],
): Promise<PublicKey[]> {
  if (inputs.length === 0) return [];
  const client = getClient();
  const ids = await client.createInput({
    chain: Chain.SOLANA,
    inputs: inputs.map((p) => ({
      ciphertextBytes: encryptValue(p.value, p.fheType ?? FHE_TYPES.EUint64),
      fheType: p.fheType ?? FHE_TYPES.EUint64,
    })),
    // All inputs in one batch must share an `authorized` and network key.
    // We use the first input's authorized program — callers should pass the
    // same program for all batched inputs.
    authorized: inputs[0].authorizedProgram.toBytes(),
    networkEncryptionPublicKey: NETWORK_ENCRYPTION_KEY,
  });
  if (ids.length !== inputs.length) {
    throw new Error(
      `Encrypt executor returned ${ids.length} ids for ${inputs.length} inputs`,
    );
  }
  return ids.map((b) => new PublicKey(b));
}

export { Chain, encryptValue };
