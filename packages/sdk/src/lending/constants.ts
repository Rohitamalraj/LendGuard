import { PublicKey } from "@solana/web3.js";

export const LENDGUARD_PROGRAM_ID = new PublicKey(
  "GQia1ewyLgtkgX7HSfuttJ42qNPpYJhUbxeyCPXtcJFR",
);

export const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
);

export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
);

/** Devnet LGUSD mint (governed by the lending_pool PDA). */
export const LGUSD_MINT_DEVNET = new PublicKey(
  "9NuCY56MCS8FcGZ1i3wjpzffjwb9mnAQdX4CwgNWzhpZ",
);

export const LGUSD_DECIMALS = 6;
export const LGUSD_SCALE = 1_000_000n;
export const PRICE_SCALE = 100_000_000n;
export const RAY = 1_000_000_000_000_000_000n;
export const COLLATERAL_DECIMALS = 1_000_000_000n;

export const ASSET_BTC = 0;
export const ASSET_ETH = 1;
export const ASSET_SOL = 2;

export const PROTOCOL_STATE_SEED = Buffer.from("protocol_state");
export const VAULT_SEED = Buffer.from("vault");
export const RISK_STATE_SEED = Buffer.from("risk_state");
export const LENDING_POOL_SEED = Buffer.from("lending_pool");
export const BORROW_POSITION_SEED = Buffer.from("borrow_position");
export const ADMIN_PRICE_FEED_SEED = Buffer.from("admin_price");

export function deriveProtocolStatePda(
  programId: PublicKey = LENDGUARD_PROGRAM_ID,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([PROTOCOL_STATE_SEED], programId);
}

export function deriveLendingPoolPda(
  borrowAssetMint: PublicKey,
  programId: PublicKey = LENDGUARD_PROGRAM_ID,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [LENDING_POOL_SEED, borrowAssetMint.toBuffer()],
    programId,
  );
}

export function deriveAdminPriceFeedPda(
  assetType: number,
  programId: PublicKey = LENDGUARD_PROGRAM_ID,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [ADMIN_PRICE_FEED_SEED, Buffer.from([assetType & 0xff])],
    programId,
  );
}

export function deriveBorrowPositionPda(
  vaultPda: PublicKey,
  programId: PublicKey = LENDGUARD_PROGRAM_ID,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [BORROW_POSITION_SEED, vaultPda.toBuffer()],
    programId,
  );
}

export function deriveVaultPda(
  owner: PublicKey,
  dwalletId: Uint8Array,
  programId: PublicKey = LENDGUARD_PROGRAM_ID,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [VAULT_SEED, owner.toBuffer(), Buffer.from(dwalletId.slice(0, 32))],
    programId,
  );
}

export function deriveRiskStatePda(
  vaultPda: PublicKey,
  programId: PublicKey = LENDGUARD_PROGRAM_ID,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [RISK_STATE_SEED, vaultPda.toBuffer()],
    programId,
  );
}

/** ATA derivation matching `@solana/spl-token`'s `getAssociatedTokenAddressSync`. */
export function deriveAssociatedTokenAddress(
  owner: PublicKey,
  mint: PublicKey,
  allowOwnerOffCurve = false,
): PublicKey {
  if (!allowOwnerOffCurve && !PublicKey.isOnCurve(owner.toBuffer())) {
    throw new Error("ATA owner must be on-curve unless allowOwnerOffCurve is true");
  }
  const [pda] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  return pda;
}
