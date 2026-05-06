use anchor_lang::prelude::*;

mod state;
mod instructions;
mod events;
mod errors;
mod constants;

pub use state::*;
pub use instructions::*;
pub use events::*;
pub use errors::*;
pub use constants::*;

declare_id!("11111111111111111111111111111111");

#[program]
pub mod lendguard_proof_vault {
    use super::*;

    /// Register a new collateral vault linked to an Ika dWallet
    pub fn register_vault(
        ctx: Context<RegisterVault>,
        dwallet_id: [u8; 32],
        asset_type: u8,
        bump: u8,
    ) -> Result<()> {
        instructions::register_vault(ctx, dwallet_id, asset_type, bump)
    }

    /// Verify custody proof from Ika dWallet
    pub fn verify_custody_proof(
        ctx: Context<VerifyCustodyProof>,
        expected_dwallet_id: [u8; 32],
    ) -> Result<()> {
        instructions::verify_custody_proof(ctx, expected_dwallet_id)
    }

    /// Refresh an existing custody proof (proof expiry check)
    pub fn refresh_custody_proof(
        ctx: Context<VerifyCustodyProof>,
        expected_dwallet_id: [u8; 32],
    ) -> Result<()> {
        instructions::refresh_custody_proof(ctx, expected_dwallet_id)
    }

    /// Deposit collateral (gated by proof verification)
    pub fn deposit_collateral(
        ctx: Context<DepositCollateral>,
        amount: u64,
    ) -> Result<()> {
        instructions::deposit_collateral(ctx, amount)
    }

    /// Withdraw collateral
    pub fn withdraw_collateral(
        ctx: Context<DepositCollateral>,
        amount: u64,
    ) -> Result<()> {
        instructions::withdraw_collateral(ctx, amount)
    }

    /// Reject an unverified deposit (admin only)
    pub fn reject_unverified_deposit(
        ctx: Context<DepositCollateral>,
        amount: u64,
        reason: String,
    ) -> Result<()> {
        instructions::reject_unverified_deposit(ctx, amount, reason)
    }

    /// Update encrypted backing state via Encrypt
    pub fn update_backing_state(
        ctx: Context<UpdateBackingState>,
        new_backing_amount: u64,
    ) -> Result<()> {
        instructions::update_backing_state(ctx, new_backing_amount)
    }

    /// Trigger FHE risk check via Encrypt
    pub fn trigger_risk_check(
        ctx: Context<TriggerRiskCheck>,
    ) -> Result<()> {
        instructions::trigger_risk_check(ctx)
    }

    /// Freeze vault/protocol via circuit breaker
    pub fn circuit_breaker_freeze(
        ctx: Context<CircuitBreakerFreeze>,
        reason: String,
    ) -> Result<()> {
        instructions::circuit_breaker_freeze(ctx, reason)
    }

    /// Unfreeze vault (admin only)
    pub fn admin_unfreeze(
        ctx: Context<AdminUnfreeze>,
    ) -> Result<()> {
        instructions::admin_unfreeze(ctx)
    }

    /// Close a vault (only if no collateral deposited)
    pub fn close_vault(
        ctx: Context<CloseVault>,
    ) -> Result<()> {
        instructions::close_vault(ctx)
    }
}

// Re-export for visibility
pub use lendguard_proof_vault::*;
