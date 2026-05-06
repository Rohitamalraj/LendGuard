use anchor_lang::prelude::*;
use crate::state::VaultAccount;
use crate::events::VaultRegistered;
use crate::constants::*;

#[derive(Accounts)]
#[instruction(bump: u8)]
pub struct RegisterVault<'info> {
    #[account(mut)]
    pub vault: Account<'info, VaultAccount>,

    #[account(mut)]
    pub owner: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn register_vault(
    ctx: Context<RegisterVault>,
    dwallet_id: [u8; 32],
    asset_type: u8,
    _bump: u8,
) -> Result<()> {
    require!(asset_type <= 2, ProgramError::InvalidArgument);

    let vault = &mut ctx.accounts.vault;
    vault.vault_id = ctx.accounts.vault.key();
    vault.owner = ctx.accounts.owner.key();
    vault.dwallet_id = dwallet_id;
    vault.asset_type = asset_type;
    vault.deposited_amount = 0;
    vault.proof_status = PROOF_STATUS_PENDING;
    vault.proof_timestamp = 0;
    vault.frozen = false;
    vault.bump = _bump;

    emit!(VaultRegistered {
        vault_id: vault.vault_id,
        owner: vault.owner,
        dwallet_id,
        asset_type,
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}
