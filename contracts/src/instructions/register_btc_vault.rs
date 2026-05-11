use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::LendGuardError;
use crate::events::BtcVaultRegistered;
use crate::state::{BitcoinBalanceAttestation, BtcVaultAccount, ProtocolStateAccount};

#[derive(Accounts)]
#[instruction(ika_dwallet: Pubkey)]
pub struct RegisterBtcVault<'info> {
    #[account(
        init,
        payer = owner,
        space = BtcVaultAccount::LEN,
        seeds = [BTC_VAULT_PDA_SEED, owner.key().as_ref(), ika_dwallet.as_ref()],
        bump
    )]
    pub btc_vault: Account<'info, BtcVaultAccount>,

    #[account(
        init,
        payer = owner,
        space = BitcoinBalanceAttestation::LEN,
        seeds = [BTC_ATTESTATION_PDA_SEED, btc_vault.key().as_ref()],
        bump
    )]
    pub btc_attestation: Account<'info, BitcoinBalanceAttestation>,

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

pub fn register_btc_vault(
    ctx: Context<RegisterBtcVault>,
    ika_dwallet: Pubkey,
    dwallet_pubkey: [u8; 33],
    bitcoin_address: Vec<u8>,
) -> Result<()> {
    require!(
        bitcoin_address.len() >= 4 && bitcoin_address.len() <= 64,
        LendGuardError::InvalidBitcoinAddress
    );
    require!(
        bitcoin_address[0] == b't' && bitcoin_address[1] == b'b' && bitcoin_address[2] == b'1',
        LendGuardError::InvalidBitcoinAddress
    );
    require!(
        bitcoin_address[3] == b'q' || bitcoin_address[3] == b'p',
        LendGuardError::InvalidBitcoinAddress
    );
    require!(
        dwallet_pubkey[0] == 0x02 || dwallet_pubkey[0] == 0x03,
        LendGuardError::InvalidDwalletPubkey
    );

    let now = Clock::get()?.unix_timestamp;
    let btc_vault_key = ctx.accounts.btc_vault.key();

    let mut padded_address = [0u8; 64];
    padded_address[..bitcoin_address.len()].copy_from_slice(&bitcoin_address);

    let btc_vault = &mut ctx.accounts.btc_vault;
    btc_vault.vault_id = btc_vault_key;
    btc_vault.owner = ctx.accounts.owner.key();
    btc_vault.ika_dwallet = ika_dwallet;
    btc_vault.dwallet_pubkey = dwallet_pubkey;
    btc_vault.bitcoin_address = padded_address;
    btc_vault.bitcoin_address_len = bitcoin_address.len() as u8;
    btc_vault.deposited_satoshis = 0;
    btc_vault.last_attestation_slot = 0;
    btc_vault.proof_status = PROOF_STATUS_PENDING;
    btc_vault.proof_timestamp = 0;
    btc_vault.frozen = false;
    btc_vault.liquidation_initiated_at = 0;
    btc_vault.liquidation_sighash = [0u8; 32];
    btc_vault.bump = ctx.bumps.btc_vault;

    let btc_attestation = &mut ctx.accounts.btc_attestation;
    btc_attestation.btc_vault = btc_vault_key;
    btc_attestation.bitcoin_address = padded_address;
    btc_attestation.bitcoin_address_len = bitcoin_address.len() as u8;
    btc_attestation.satoshis = 0;
    btc_attestation.bitcoin_block_height = 0;
    btc_attestation.bitcoin_block_hash = [0u8; 32];
    btc_attestation.attested_at_slot = 0;
    btc_attestation.attested_at_unix = 0;
    btc_attestation.keeper = Pubkey::default();
    btc_attestation.bump = ctx.bumps.btc_attestation;

    let protocol_state = &mut ctx.accounts.protocol_state;
    protocol_state.total_vaults = protocol_state
        .total_vaults
        .checked_add(1)
        .ok_or(LendGuardError::ArithmeticOverflow)?;

    emit!(BtcVaultRegistered {
        vault_id: btc_vault_key,
        owner: ctx.accounts.owner.key(),
        ika_dwallet,
        bitcoin_address: padded_address,
        bitcoin_address_len: bitcoin_address.len() as u8,
        timestamp: now,
    });

    Ok(())
}
