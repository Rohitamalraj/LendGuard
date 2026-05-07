// Demo-only helper instructions used by the LendGuard pre-alpha frontend
// to create on-chain mock accounts that mimic outputs of the Ika and Encrypt
// pre-alpha networks (which do not have stable browser SDKs yet).
//
// In production these accounts are produced by:
// - Ika: 2PC-MPC `approve_message` flow → MessageApproval account
// - Encrypt: `execute_graph` → result ciphertext account
//
// These helpers exist purely so the LendGuard demo can showcase fully
// on-chain transactions for the entire 6-step flow without requiring the
// off-chain Ika / Encrypt networks during a hackathon demo.

use anchor_lang::prelude::*;

use crate::errors::LendGuardError;

const MESSAGE_APPROVAL_SIZE: usize = 49;
const CIPHERTEXT_SIZE: usize = 1;

const MESSAGE_APPROVAL_SEED: &[u8] = b"demo_msg_approval";
const CIPHERTEXT_SEED: &[u8] = b"demo_ciphertext";

// ─── demo_create_message_approval ────────────────────────────────────────────

#[derive(Accounts)]
#[instruction(dwallet_id: [u8; 32])]
pub struct DemoCreateMessageApproval<'info> {
    #[account(
        init,
        payer = payer,
        space = MESSAGE_APPROVAL_SIZE,
        seeds = [MESSAGE_APPROVAL_SEED, payer.key().as_ref(), dwallet_id.as_ref()],
        bump,
    )]
    /// CHECK: account is initialized with the same byte layout the
    /// `parse_message_approval` integration adapter expects from a real Ika
    /// MessageApproval account. Owned by this program for demo purposes.
    pub message_approval: UncheckedAccount<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn demo_create_message_approval(
    ctx: Context<DemoCreateMessageApproval>,
    dwallet_id: [u8; 32],
    is_signed: bool,
) -> Result<()> {
    let approved_at = Clock::get()?.unix_timestamp;
    let acct = &ctx.accounts.message_approval;
    let mut data = acct.try_borrow_mut_data()?;

    require!(
        data.len() == MESSAGE_APPROVAL_SIZE,
        LendGuardError::InvalidMessageApproval
    );

    // Layout (matches contracts/src/integrations/ika.rs parse_message_approval):
    //   0..8     discriminator (zeros — mock)
    //   8..40    dwallet_id
    //   40..48   approved_at (i64 LE)
    //   48       is_signed (1 byte)
    for b in data[0..8].iter_mut() {
        *b = 0;
    }
    data[8..40].copy_from_slice(&dwallet_id);
    data[40..48].copy_from_slice(&approved_at.to_le_bytes());
    data[48] = if is_signed { 1 } else { 0 };

    Ok(())
}

// ─── demo_create_ciphertext ──────────────────────────────────────────────────

#[derive(Accounts)]
#[instruction(label: [u8; 8])]
pub struct DemoCreateCiphertext<'info> {
    #[account(
        init,
        payer = payer,
        space = CIPHERTEXT_SIZE,
        seeds = [CIPHERTEXT_SEED, payer.key().as_ref(), &label],
        bump,
    )]
    /// CHECK: 1-byte ciphertext mock — `read_mocked_ebool` reads byte[0] as
    /// the EBool result.
    pub ciphertext: UncheckedAccount<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn demo_create_ciphertext(
    ctx: Context<DemoCreateCiphertext>,
    _label: [u8; 8],
    value: u8,
) -> Result<()> {
    let acct = &ctx.accounts.ciphertext;
    let mut data = acct.try_borrow_mut_data()?;
    require!(
        data.len() == CIPHERTEXT_SIZE,
        LendGuardError::InvalidCiphertextAccount
    );
    data[0] = value;
    Ok(())
}
