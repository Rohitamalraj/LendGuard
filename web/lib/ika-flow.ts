/**
 * Real Ika dWallet end-to-end orchestration for LendGuard.
 *
 * This is the production-shape flow that replaces the demo helper used by
 * step 2 of `app/demo/page.tsx`:
 *
 *   1. Derive LendGuard's CPI authority PDA (acts as the dWallet's authority).
 *   2. DKG: hit Ika gRPC `requestDKG` with `intended_chain_sender = cpiAuthority`
 *      to create a dWallet whose authority = our PDA.
 *   3. Derive the dWallet PDA on-chain from `(curve, publicKey)`.
 *   4. Build the `MessageApproval` PDA from `(b"message_approval", dwallet, msgDigest)`.
 *   5. Submit LendGuard's `approve_custody_signature` instruction — LendGuard
 *      CPIs into Ika `approve_message` via `invoke_signed`, creating a real
 *      287-byte `MessageApproval` PDA with status=Pending.
 *   6. Hit Ika gRPC `requestSign` with the `(dwalletAddr, message, presignId,
 *      txSignature)` tuple — the network signs and commits the signature
 *      on-chain (status flips to Signed).
 *
 * After step 6, the existing `verify_custody_proof` instruction works as-is —
 * `parse_message_approval` autodetects the real 287-byte layout.
 *
 * Pre-alpha caveat: the Ika devnet may be wiped, the gRPC endpoint may be
 * unavailable, or the on-chain coordinator/NEK PDAs may not be initialized.
 * Each step throws a descriptive error on failure so the caller can fall
 * back to the demo helper.
 */

import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";

import {
  IKA_PROGRAM_ID,
  requestDkg,
  requestPresign,
  requestSign,
} from "./ika-client";
import {
  CURVE_LABELS,
  SIGNATURE_SCHEME_LABELS,
  deriveDwalletCoordinatorPda,
  deriveDwalletPda,
  deriveIkaCpiAuthorityPda,
  deriveMessageApprovalPda,
} from "./ika-pda";
import { PROGRAM_ID as LENDGUARD_PROGRAM_ID } from "./lendguard-client";
import {
  buildApproveCustodySignatureIx,
  sendIx,
} from "./program-actions";

// Ika DKG default curve = Curve25519 (matches the gRPC client's request body).
const DEFAULT_CURVE = 0;
// Ed25519 signature scheme — paired with Curve25519.
const DEFAULT_SIGNATURE_SCHEME = 0;

export interface RealIkaFlowParams {
  connection: Connection;
  owner: PublicKey;
  vaultPda: PublicKey;
  /** The 32-byte message digest LendGuard wants the dWallet to sign. */
  messageDigest: Uint8Array;
  signTransaction: (tx: Transaction) => Promise<Transaction>;
  /** Streaming logger so the UI can show step-by-step progress. */
  log: (msg: string, payload?: Record<string, unknown>) => void;
}

export interface RealIkaFlowResult {
  cpiAuthority: PublicKey;
  dwallet: PublicKey;
  publicKey: Uint8Array;
  messageApproval: PublicKey;
  approveTxSig: string;
  signature?: Uint8Array;
}

/**
 * Run the real Ika DKG → approve → sign flow against the deployed LendGuard
 * program. Throws on any step failure with a descriptive message.
 */
