/**
 * LendGuard collateral acceptance gate.
 *
 * This is the integration shim every external lender (Marginfi, Mango, any
 * Solana lending market) would call before accepting cross-chain collateral.
 * It reads LendGuard's
 * on-chain vault PDA on devnet and returns a single, deterministic verdict:
 *
 *   gate.allowed === true  →  custody proof is valid; lender may proceed
 *   gate.allowed === false →  reason explains exactly what's wrong
 *
 * Why a gate (and not the lender re-implementing the check)?
 *   1. The lender doesn't need to know LendGuard's account layout.
 *   2. Reasons are typed — UI / monitoring / on-chain CPI all see the same enum.
 *   3. The lender's program never even gets called when the gate fails, so
 *      forged collateral never produces a downstream deposit instruction.
 */

import { Connection, PublicKey } from "@solana/web3.js";
import {
  deriveVaultPda,
  deriveProtocolStatePda,
  dwalletIdToBytes,
  PROGRAM_ID as LENDGUARD_PROGRAM_ID,
} from "./lendguard-client";

/** How long an Ika MessageApproval is considered "fresh" (matches contracts). */
const PROOF_FRESHNESS_SECONDS = 24 * 60 * 60;

export type GateBlockReason =
  | "WALLET_NOT_CONNECTED"
  | "PROTOCOL_NOT_INITIALIZED"
  | "PROTOCOL_FROZEN"
  | "VAULT_NOT_REGISTERED"
  | "PROOF_PENDING"
  | "PROOF_EXPIRED"
  | "VAULT_FROZEN";

export type GateResult =
  | {
      allowed: true;
      vaultPda: PublicKey;
      proofStatus: "VERIFIED";
      proofTimestamp: number;
      proofAgeSeconds: number;
      depositedLamports: bigint;
    }
  | {
      allowed: false;
      reason: GateBlockReason;
      humanMessage: string;
      vaultPda?: PublicKey;
    };

/**
 * Decode the LendGuard `VaultAccount` borsh layout.
 *
 *   [8  disc]
 *   [32 vault_id]
 *   [32 owner]
 *   [32 dwallet_id]
 *   [1  asset_type]
 *   [8  deposited_amount  u64 LE]
 *   [1  proof_status      0=Pending 1=Verified 2=Expired]
 *   [8  proof_timestamp   i64 LE]
 *   [1  frozen]
 *   [1  bump]
 *
 * Mirror of `contracts/src/state/vault_account.rs`.
 */
export interface VaultAccountLayout {
  vaultId: PublicKey;
  owner: PublicKey;
  dwalletId: Uint8Array;
  assetType: number;
  depositedAmount: bigint;
  proofStatus: 0 | 1 | 2;
  proofTimestamp: number;
  frozen: boolean;
  bump: number;
}

export function decodeVaultAccount(data: Buffer): VaultAccountLayout | null {
  if (data.length < 8 + 32 + 32 + 32 + 1 + 8 + 1 + 8 + 1 + 1) return null;
  let off = 8;
  const vaultId = new PublicKey(data.subarray(off, off + 32));
  off += 32;
  const owner = new PublicKey(data.subarray(off, off + 32));
  off += 32;
  const dwalletId = new Uint8Array(data.subarray(off, off + 32));
  off += 32;
  const assetType = data[off];
  off += 1;
  const depositedAmount = data.readBigUInt64LE(off);
  off += 8;
  const ps = data[off];
  off += 1;
  const proofStatus = (ps === 0 || ps === 1 || ps === 2 ? ps : 0) as 0 | 1 | 2;
  const proofTimestamp = Number(data.readBigInt64LE(off));
  off += 8;
  const frozen = data[off] === 1;
  off += 1;
  const bump = data[off];
  return {
    vaultId,
    owner,
    dwalletId,
    assetType,
    depositedAmount,
    proofStatus,
    proofTimestamp,
    frozen,
    bump,
  };
}

/** Read protocol_state.frozen — same layout the demo's auto-unfreeze uses. */
async function readProtocolState(
  connection: Connection,
): Promise<{ exists: boolean; frozen: boolean }> {
  const [pda] = deriveProtocolStatePda();
  const info = await connection.getAccountInfo(pda);
  if (!info) return { exists: false, frozen: false };
  return { exists: true, frozen: info.data[40] === 1 };
}

export interface CheckGateInput {
  connection: Connection;
  /** Connected user's wallet pubkey, or null if disconnected */
  wallet: PublicKey | null;
  /**
   * Identifier of the dWallet they want to use as collateral. Either:
   *  - the raw 32-byte ID (from Ika DKG), or
   *  - a string label (we'll hash to 32 bytes the same way generateDemoDwalletId does)
   */
  dwalletId: Uint8Array | string;
}

/**
 * The actual gate — single async function any external program / UI can call.
 */
