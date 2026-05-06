use anchor_lang::prelude::*;
use crate::constants::{PROTOCOL_STATE_PDA_SEED, RISK_STATE_PDA_SEED};
use crate::state::{ProtocolStateAccount, RiskStateAccount, VaultAccount};
use crate::events::BackingStateUpdated;
use crate::errors::LendGuardError;

#[derive(Accounts)]
pub struct UpdateBackingState<'info> {
    pub vault: Account<'info, VaultAccount>,

    #[account(
        mut,
        seeds = [RISK_STATE_PDA_SEED, vault.key().as_ref()],
        bump = risk_state.bump
    )]
    pub risk_state: Account<'info, RiskStateAccount>,

    #[account(
        seeds = [PROTOCOL_STATE_PDA_SEED],
        bump = protocol_state.bump
    )]
    pub protocol_state: Account<'info, ProtocolStateAccount>,

    /// The Encrypt program for ciphertext creation
    pub encrypt_program: AccountInfo<'info>,

    /// Ciphertext account to store encrypted backing value
    #[account(mut)]
    pub backing_ciphertext: AccountInfo<'info>,

    /// Oracle or authorized feed that updates backing
    pub oracle: Signer<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn update_backing_state(
    ctx: Context<UpdateBackingState>,
    _new_backing_amount: u64,
) -> Result<()> {
    let risk_state = &mut ctx.accounts.risk_state;

    // Pre-alpha access control: protocol admin is the only authorized oracle.
    require!(
        ctx.accounts.protocol_state.admin == ctx.accounts.oracle.key(),
        LendGuardError::UnauthorizedCaller
    );
    require!(
        risk_state.vault_id == ctx.accounts.vault.key(),
        LendGuardError::VaultNotFound
    );
    require!(
        !ctx.accounts.backing_ciphertext.key().eq(&Pubkey::default()),
        LendGuardError::InvalidCiphertextAccount
    );

    // TODO: CPI call to Encrypt to create/update plaintext ciphertext
    // This would involve:
    // 1. Creating instruction data for Encrypt's create_plaintext_ciphertext or execute_graph
    // 2. Assembling accounts for Encrypt CPI
    // 3. Calling into Encrypt program
    // 4. Storing the ciphertext account in risk_state.backing_ciphertext

    // Pre-alpha: store ciphertext account key emitted by executor/input creation flow.
    risk_state.backing_ciphertext = ctx.accounts.backing_ciphertext.key();

    let current_time = Clock::get()?.unix_timestamp;

    emit!(BackingStateUpdated {
        vault_id: risk_state.vault_id,
        timestamp: current_time,
    });

    Ok(())
}
