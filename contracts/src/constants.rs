// Program constants
pub const VAULT_PDA_SEED: &[u8] = b"vault";
pub const PROTOCOL_STATE_PDA_SEED: &[u8] = b"protocol_state";
pub const RISK_STATE_PDA_SEED: &[u8] = b"risk_state";
pub const LENDING_POOL_PDA_SEED: &[u8] = b"lending_pool";
pub const BORROW_POSITION_PDA_SEED: &[u8] = b"borrow_position";
pub const ADMIN_PRICE_FEED_PDA_SEED: &[u8] = b"admin_price";

// Timeouts and expiries
pub const PROOF_EXPIRY_SECONDS: i64 = 600; // 10 minutes
pub const MIN_VERIFICATION_AMOUNT: u64 = 1_000_000; // 1 SOL in lamports

// Asset type identifiers
pub const ASSET_BTC: u8 = 0;
pub const ASSET_ETH: u8 = 1;
pub const ASSET_SOL: u8 = 2;

// Proof status
pub const PROOF_STATUS_PENDING: u8 = 0;
pub const PROOF_STATUS_VERIFIED: u8 = 1;
pub const PROOF_STATUS_EXPIRED: u8 = 2;

// Circuit breaker reasons
pub const FREEZE_REASON_RISK_FAILED: &str = "Risk predicate failed";
pub const FREEZE_REASON_ADMIN_MANUAL: &str = "Admin manual freeze";
pub const FREEZE_REASON_EXPLOIT_DETECTED: &str = "Exploit detected";

// Lending protocol parameters
pub const BASIS_POINTS_DENOMINATOR: u64 = 10_000;
pub const PRICE_DECIMALS: u64 = 100_000_000; // 8 decimals
pub const BORROW_ASSET_DECIMALS: u64 = 1_000_000; // 6 decimals (LGUSD-style)
pub const COLLATERAL_DECIMALS: u64 = 1_000_000_000; // demo collateral uses 9 decimals
pub const PRICE_STALENESS_SECONDS: i64 = 60 * 60; // 1 hour

// ─── Bitcoin testnet collateral path ────────────────────────────────────
pub const BTC_VAULT_PDA_SEED: &[u8] = b"btc_vault";
pub const BTC_ATTESTATION_PDA_SEED: &[u8] = b"btc_attestation";
pub const BTC_BORROW_POSITION_PDA_SEED: &[u8] = b"btc_borrow_position";

/// 1 BTC = 100_000_000 satoshis. Native Bitcoin precision.
pub const SATOSHIS_PER_BTC: u64 = 100_000_000;

/// Max age of a `BitcoinBalanceAttestation` before borrows / liquidations
/// stop trusting it. The keeper polls every ~30s so 10 min is comfortable.
pub const BTC_ATTESTATION_MAX_AGE_SECONDS: i64 = 600;

/// Minimum Bitcoin testnet confirmations required to finalise a liquidation.
/// 1-conf is fine for testnet; mainnet would want 3-6.
pub const BTC_LIQUIDATION_MIN_CONFIRMATIONS: u32 = 1;

/// Ika signature scheme tag for Bitcoin BIP143 (SegWit) sighashes. Matches
/// the `EcdsaDoubleSha256` variant in Ika's `HashScheme` enum (index 2).
/// See https://solana-pre-alpha.ika.xyz/ — Curves and Signature Schemes.
pub const IKA_HASH_SCHEME_ECDSA_DOUBLE_SHA256: u8 = 2;
/// Ika signature scheme tag for Bitcoin Taproot (BIP340) sighashes (index 3).
pub const IKA_HASH_SCHEME_TAPROOT_SHA256: u8 = 3;
/// Ika signature scheme tag (u16) — Secp256k1 ECDSA. From Ika's
/// `SignatureScheme` enum: `ECDSASecp256k1 = 0`.
pub const IKA_SIGNATURE_SCHEME_SECP256K1: u16 = 0;
