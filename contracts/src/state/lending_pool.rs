use anchor_lang::prelude::*;

#[account]
pub struct LendingPool {
    pub borrow_asset: Pubkey,
    pub borrow_asset_mint: Pubkey,
    pub pool_token_vault: Pubkey,
    pub total_liquidity: u64,
    pub total_borrowed: u64,
    pub admin: Pubkey,
    pub ltv_basis_points: u16,
    pub liquidation_threshold_bps: u16,
    pub liquidation_bonus_bps: u16,
    pub mint_decimals: u8,
    /// Cumulative borrow index, scaled by 1e18. Starts at 1e18 (== 1.0).
    /// Phase 3 (interest accrual) updates this on every interaction.
    pub borrow_index: u128,
    /// Slot at which `borrow_index` was last updated.
    pub last_update_slot: u64,
    /// Annualised base interest rate in basis points (utilization 0%).
    pub base_rate_bps: u16,
    /// Annualised rate slope in basis points up to optimal utilization (80%).
    pub rate_slope_bps: u16,
    pub bump: u8,
}

impl LendingPool {
    pub const RAY: u128 = 1_000_000_000_000_000_000; // 1e18

    pub const LEN: usize = 8 + // discriminator
        32 + // borrow_asset
        32 + // borrow_asset_mint
        32 + // pool_token_vault
        8 +  // total_liquidity
        8 +  // total_borrowed
        32 + // admin
        2 +  // ltv_basis_points
        2 +  // liquidation_threshold_bps
        2 +  // liquidation_bonus_bps
        1 +  // mint_decimals
        16 + // borrow_index (u128)
        8 +  // last_update_slot (u64)
        2 +  // base_rate_bps
        2 +  // rate_slope_bps
        1;   // bump
}
