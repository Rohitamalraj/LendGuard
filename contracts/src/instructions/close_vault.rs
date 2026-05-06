use anchor_lang::prelude::*;
use crate::state::VaultAccount;
use crate::events::VaultClosed;
use crate::errors::LendGuardError;

#[derive(Accounts)]
pub struct CloseVault<'info> {
    #[account(mut, close = owner)]
    pub vault: Account<'info, VaultAccount>,

    #[account(mut)]
    pub owner: Signer<'info>,
}

pub fn close_vault(
    ctx: Context<CloseVault>,
) -> Result<()> {
    let vault = &ctx.accounts.vault;

    // Can only close if no collateral deposited
    require!(
        vault.deposited_amount == 0,
        LendGuardError::InvalidWithdrawalAmount
    );

    let current_time = Clock::get()?.unix_timestamp;

    emit!(VaultClosed {
        vault_id: vault.vault_id,
        timestamp: current_time,
    });

    // Account is closed by Anchor via the close constraint above

    Ok(())
}
