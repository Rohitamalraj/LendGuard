import { PublicKey } from "@solana/web3.js";
export declare const LENDGUARD_PROGRAM_ID: PublicKey;
export declare const TOKEN_PROGRAM_ID: PublicKey;
export declare const ASSOCIATED_TOKEN_PROGRAM_ID: PublicKey;
/** Devnet LGUSD mint (governed by the lending_pool PDA). */
export declare const LGUSD_MINT_DEVNET: PublicKey;
export declare const LGUSD_DECIMALS = 6;
export declare const LGUSD_SCALE = 1000000n;
export declare const PRICE_SCALE = 100000000n;
export declare const RAY = 1000000000000000000n;
export declare const COLLATERAL_DECIMALS = 1000000000n;
export declare const ASSET_BTC = 0;
export declare const ASSET_ETH = 1;
export declare const ASSET_SOL = 2;
export declare const PROTOCOL_STATE_SEED: Buffer;
export declare const VAULT_SEED: Buffer;
export declare const RISK_STATE_SEED: Buffer;
export declare const LENDING_POOL_SEED: Buffer;
export declare const BORROW_POSITION_SEED: Buffer;
export declare const ADMIN_PRICE_FEED_SEED: Buffer;
export declare function deriveProtocolStatePda(programId?: PublicKey): [PublicKey, number];
export declare function deriveLendingPoolPda(borrowAssetMint: PublicKey, programId?: PublicKey): [PublicKey, number];
export declare function deriveAdminPriceFeedPda(assetType: number, programId?: PublicKey): [PublicKey, number];
export declare function deriveBorrowPositionPda(vaultPda: PublicKey, programId?: PublicKey): [PublicKey, number];
export declare function deriveVaultPda(owner: PublicKey, dwalletId: Uint8Array, programId?: PublicKey): [PublicKey, number];
export declare function deriveRiskStatePda(vaultPda: PublicKey, programId?: PublicKey): [PublicKey, number];
/** ATA derivation matching `@solana/spl-token`'s `getAssociatedTokenAddressSync`. */
export declare function deriveAssociatedTokenAddress(owner: PublicKey, mint: PublicKey, allowOwnerOffCurve?: boolean): PublicKey;