export async function runRealIkaFlow(
  params: RealIkaFlowParams,
): Promise<RealIkaFlowResult> {
  const { connection, owner, vaultPda, messageDigest, signTransaction, log } =
    params;

  // ─── 1. CPI authority PDA ──────────────────────────────────────────────
  const [cpiAuthority, cpiAuthorityBump] = deriveIkaCpiAuthorityPda();
  log("LendGuard CPI authority PDA derived", {
    cpiAuthority: cpiAuthority.toBase58(),
    bump: cpiAuthorityBump,
  });

  // ─── 2. DKG via Ika gRPC ──────────────────────────────────────────────
  log("Ika gRPC: requestDKG (intended_chain_sender = cpiAuthority)");
  const { publicKey } = await requestDkg(cpiAuthority);
  log(
    `Ika DKG complete (${CURVE_LABELS[DEFAULT_CURVE]}, pubkey ${publicKey.length} bytes)`,
  );

  // ─── 3. Derive dWallet PDA + coordinator + message approval ───────────
  const [dwallet] = deriveDwalletPda(DEFAULT_CURVE, publicKey);
  const [coordinator] = deriveDwalletCoordinatorPda();
  const [messageApproval, messageApprovalBump] = deriveMessageApprovalPda(
    dwallet,
    messageDigest,
  );
  log("Ika PDAs derived", {
    dwallet: dwallet.toBase58(),
    coordinator: coordinator.toBase58(),
    messageApproval: messageApproval.toBase58(),
    messageApprovalBump,
  });

  // ─── 4. Build LendGuard `approve_custody_signature` instruction ───────
  const ix: TransactionInstruction = await buildApproveCustodySignatureIx({
    owner,
    vaultPda,
    callerProgram: LENDGUARD_PROGRAM_ID,
    cpiAuthority,
    dwalletProgram: IKA_PROGRAM_ID,
    coordinator,
    dwallet,
    messageApproval,
    messageApprovalBump,
    messageDigest,
    userPubkey: owner.toBytes(), // any user-tied pubkey; not signer-checked
    signatureScheme: DEFAULT_SIGNATURE_SCHEME,
  });

  // ─── 5. Submit Solana tx (LendGuard → Ika CPI) ────────────────────────
  log("Submitting LendGuard approve_custody_signature → Ika CPI");
  const approveTxSig = await sendIx(ix, {
    connection,
    payer: owner,
    signTransaction,
  });
  log(`MessageApproval PDA created on-chain (status=Pending)`, {
    tx: approveTxSig,
    messageApproval: messageApproval.toBase58(),
  });

  // ─── 6. Ask Ika network to sign — best-effort ─────────────────────────
  // Presign is a one-shot nonce; without it `requestSign` fails. If presign
  // or sign fails we still return — the MessageApproval is on-chain and the
  // caller can poll later.
  let signature: Uint8Array | undefined;
  try {
    log("Ika gRPC: requestPresign");
    const presignId = await requestPresign(cpiAuthority, dwallet.toBytes());

    log(
      `Ika gRPC: requestSign (${SIGNATURE_SCHEME_LABELS[DEFAULT_SIGNATURE_SCHEME]})`,
    );
    const txSigBytes = bs58Decode(approveTxSig);
    signature = await requestSign(
      cpiAuthority,
      dwallet.toBytes(),
      messageDigest,
      presignId,
      txSigBytes,
    );
    log(`Ika network signature (${signature.length} bytes received)`);
  } catch (err) {
    log(
      `Ika sign step skipped — MessageApproval still on-chain. Error: ${(err as Error).message}`,
    );
  }

  return {
    cpiAuthority,
    dwallet,
    publicKey,
    messageApproval,
    approveTxSig,
    signature,
  };
}

// ── helpers ─────────────────────────────────────────────────────────────────

/** Minimal base58 decode for tx signatures (Solana's base58 alphabet). */
function bs58Decode(s: string): Uint8Array {
  const ALPHABET =
    "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const map = new Map(ALPHABET.split("").map((c, i) => [c, i]));
  let zeros = 0;
  while (zeros < s.length && s[zeros] === "1") zeros += 1;
  const b58 = Array.from(s.slice(zeros)).map((c) => {
    const v = map.get(c);
    if (v === undefined) throw new Error(`Invalid base58 char: ${c}`);
    return v;
  });
  // base58 → bytes
  const out: number[] = [];
  for (const v of b58) {
    let carry = v;
    for (let i = 0; i < out.length; i += 1) {
      carry += out[i] * 58;
      out[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      out.push(carry & 0xff);
      carry >>= 8;
    }
  }
  out.reverse();
  return new Uint8Array([...new Array(zeros).fill(0), ...out]);
}
