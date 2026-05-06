use anchor_lang::prelude::*;
use crate::state::VaultAccount;
use crate::events::ProofVerified;
use crate::errors::LendGuardError;
use crate::constants::*;

#[derive(Accounts)]
pub struct VerifyCustodyProof<'info> {
    #[account(mut)]
    pub vault: Account<'info, VaultAccount>,

    /// The Ika MessageApproval account containing the signature
    pub message_approval: AccountInfo<'info>,

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

    let current_time = Clock::get()?.unix_timestamp;

    // TODO: Parse Ika MessageApproval account
    // This would involve:
    // 1. Reading the MessageApproval account data
    // 2. Verifying the signature status is "Signed"
    // 3. Checking the message_hash and signature
    // 4. Verifying timestamp is recent

    // For now, we mark as verified with basic validation
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

    let current_time = Clock::get()?.unix_timestamp;

    // Check if proof has expired
    let time_since_verification = current_time - vault.proof_timestamp;
    require!(
        time_since_verification <= PROOF_EXPIRY_SECONDS,
        LendGuardError::ProofExpired
    );

    // TODO: Verify new MessageApproval from Ika

    // Update timestamp to extend proof validity
    vault.proof_timestamp = current_time;

    emit!(crate::events::ProofRefreshed {
        vault_id: vault.vault_id,
        new_timestamp: current_time,
    });

    Ok(())
}
