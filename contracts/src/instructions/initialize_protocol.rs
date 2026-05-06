use anchor_lang::prelude::*;

use crate::constants::PROTOCOL_STATE_PDA_SEED;
use crate::state::ProtocolStateAccount;

#[derive(Accounts)]
pub struct InitializeProtocol<'info> {
    #[account(
        init,
        payer = admin,
        space = ProtocolStateAccount::LEN,
        seeds = [PROTOCOL_STATE_PDA_SEED],
        bump
    )]
    pub protocol_state: Account<'info, ProtocolStateAccount>,

    #[account(mut)]
    pub admin: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn initialize_protocol(ctx: Context<InitializeProtocol>) -> Result<()> {
    let protocol_state = &mut ctx.accounts.protocol_state;

    protocol_state.admin = ctx.accounts.admin.key();
    protocol_state.frozen = false;
    protocol_state.total_vaults = 0;
    protocol_state.total_verified = 0;
    protocol_state.total_rejected = 0;
    protocol_state.total_collateral_verified = 0;
    protocol_state.bump = ctx.bumps.protocol_state;

    Ok(())
}
