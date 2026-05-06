use anchor_lang::prelude::*;
use crate::constants::PROTOCOL_STATE_PDA_SEED;
use crate::state::{VaultAccount, ProtocolStateAccount};
use crate::events::{CircuitBreakerFired, ProtocolUnfrozen};
use crate::errors::LendGuardError;

#[derive(Accounts)]
pub struct CircuitBreakerFreeze<'info> {
    #[account(mut)]
    pub vault: Account<'info, VaultAccount>,

    #[account(
        mut,
        seeds = [PROTOCOL_STATE_PDA_SEED],
        bump = protocol_state.bump
    )]
    pub protocol_state: Account<'info, ProtocolStateAccount>,

    pub caller: Signer<'info>,
}

pub fn circuit_breaker_freeze(
    ctx: Context<CircuitBreakerFreeze>,
    reason: String,
) -> Result<()> {
    let vault = &mut ctx.accounts.vault;
    let protocol_state = &mut ctx.accounts.protocol_state;

    require!(
        protocol_state.admin == ctx.accounts.caller.key(),
        LendGuardError::UnauthorizedCaller
    );

    vault.frozen = true;
    protocol_state.frozen = true;

    let current_time = Clock::get()?.unix_timestamp;

    emit!(CircuitBreakerFired {
        vault_id: vault.vault_id,
        reason,
        timestamp: current_time,
    });

    Ok(())
}

#[derive(Accounts)]
pub struct AdminUnfreeze<'info> {
    #[account(mut)]
    pub vault: Account<'info, VaultAccount>,

    #[account(
        mut,
        seeds = [PROTOCOL_STATE_PDA_SEED],
        bump = protocol_state.bump
    )]
    pub protocol_state: Account<'info, ProtocolStateAccount>,

    pub admin: Signer<'info>,
}

pub fn admin_unfreeze(
    ctx: Context<AdminUnfreeze>,
) -> Result<()> {
    let protocol_state = &ctx.accounts.protocol_state;

    // Only admin can unfreeze
    require!(
        protocol_state.admin == ctx.accounts.admin.key(),
        LendGuardError::UnauthorizedCaller
    );

    let vault = &mut ctx.accounts.vault;

    // Unfreeze
    vault.frozen = false;
    // Note: Protocol-level frozen flag must be cleared separately or by another authority

    let current_time = Clock::get()?.unix_timestamp;

    emit!(ProtocolUnfrozen {
        vault_id: vault.vault_id,
        timestamp: current_time,
    });

    Ok(())
}
