/**
 * Frontend bridge: wraps @lendguard/sdk LendGuard client with
 * Solana devnet connection, Wallet Adapter wallet, and derived PDAs.
 *
 * Usage:
 *   const client = useLendGuardClient();  // from useLendGuardClient hook
 *   await client.registerVault({ dwalletId, assetType: "BTC" });
 */

import { Connection, PublicKey } from "@solana/web3.js";

const PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_LENDGUARD_PROGRAM_ID ??
    "FymmJAKSLcadQTjyiGjQW1iyegKLMdHhSND1bDjgZg1X",
);
const RPC_URL =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://api.devnet.solana.com";

// PDA seeds — must stay in sync with contracts/src/constants.rs
const VAULT_SEED = Buffer.from("vault");
const PROTOCOL_STATE_SEED = Buffer.from("protocol_state");
const RISK_STATE_SEED = Buffer.from("risk_state");

export const connection = new Connection(RPC_URL, "confirmed");

export function deriveProtocolStatePda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([PROTOCOL_STATE_SEED], PROGRAM_ID);
}

export function deriveVaultPda(
  owner: PublicKey,
  dwalletId: Uint8Array,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [VAULT_SEED, owner.toBuffer(), dwalletId.slice(0, 32)],
    PROGRAM_ID,
  );
}

export function deriveRiskStatePda(vaultPda: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [RISK_STATE_SEED, vaultPda.toBuffer()],
    PROGRAM_ID,
  );
}

export function dwalletIdToBytes(id: string): Uint8Array {
  const bytes = new TextEncoder().encode(id);
  const out = new Uint8Array(32);
  out.set(bytes.slice(0, 32));
  return out;
}

// ─── Demo state helpers ───────────────────────────────────────────────────────

export interface DemoVaultState {
  dwalletId: string;
  vaultPda: string;
  riskStatePda: string;
  protocolStatePda: string;
  proofStatus: "PENDING" | "VERIFIED" | "EXPIRED";
  depositedAmount: bigint;
  backingRatio: number;
  frozen: boolean;
  lastEvent: string;
}

export function buildInitialDemoState(
  ownerPubkey: PublicKey,
  dwalletId: string,
): DemoVaultState {
  const dwalletBytes = dwalletIdToBytes(dwalletId);
  const [vaultPda] = deriveVaultPda(ownerPubkey, dwalletBytes);
  const [riskStatePda] = deriveRiskStatePda(vaultPda);
  const [protocolStatePda] = deriveProtocolStatePda();

  return {
    dwalletId,
    vaultPda: vaultPda.toBase58(),
    riskStatePda: riskStatePda.toBase58(),
    protocolStatePda: protocolStatePda.toBase58(),
    proofStatus: "PENDING",
    depositedAmount: BigInt(0),
    backingRatio: 100,
    frozen: false,
    lastEvent: "",
  };
}

