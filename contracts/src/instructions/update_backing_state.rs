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

    /// CHECK: Encrypt program (placeholder until full CPI lands; not invoked
    /// here — `update_backing_state` only stores the ciphertext pubkey).
    pub encrypt_program: UncheckedAccount<'info>,

    /// CHECK: Real Encrypt ciphertext account owned by the Encrypt program.
    /// We never write to it (that's the executor's job); we just record its
    /// pubkey in `risk_state.backing_ciphertext` so `trigger_risk_check` can
    /// pass it back as an input to `execute_graph`.
    #[account(mut)]
    pub backing_ciphertext: UncheckedAccount<'info>,

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

    // Pre-alpha access control: vault owner OR protocol admin can act as
    // oracle for their own risk state. Production keeps this admin-only so a
    // single trusted feed updates encrypted backing.
    require!(
        ctx.accounts.protocol_state.admin == ctx.accounts.oracle.key()
            || ctx.accounts.vault.owner == ctx.accounts.oracle.key(),
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
