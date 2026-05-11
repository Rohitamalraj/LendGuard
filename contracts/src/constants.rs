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
