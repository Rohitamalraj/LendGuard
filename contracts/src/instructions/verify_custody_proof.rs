use anchor_lang::prelude::*;
use crate::errors::LendGuardError;
use crate::events::ProofVerified;
use crate::integrations::parse_message_approval;
use crate::state::VaultAccount;
use crate::constants::*;

#[derive(Accounts)]
pub struct VerifyCustodyProof<'info> {
    #[account(mut)]
    pub vault: Account<'info, VaultAccount>,

    /// CHECK: Real Ika MessageApproval PDA owned by the dWallet program. Its
    /// byte layout is validated inside `parse_message_approval` (signer flag,
    /// dWallet ID, freshness). Not deserialized into an Anchor account because
    /// it's owned by Ika, not LendGuard.
    pub message_approval: UncheckedAccount<'info>,

    #[account(mut)]
    pub signer: Signer<'info>,
}

pub fn verify_custody_proof(
    ctx: Context<VerifyCustodyProof>,
    expected_dwallet_id: [u8; 32],
) -> Result<()> {
    let vault = &mut ctx.accounts.vault;

    // Verify the vault isn't already verified
    require!(
        vault.proof_status == PROOF_STATUS_PENDING || vault.proof_status == PROOF_STATUS_EXPIRED,
        LendGuardError::VaultAlreadyVerified
    );

    // Verify dWallet ID matches (prevent vault hijacking)
    require!(
        vault.dwallet_id == expected_dwallet_id,
        LendGuardError::DWalletMismatch
    );
    require!(
        vault.owner == ctx.accounts.signer.key(),
        LendGuardError::UnauthorizedCaller
    );
    require!(
        !ctx.accounts.message_approval.key().eq(&Pubkey::default()),
        LendGuardError::InvalidMessageApproval
    );

    let current_time = Clock::get()?.unix_timestamp;

    // Parse and validate the Ika MessageApproval account.
    // Checks: MPC-signed, dWallet ID match, proof freshness within PROOF_EXPIRY_SECONDS.
    parse_message_approval(
        &ctx.accounts.message_approval,
        &expected_dwallet_id,
        current_time,
    )?;

    vault.proof_status = PROOF_STATUS_VERIFIED;
    vault.proof_timestamp = current_time;

    emit!(ProofVerified {
        vault_id: vault.vault_id,
        asset_type: vault.asset_type,
        amount: vault.deposited_amount,
        dwallet_id: vault.dwallet_id,
        timestamp: current_time,
    });

    Ok(())
}

pub fn refresh_custody_proof(
    ctx: Context<VerifyCustodyProof>,
    expected_dwallet_id: [u8; 32],
) -> Result<()> {
    let vault = &mut ctx.accounts.vault;

    // Verify the vault is already verified
    require!(
        vault.proof_status == PROOF_STATUS_VERIFIED,
        LendGuardError::VaultNotVerified
    );

    // Verify dWallet ID matches
    require!(
        vault.dwallet_id == expected_dwallet_id,
        LendGuardError::DWalletMismatch
    );
    require!(
        vault.owner == ctx.accounts.signer.key(),
        LendGuardError::UnauthorizedCaller
    );
    require!(
        !ctx.accounts.message_approval.key().eq(&Pubkey::default()),
        LendGuardError::InvalidMessageApproval
    );

    let current_time = Clock::get()?.unix_timestamp;

    // Check if proof has expired
    let time_since_verification = current_time - vault.proof_timestamp;
    require!(
        time_since_verification <= PROOF_EXPIRY_SECONDS,
        LendGuardError::ProofExpired
    );

    // Re-validate MessageApproval for freshness before extending.
    parse_message_approval(
        &ctx.accounts.message_approval,
        &expected_dwallet_id,
        current_time,
    )?;

    vault.proof_timestamp = current_time;

    emit!(crate::events::ProofRefreshed {
        vault_id: vault.vault_id,
        new_timestamp: current_time,
    });

    Ok(())
}
