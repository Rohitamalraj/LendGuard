use anchor_lang::prelude::*;

#[account]
pub struct ProtocolStateAccount {
    pub admin: Pubkey,                       // Protocol administrator
    pub frozen: bool,                        // Global circuit breaker flag
    pub total_vaults: u64,                   // Total vaults created
    pub total_verified: u64,                 // Total verified vaults
    pub total_rejected: u64,                 // Total rejected deposits
    pub total_collateral_verified: u128,     // Total amount verified (in lamports/smallest unit)
    pub bump: u8,                            // PDA bump
}

impl ProtocolStateAccount {
    pub const LEN: usize = 8 + // discriminator
        32 +    // admin
        1 +     // frozen
        8 +     // total_vaults
        8 +     // total_verified
        8 +     // total_rejected
        16 +    // total_collateral_verified
        1;      // bump
}
