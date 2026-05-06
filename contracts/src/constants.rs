// Program constants
pub const VAULT_PDA_SEED: &[u8] = b"vault";
pub const PROTOCOL_STATE_PDA_SEED: &[u8] = b"protocol_state";
pub const RISK_STATE_PDA_SEED: &[u8] = b"risk_state";

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
