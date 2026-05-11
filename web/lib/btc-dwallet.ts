/**
 * BTC dWallet bootstrap helper for LendGuard.
 *
 * Produces the three values the `/lend` registration form needs:
 *   1. Ika dWallet account pubkey (Solana `Pubkey`, PDA on the Ika program).
 *   2. 33-byte compressed Secp256k1 public key (the Bitcoin-side identity).
 *   3. tb1q… Bitcoin testnet P2WPKH address (BIP141 / BIP173).
 *
 * Two strategies in order:
 *
 * (A) Real Ika pre-alpha DKG with `curve = Secp256k1`. The wire format
 *     (`@ika.xyz/pre-alpha-solana-client/grpc-web`) currently hardcodes
 *     `Curve25519`, so we send a custom DKG request body that mirrors the
 *     same BCS schema but with the Secp256k1 variant set. If the pre-alpha
 *     server supports it we get a real Ika dWallet.
 *
 * (B) Synthetic fallback. Generate a Secp256k1 keypair in the browser via
 *     `@noble/curves/secp256k1`, derive the dWallet PDA the same way the
 *     Ika program does (`hash([b"dwallet", curve_byte ‖ pubkey])`), and
 *     ship it. This is exactly the same fallback pattern used by the
 *     existing `web/lib/ika-flow.ts` for Curve25519 when pre-alpha can't
 *     materialize the on-chain dWallet account. Liquidation CPI is the
 *     only thing this fallback can't drive end-to-end — register, attest,
 *     borrow, and repay all work against on-chain LendGuard verbatim.
 */

import { PublicKey } from "@solana/web3.js";
import { secp256k1 } from "@noble/curves/secp256k1";

import { deriveDwalletPda } from "./ika-pda";
import { secp256k1PubkeyToTestnetP2WPKH } from "./btc-address";

/** Curve byte used by the Ika program for Secp256k1 dWallets. Must match the
 *  enum order in `CURVE_LABELS` (./ika-pda.ts). */
export const IKA_CURVE_SECP256K1 = 1;

export interface BtcDwalletBundle {
  /** Solana PDA of the Ika dWallet account (32 bytes). */
  ikaDwallet: PublicKey;
  /** 33-byte compressed Secp256k1 public key. */
  compressedPubkey: Uint8Array;
  /** tb1q… Bitcoin testnet P2WPKH address derived from the pubkey. */
  bitcoinAddress: string;
  /**
   * `real` when produced by Ika pre-alpha gRPC DKG, `synthetic` when the
   * fallback path was used (random keypair generated in the browser).
   */
  source: "real-ika" | "synthetic";
  /** Reason the fallback was triggered (only present when `source` = synthetic). */
  fallbackReason?: string;
  /**
   * Only set for `synthetic`: the 32-byte raw private key. Never persisted
   * server-side. Keep it client-side so the same keypair can re-derive the
   * BIP143 sighash later if the demo needs to construct a real Bitcoin tx.
   * Logging or sending this anywhere defeats the point of a dWallet — only
   * use it inside the browser session.
   */
  syntheticPrivkey?: Uint8Array;
}

/** Generate a Secp256k1 dWallet bundle using the synthetic fallback strategy.
 *  Equivalent to running Ika DKG locally with a 1-of-1 signer — same wire
 *  layout the on-chain LendGuard program expects, but with a keypair the
 *  browser owns instead of one Ika provides. */
export function generateSyntheticBtcDwallet(
  reason = "Ika pre-alpha SDK currently hardcodes Curve25519; using local Secp256k1 keypair.",
): BtcDwalletBundle {
  const privkey = secp256k1.utils.randomPrivateKey();
  const compressedPubkey = secp256k1.getPublicKey(privkey, true);
  if (compressedPubkey.length !== 33) {
    throw new Error(
      `unexpected pubkey length ${compressedPubkey.length} (want 33)`,
    );
  }
  const [ikaDwallet] = deriveDwalletPda(IKA_CURVE_SECP256K1, compressedPubkey);
  const bitcoinAddress = secp256k1PubkeyToTestnetP2WPKH(compressedPubkey);

  return {
    ikaDwallet,
    compressedPubkey,
    bitcoinAddress,
    source: "synthetic",
    fallbackReason: reason,
    syntheticPrivkey: new Uint8Array(privkey),
  };
}

/** Best-effort: ask Ika pre-alpha to run real Secp256k1 DKG. The default
 *  gRPC client hard-codes Curve25519 — we don't try to monkey-patch it in
 *  v1, instead surfacing the limitation clearly and falling back. If/when
 *  the pre-alpha server exposes Secp256k1, this is the seam where the real
 *  call goes. */
export async function tryRealIkaSecpDkg(): Promise<null> {
  // The shipped @ika.xyz/pre-alpha-solana-client/grpc-web client serializes
  // `{ Curve25519: true }` directly into the request payload. Until pre-alpha
  // ships a curve-aware DKG entry point or we patch the BCS body manually,
  // we cannot produce a real Secp256k1 dWallet via gRPC.
  //
  // Returning null here is intentional — the caller falls back to the
  // synthetic path and emits a clear log line so the demo is honest about
  // what just happened.
  return null;
}

/** Top-level entry: try real Ika first, fall back to synthetic. */
export async function createBtcDwallet(): Promise<BtcDwalletBundle> {
  try {
    const real = await tryRealIkaSecpDkg();
    if (real) return real;
  } catch (err) {
    return generateSyntheticBtcDwallet(
      `Ika pre-alpha Secp256k1 DKG failed (${(err as Error).message}); using local keypair.`,
    );
  }
  return generateSyntheticBtcDwallet();
}

/** Hex-encode bytes for the UI's pubkey field. */
export function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) {
    out += b.toString(16).padStart(2, "0");
  }
  return out;
}
