// Real Ika `approve_message` CPI from LendGuard.
//
// Creates a real `MessageApproval` PDA on the Ika dWallet program
// (`87W54kGYFQ1rgWqMeu4XTPHWXWmXSQCcjm8vCTfiq1oY`). The dWallet's authority
// must already point to LendGuard's CPI authority PDA — see the off-chain
// flow in `web/lib/ika-flow.ts`.
//
// Once this completes, the on-chain layout matches the 287-byte format that
// `parse_message_approval` in `integrations/ika.rs` autodetects via the
// discriminator byte (`14`). `verify_custody_proof` then works end-to-end
// against a real Ika `MessageApproval`.

use anchor_lang::prelude::*;
use ika_dwallet_anchor::{CPI_AUTHORITY_SEED, DWalletContext};

use crate::state::VaultAccount;
use crate::errors::LendGuardError;

#[derive(Accounts)]
pub struct ApproveCustodySignature<'info> {
    /// Vault we're approving custody for. Owner-gated.
    #[account(
        mut,
        has_one = owner @ LendGuardError::UnauthorizedCaller,
    )]
    pub vault: Account<'info, VaultAccount>,

    /// CHECK: This LendGuard program — must be executable. The dWallet
    /// program verifies `executable` via `verify_signer_or_cpi`.
    #[account(executable, address = crate::ID)]
    pub caller_program: UncheckedAccount<'info>,

    /// CHECK: LendGuard's CPI authority PDA. The dWallet program verifies
    /// this == `PDA([__ika_cpi_authority], LENDGUARD_PROGRAM_ID)`.
    #[account(seeds = [CPI_AUTHORITY_SEED], bump)]
    pub cpi_authority: UncheckedAccount<'info>,

    /// CHECK: Ika dWallet program account.
    #[account(executable)]
    pub dwallet_program: UncheckedAccount<'info>,

    /// CHECK: Ika `DWalletCoordinator` PDA (read-only). Address verified by
    /// the dWallet program during CPI dispatch.
    pub coordinator: UncheckedAccount<'info>,

    /// CHECK: The dWallet account whose authority must equal `cpi_authority`.
    pub dwallet: UncheckedAccount<'info>,

    /// CHECK: `MessageApproval` PDA — created by the CPI. Caller derives the
    /// PDA + bump from `(b"message_approval", dwallet.key, message_digest)`.
    #[account(mut)]
    pub message_approval: UncheckedAccount<'info>,

    #[account(mut)]
    pub owner: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn approve_custody_signature(
    ctx: Context<ApproveCustodySignature>,
    message_digest: [u8; 32],
    message_metadata_digest: [u8; 32],
    user_pubkey: [u8; 32],
    signature_scheme: u16,
    message_approval_bump: u8,
) -> Result<()> {
    let dwallet_ctx = DWalletContext {
        dwallet_program: ctx.accounts.dwallet_program.to_account_info(),
        cpi_authority: ctx.accounts.cpi_authority.to_account_info(),
        caller_program: ctx.accounts.caller_program.to_account_info(),
        cpi_authority_bump: ctx.bumps.cpi_authority,
    };

    dwallet_ctx.approve_message(
        &ctx.accounts.coordinator.to_account_info(),
        &ctx.accounts.message_approval.to_account_info(),
        &ctx.accounts.dwallet.to_account_info(),
        &ctx.accounts.owner.to_account_info(),
        &ctx.accounts.system_program.to_account_info(),
        message_digest,
        message_metadata_digest,
        user_pubkey,
        signature_scheme,
        message_approval_bump,
    )?;

    Ok(())
}