export async function checkLendGuardGate(
  input: CheckGateInput,
): Promise<GateResult> {
  const { connection, wallet, dwalletId } = input;

  if (!wallet) {
    return {
      allowed: false,
      reason: "WALLET_NOT_CONNECTED",
      humanMessage:
        "Connect a Solana wallet so LendGuard can locate your vault PDA.",
    };
  }

  const protocol = await readProtocolState(connection);
  if (!protocol.exists) {
    return {
      allowed: false,
      reason: "PROTOCOL_NOT_INITIALIZED",
      humanMessage:
        "LendGuard protocol_state PDA is not initialized on this cluster.",
    };
  }
  if (protocol.frozen) {
    return {
      allowed: false,
      reason: "PROTOCOL_FROZEN",
      humanMessage:
        "Protocol is frozen — LendGuard tripped its circuit breaker, no deposits allowed.",
    };
  }

  const dwalletIdBytes =
    typeof dwalletId === "string" ? dwalletIdToBytes(dwalletId) : dwalletId;
  const [vaultPda] = deriveVaultPda(wallet, dwalletIdBytes);

  const info = await connection.getAccountInfo(vaultPda);
  if (!info) {
    return {
      allowed: false,
      reason: "VAULT_NOT_REGISTERED",
      humanMessage:
        "No LendGuard vault found for this wallet + dWallet ID. Run the LendGuard demo first to create one.",
      vaultPda,
    };
  }

  const vault = decodeVaultAccount(info.data);
  if (!vault) {
    return {
      allowed: false,
      reason: "VAULT_NOT_REGISTERED",
      humanMessage: "Vault PDA exists but its data is not LendGuard-shaped.",
      vaultPda,
    };
  }

  if (vault.frozen) {
    return {
      allowed: false,
      reason: "VAULT_FROZEN",
      humanMessage: "This vault was frozen by an admin / circuit breaker.",
      vaultPda,
    };
  }

  if (vault.proofStatus !== 1) {
    return {
      allowed: false,
      reason: "PROOF_PENDING",
      humanMessage:
        "Vault has no Ika MessageApproval yet — call verify_custody_proof before depositing.",
      vaultPda,
    };
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const proofAgeSeconds = nowSec - vault.proofTimestamp;
  if (proofAgeSeconds > PROOF_FRESHNESS_SECONDS) {
    return {
      allowed: false,
      reason: "PROOF_EXPIRED",
      humanMessage: `Custody proof is ${Math.floor(proofAgeSeconds / 3600)}h old (>24h). Re-run verify_custody_proof.`,
      vaultPda,
    };
  }

  return {
    allowed: true,
    vaultPda,
    proofStatus: "VERIFIED",
    proofTimestamp: vault.proofTimestamp,
    proofAgeSeconds,
    depositedLamports: vault.depositedAmount,
  };
}

// ─── Vault discovery (for external lenders) ──────────────────────────────────

const VAULT_ACCOUNT_LEN =
  8 + 32 + 32 + 32 + 1 + 8 + 1 + 8 + 1 + 1; // mirrors VaultAccount::LEN
const OWNER_OFFSET_IN_VAULT = 8 + 32; // disc + vault_id

export interface VaultListing {
  vaultPda: PublicKey;
  vault: VaultAccountLayout;
}

/**
 * Find every LendGuard vault owned by `wallet`. Uses `getProgramAccounts`
 * with a memcmp filter on the `owner` field — this is exactly the lookup
 * any external lender (Marginfi, Mango, etc.) would do.
 *
 * Returns vaults sorted by proof_timestamp DESC so the most recently
 * verified one appears first.
 */
export async function listVaultsForOwner(
  connection: Connection,
  wallet: PublicKey,
): Promise<VaultListing[]> {
  const accounts = await connection.getProgramAccounts(LENDGUARD_PROGRAM_ID, {
    commitment: "confirmed",
    filters: [
      { dataSize: VAULT_ACCOUNT_LEN },
      {
        memcmp: {
          offset: OWNER_OFFSET_IN_VAULT,
          bytes: wallet.toBase58(),
        },
      },
    ],
  });

  const out: VaultListing[] = [];
  for (const a of accounts) {
    const vault = decodeVaultAccount(a.account.data as Buffer);
    if (!vault) continue;
    out.push({ vaultPda: a.pubkey, vault });
  }
  out.sort((a, b) => b.vault.proofTimestamp - a.vault.proofTimestamp);
  return out;
}

/** Convenience for UIs — short human-readable label per reason. */
export function blockReasonLabel(reason: GateBlockReason): string {
  switch (reason) {
    case "WALLET_NOT_CONNECTED":
      return "Wallet not connected";
    case "PROTOCOL_NOT_INITIALIZED":
      return "Protocol not initialized";
    case "PROTOCOL_FROZEN":
      return "Protocol frozen — circuit breaker tripped";
    case "VAULT_NOT_REGISTERED":
      return "No registered vault";
    case "PROOF_PENDING":
      return "No Ika custody proof";
    case "PROOF_EXPIRED":
      return "Custody proof expired";
    case "VAULT_FROZEN":
      return "Vault frozen";
  }
}
