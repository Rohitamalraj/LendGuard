use anchor_lang::prelude::*;
use crate::state::{ProtocolStateAccount, VaultAccount};
use crate::events::VaultRegistered;
use crate::errors::LendGuardError;
use crate::constants::*;

#[derive(Accounts)]
#[instruction(dwallet_id: [u8; 32])]
pub struct RegisterVault<'info> {
    #[account(
        init,
        payer = owner,
        space = VaultAccount::LEN,
        seeds = [VAULT_PDA_SEED, owner.key().as_ref(), dwallet_id.as_ref()],
        bump
    )]
    pub vault: Account<'info, VaultAccount>,

    #[account(
        mut,
        seeds = [PROTOCOL_STATE_PDA_SEED],
        bump = protocol_state.bump
    )]
    pub protocol_state: Account<'info, ProtocolStateAccount>,

    #[account(mut)]
    pub owner: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn register_vault(
    ctx: Context<RegisterVault>,
    dwallet_id: [u8; 32],
    asset_type: u8,
) -> Result<()> {
    require!(
        asset_type == ASSET_BTC || asset_type == ASSET_ETH || asset_type == ASSET_SOL,
        LendGuardError::InvalidAssetType
    );

    let vault_key = ctx.accounts.vault.key();
    let vault = &mut ctx.accounts.vault;
    let protocol_state = &mut ctx.accounts.protocol_state;

    vault.vault_id = vault_key;
    vault.owner = ctx.accounts.owner.key();
    vault.dwallet_id = dwallet_id;
    vault.asset_type = asset_type;
    vault.deposited_amount = 0;
    vault.proof_status = PROOF_STATUS_PENDING;
    vault.proof_timestamp = 0;
    vault.frozen = false;
    vault.bump = ctx.bumps.vault;

    protocol_state.total_vaults = protocol_state
        .total_vaults
        .checked_add(1)
        .ok_or(LendGuardError::ArithmeticOverflow)?;

    emit!(VaultRegistered {
        vault_id: vault.vault_id,
        owner: vault.owner,
        dwallet_id,
        asset_type,
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}
