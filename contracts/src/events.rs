use anchor_lang::prelude::*;

#[event]
pub struct VaultRegistered {
    pub vault_id: Pubkey,
    pub owner: Pubkey,
    pub dwallet_id: [u8; 32],
    pub asset_type: u8,
    pub timestamp: i64,
}

#[event]
pub struct ProofVerified {
    pub vault_id: Pubkey,
    pub asset_type: u8,
    pub amount: u64,
    pub dwallet_id: [u8; 32],
    pub timestamp: i64,
}

#[event]
pub struct ProofRefreshed {
    pub vault_id: Pubkey,
    pub new_timestamp: i64,
}

#[event]
pub struct CollateralDeposited {
    pub vault_id: Pubkey,
    pub amount: u64,
    pub wallet: Pubkey,
    pub total_deposited: u64,
    pub timestamp: i64,
}

#[event]
pub struct CollateralWithdrawn {
    pub vault_id: Pubkey,
    pub amount: u64,
    pub wallet: Pubkey,
    pub remaining_balance: u64,
    pub timestamp: i64,
}

#[event]
pub struct CollateralRejected {
    pub vault_id: Pubkey,
    pub wallet: Pubkey,
    pub amount: u64,
    pub reason: String,
    pub timestamp: i64,
}

#[event]
pub struct RiskCheckExecuted {
    pub vault_id: Pubkey,
    pub is_safe: bool,
    pub timestamp: i64,
}

#[event]
pub struct CircuitBreakerFired {
    pub vault_id: Pubkey,
    pub reason: String,
    pub timestamp: i64,
}

#[event]
pub struct ProtocolUnfrozen {
    pub vault_id: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct BackingStateUpdated {
    pub vault_id: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct VaultClosed {
    pub vault_id: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct LendingPoolInitialized {
    pub pool: Pubkey,
    pub borrow_asset: Pubkey,
    pub initial_liquidity: u64,
    pub ltv_basis_points: u16,
    pub liquidation_threshold_bps: u16,
    pub liquidation_bonus_bps: u16,
    pub timestamp: i64,
}

#[event]
pub struct AdminPriceUpdated {
    pub asset_type: u8,
    pub price_usd: u64,
    pub timestamp: i64,
}

#[event]
pub struct BorrowOpened {
    pub vault_id: Pubkey,
    pub position: Pubkey,
    pub owner: Pubkey,
    pub amount: u64,
    pub principal: u64,
    pub timestamp: i64,
}

#[event]
pub struct BorrowRepaid {
    pub vault_id: Pubkey,
    pub position: Pubkey,
    pub owner: Pubkey,
    pub amount: u64,
    pub remaining_principal: u64,
    pub timestamp: i64,
}

#[event]
pub struct PositionLiquidated {
    pub vault_id: Pubkey,
    pub position: Pubkey,
    pub borrower: Pubkey,
    pub liquidator: Pubkey,
    pub repaid_amount: u64,
    pub seized_collateral_lamports: u64,
    pub liquidation_bonus_bps: u16,
    pub timestamp: i64,
}

#[event]
pub struct InterestAccrued {
    pub pool: Pubkey,
    pub previous_index: u128,
    pub new_index: u128,
    pub elapsed_slots: u64,
    pub timestamp: i64,
}
