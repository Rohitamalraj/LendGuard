use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::LendGuardError;
use crate::events::BtcAttestationPosted;
use crate::state::{BitcoinBalanceAttestation, BtcVaultAccount, ProtocolStateAccount};

#[derive(Accounts)]
pub struct AttestBtcBalance<'info> {
    #[account(mut)]
    pub btc_vault: Account<'info, BtcVaultAccount>,

    #[account(
        mut,
        seeds = [BTC_ATTESTATION_PDA_SEED, btc_vault.key().as_ref()],
        bump = btc_attestation.bump,
        constraint = btc_attestation.btc_vault == btc_vault.key()
            @ LendGuardError::BitcoinAttestationMismatch,
    )]
    pub btc_attestation: Account<'info, BitcoinBalanceAttestation>,

    #[account(
        seeds = [PROTOCOL_STATE_PDA_SEED],
        bump = protocol_state.bump
    )]
    pub protocol_state: Account<'info, ProtocolStateAccount>,

    pub keeper: Signer<'info>,
}

pub fn attest_btc_balance(
    ctx: Context<AttestBtcBalance>,
    satoshis: u64,
    bitcoin_block_height: u64,
    bitcoin_block_hash: [u8; 32],
) -> Result<()> {
    require!(
        ctx.accounts.keeper.key() == ctx.accounts.protocol_state.admin,
        LendGuardError::KeeperNotAuthorised
    );
    require!(
        ctx.accounts.btc_attestation.bitcoin_address == ctx.accounts.btc_vault.bitcoin_address
            && ctx.accounts.btc_attestation.bitcoin_address_len
                == ctx.accounts.btc_vault.bitcoin_address_len,
        LendGuardError::BitcoinAttestationMismatch
    );

    let now = Clock::get()?.unix_timestamp;
    let slot = Clock::get()?.slot;

    let btc_attestation = &mut ctx.accounts.btc_attestation;
    btc_attestation.satoshis = satoshis;
    btc_attestation.bitcoin_block_height = bitcoin_block_height;
    btc_attestation.bitcoin_block_hash = bitcoin_block_hash;
    btc_attestation.attested_at_slot = slot;
    btc_attestation.attested_at_unix = now;
    btc_attestation.keeper = ctx.accounts.keeper.key();

    let btc_vault = &mut ctx.accounts.btc_vault;
    btc_vault.deposited_satoshis = satoshis;
    btc_vault.last_attestation_slot = slot;

    emit!(BtcAttestationPosted {
        vault_id: btc_vault.vault_id,
        satoshis,
        bitcoin_block_height,
        keeper: ctx.accounts.keeper.key(),
        timestamp: now,
    });

    Ok(())
}
