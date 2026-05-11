use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::LendGuardError;
use crate::events::BtcProofVerified;
use crate::integrations::parse_message_approval_for_btc_dwallet;
use crate::state::BtcVaultAccount;

#[derive(Accounts)]
pub struct VerifyBtcCustodyProof<'info> {
    #[account(
        mut,
        has_one = owner @ LendGuardError::UnauthorizedCaller,
    )]
    pub btc_vault: Account<'info, BtcVaultAccount>,

    /// CHECK: Real Ika `MessageApproval` account. The parser validates the
    /// discriminator, version, signed status, Secp256k1 scheme, and that bytes
    /// 2..34 equal `btc_vault.ika_dwallet`.
    pub message_approval: UncheckedAccount<'info>,

    pub owner: Signer<'info>,
}

pub fn verify_btc_custody_proof(ctx: Context<VerifyBtcCustodyProof>) -> Result<()> {
    require!(
        ctx.accounts.btc_vault.proof_status == PROOF_STATUS_PENDING
            || ctx.accounts.btc_vault.proof_status == PROOF_STATUS_EXPIRED,
        LendGuardError::VaultAlreadyVerified
    );

    let now = Clock::get()?.unix_timestamp;
    parse_message_approval_for_btc_dwallet(
        &ctx.accounts.message_approval,
        &ctx.accounts.btc_vault.ika_dwallet,
        now,
    )?;

    let btc_vault = &mut ctx.accounts.btc_vault;
    btc_vault.proof_status = PROOF_STATUS_VERIFIED;
    btc_vault.proof_timestamp = now;

    emit!(BtcProofVerified {
        vault_id: btc_vault.vault_id,
        ika_dwallet: btc_vault.ika_dwallet,
        timestamp: now,
    });

    Ok(())
}

pub fn refresh_btc_custody_proof(ctx: Context<VerifyBtcCustodyProof>) -> Result<()> {
    require!(
        ctx.accounts.btc_vault.proof_status == PROOF_STATUS_VERIFIED,
        LendGuardError::BtcVaultNotVerified
    );

    let now = Clock::get()?.unix_timestamp;
    parse_message_approval_for_btc_dwallet(
        &ctx.accounts.message_approval,
        &ctx.accounts.btc_vault.ika_dwallet,
        now,
    )?;

    ctx.accounts.btc_vault.proof_timestamp = now;

    emit!(BtcProofVerified {
        vault_id: ctx.accounts.btc_vault.vault_id,
        ika_dwallet: ctx.accounts.btc_vault.ika_dwallet,
        timestamp: now,
    });

    Ok(())
}
