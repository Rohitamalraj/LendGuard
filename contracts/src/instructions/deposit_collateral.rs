use anchor_lang::prelude::*;
use crate::constants::PROTOCOL_STATE_PDA_SEED;
use crate::state::{VaultAccount, ProtocolStateAccount};
use crate::events::{CollateralDeposited, CollateralRejected};
use crate::errors::LendGuardError;
use crate::constants::*;

#[derive(Accounts)]
pub struct DepositCollateral<'info> {
    #[account(mut)]
    pub vault: Account<'info, VaultAccount>,

    #[account(
        mut,
        seeds = [PROTOCOL_STATE_PDA_SEED],
        bump = protocol_state.bump
    )]
    pub protocol_state: Account<'info, ProtocolStateAccount>,

    #[account(mut)]
    pub depositor: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn deposit_collateral(
    ctx: Context<DepositCollateral>,
    amount: u64,
) -> Result<()> {
    let vault = &mut ctx.accounts.vault;
    let protocol = &mut ctx.accounts.protocol_state;
    require!(
        vault.owner == ctx.accounts.depositor.key(),
        LendGuardError::UnauthorizedCaller
    );

    // KelpDAO FIX: Reject if vault proof not verified
    require!(
        vault.proof_status == PROOF_STATUS_VERIFIED,
        LendGuardError::VaultNotVerified
    );

    // Circuit breaker: Reject if protocol frozen
    require!(
        !protocol.frozen,
        LendGuardError::ProtocolFrozen
    );

    // Circuit breaker: Reject if vault frozen
    require!(
        !vault.frozen,
        LendGuardError::VaultFrozen
    );

    // Validate amount
    require!(amount > 0, LendGuardError::InvalidDepositAmount);

    // Check proof hasn't expired
    let current_time = Clock::get()?.unix_timestamp;
    let time_since_proof = current_time - vault.proof_timestamp;
    require!(
        time_since_proof <= PROOF_EXPIRY_SECONDS,
        LendGuardError::ProofExpired
    );

    // Update vault balance
    vault.deposited_amount = vault.deposited_amount
        .checked_add(amount)
        .ok_or(LendGuardError::ArithmeticOverflow)?;

    // Update protocol stats
    protocol.total_collateral_verified = protocol.total_collateral_verified
        .checked_add(amount as u128)
        .ok_or(LendGuardError::ArithmeticOverflow)?;

    emit!(CollateralDeposited {
        vault_id: vault.vault_id,
        amount,
        wallet: ctx.accounts.depositor.key(),
        total_deposited: vault.deposited_amount,
        timestamp: current_time,
    });

    Ok(())
}

pub fn withdraw_collateral(
    ctx: Context<DepositCollateral>,
    amount: u64,
) -> Result<()> {
    let vault = &mut ctx.accounts.vault;
    let protocol = &mut ctx.accounts.protocol_state;
    require!(
        vault.owner == ctx.accounts.depositor.key(),
        LendGuardError::UnauthorizedCaller
    );

    // Circuit breaker: Reject if protocol frozen
    require!(
        !protocol.frozen,
        LendGuardError::ProtocolFrozen
    );

    // Vault owner can still withdraw even if vault is frozen (to exit position)
    // But protocol frozen blocks all withdrawals

    // Validate amount
    require!(
        amount > 0 && amount <= vault.deposited_amount,
        LendGuardError::InvalidWithdrawalAmount
    );

    // Update vault balance
    vault.deposited_amount = vault.deposited_amount
        .checked_sub(amount)
        .ok_or(LendGuardError::ArithmeticOverflow)?;

    // Update protocol stats
    protocol.total_collateral_verified = protocol.total_collateral_verified
        .checked_sub(amount as u128)
        .ok_or(LendGuardError::ArithmeticOverflow)?;

    let current_time = Clock::get()?.unix_timestamp;

    emit!(crate::events::CollateralWithdrawn {
        vault_id: vault.vault_id,
        amount,
        wallet: ctx.accounts.depositor.key(),
        remaining_balance: vault.deposited_amount,
        timestamp: current_time,
    });

    Ok(())
}

pub fn reject_unverified_deposit(
    ctx: Context<DepositCollateral>,
    amount: u64,
    reason: String,
) -> Result<()> {
    let vault = &mut ctx.accounts.vault;
    let protocol = &mut ctx.accounts.protocol_state;
    let depositor_key = ctx.accounts.depositor.key();

    require!(
        protocol.admin == depositor_key,
        LendGuardError::UnauthorizedCaller
    );

    // Increment rejected count
    protocol.total_rejected = protocol.total_rejected
        .checked_add(1)
        .ok_or(LendGuardError::ArithmeticOverflow)?;

    let current_time = Clock::get()?.unix_timestamp;

    emit!(CollateralRejected {
        vault_id: vault.vault_id,
        wallet: depositor_key,
        amount,
        reason,
        timestamp: current_time,
    });

    Ok(())
}
