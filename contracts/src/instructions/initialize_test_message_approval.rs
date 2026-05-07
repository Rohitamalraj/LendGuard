use anchor_lang::prelude::*;

/// DevNet ONLY: Initialize a MessageApproval account with test data
/// This instruction exists only for devnet testing and will be removed before mainnet
#[derive(Accounts)]
pub struct InitializeTestMessageApproval<'info> {
    #[account(mut)]
    pub message_approval: AccountInfo<'info>,
    
    pub payer: Signer<'info>,
}

pub fn initialize_test_message_approval(
    ctx: Context<InitializeTestMessageApproval>,
    dwallet_id: [u8; 32],
) -> Result<()> {
    let account = &mut ctx.accounts.message_approval;
    
    // Verify account is large enough (49 bytes minimum)
    require!(account.data_len() >= 49, error!(ErrorCode::InvalidMessageApproval));
    
    let mut data = account.try_borrow_mut_data()?;
    
    // Initialize MessageApproval data
    // Offset 0-7: discriminator (zeros)
    // Offset 8-39: dwallet_id
    data[8..40].copy_from_slice(&dwallet_id);
    
    // Offset 40-47: approved_at (current time as i64 LE)
    let now = Clock::get()?.unix_timestamp;
    data[40..48].copy_from_slice(&now.to_le_bytes());
    
    // Offset 48: is_signed = 1
    data[48] = 1;
    
    msg!("✓ Initialized MessageApproval with dwallet_id: {:?}", dwallet_id);
    
    Ok(())
}

#[error_code]
pub enum ErrorCode {
    InvalidMessageApproval = 6000,
}
