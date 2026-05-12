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
export declare const PROTOCOL_STATE_SEED: Buffer<ArrayBuffer>;
export declare const VAULT_SEED: Buffer<ArrayBuffer>;
export declare const RISK_STATE_SEED: Buffer<ArrayBuffer>;
export declare const LENDING_POOL_SEED: Buffer<ArrayBuffer>;
export declare const BORROW_POSITION_SEED: Buffer<ArrayBuffer>;
export declare const ADMIN_PRICE_FEED_SEED: Buffer<ArrayBuffer>;
export declare const BTC_VAULT_SEED: Buffer<ArrayBuffer>;
export declare const BTC_ATTESTATION_SEED: Buffer<ArrayBuffer>;
export declare const BTC_BORROW_POSITION_SEED: Buffer<ArrayBuffer>;
export declare const IKA_DWALLET_PROGRAM_ID: PublicKey;
export declare function deriveProtocolStatePda(programId?: PublicKey): [PublicKey, number];
export declare function deriveLendingPoolPda(borrowAssetMint: PublicKey, programId?: PublicKey): [PublicKey, number];
export declare function deriveAdminPriceFeedPda(assetType: number, programId?: PublicKey): [PublicKey, number];
export declare function deriveBorrowPositionPda(vaultPda: PublicKey, programId?: PublicKey): [PublicKey, number];
export declare function deriveVaultPda(owner: PublicKey, dwalletId: Uint8Array, programId?: PublicKey): [PublicKey, number];
export declare function deriveRiskStatePda(vaultPda: PublicKey, programId?: PublicKey): [PublicKey, number];
/** ATA derivation matching `@solana/spl-token`'s `getAssociatedTokenAddressSync`. */
export declare function deriveAssociatedTokenAddress(owner: PublicKey, mint: PublicKey, allowOwnerOffCurve?: boolean): PublicKey;
/** Derive the `BtcVaultAccount` PDA for a given owner + Ika dWallet pubkey. */
export declare function deriveBtcVaultPda(owner: PublicKey, ikaDwallet: PublicKey, programId?: PublicKey): [PublicKey, number];
/** Derive the `BitcoinBalanceAttestation` PDA for a given BTC vault. */
export declare function deriveBtcAttestationPda(btcVaultPda: PublicKey, programId?: PublicKey): [PublicKey, number];
/** Derive the `BtcBorrowPosition` PDA for a given BTC vault. */
export declare function deriveBtcBorrowPositionPda(btcVaultPda: PublicKey, programId?: PublicKey): [PublicKey, number];
/**
 * Derive the Ika CPI authority PDA owned by the LendGuard program. Used as a
 * signer-seed when LendGuard invokes the Ika dWallet program during BTC
 * liquidation to broadcast the signed sweep transaction.
 */
export declare function deriveIkaCpiAuthority(programId?: PublicKey): [PublicKey, number];
