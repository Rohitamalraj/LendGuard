use anchor_lang::prelude::*;

use crate::constants::RISK_STATE_PDA_SEED;
use crate::errors::LendGuardError;
use crate::state::{RiskStateAccount, VaultAccount};

#[derive(Accounts)]
pub struct InitializeRiskState<'info> {
    #[account(
        init,
        payer = owner,
        space = RiskStateAccount::LEN,
        seeds = [RISK_STATE_PDA_SEED, vault.key().as_ref()],
        bump
    )]
    pub risk_state: Account<'info, RiskStateAccount>,

    pub vault: Account<'info, VaultAccount>,

    #[account(mut)]
    pub owner: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn initialize_risk_state(
    ctx: Context<InitializeRiskState>,
    threshold_ciphertext: Pubkey,
) -> Result<()> {
    require!(
        ctx.accounts.vault.owner == ctx.accounts.owner.key(),
        LendGuardError::UnauthorizedCaller
    );

    let risk_state = &mut ctx.accounts.risk_state;
    risk_state.vault_id = ctx.accounts.vault.key();
    risk_state.backing_ciphertext = Pubkey::default();
    risk_state.threshold_ciphertext = threshold_ciphertext;
    risk_state.last_check_result = true;
    risk_state.last_check_timestamp = 0;
    risk_state.bump = ctx.bumps.risk_state;

    Ok(())
}
