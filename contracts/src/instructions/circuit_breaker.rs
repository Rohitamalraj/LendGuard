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

    require!(
        protocol_state.admin == ctx.accounts.admin.key(),
        LendGuardError::UnauthorizedCaller
    );

    let vault = &mut ctx.accounts.vault;

    vault.frozen = false;

    let current_time = Clock::get()?.unix_timestamp;

    emit!(ProtocolUnfrozen {
        vault_id: vault.vault_id,
        timestamp: current_time,
    });

    Ok(())
}

#[derive(Accounts)]
pub struct UnfreezeProtocolState<'info> {
    #[account(
        mut,
        seeds = [PROTOCOL_STATE_PDA_SEED],
        bump = protocol_state.bump
    )]
    pub protocol_state: Account<'info, ProtocolStateAccount>,

    pub admin: Signer<'info>,
}

/// Clear the protocol-level `frozen` flag. **Demo-mode permissionless reset.**
///
/// `protocol_state` is a global singleton PDA on devnet — every wallet that
/// runs the demo shares it. The original deployer keypair would otherwise
/// be the only signer that could re-arm the demo, which makes it impossible
/// for hackathon judges (or anyone testing with a new wallet) to replay
/// after the circuit breaker has fired once. We accept the trade-off here:
/// in production this would be admin-only or governance-gated; on devnet
/// it's a public reset lever so the demo is replayable.
pub fn unfreeze_protocol_state(
    ctx: Context<UnfreezeProtocolState>,
) -> Result<()> {
    let protocol_state = &mut ctx.accounts.protocol_state;
    protocol_state.frozen = false;
    Ok(())
}
