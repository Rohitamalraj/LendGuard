use anchor_lang::prelude::*;

#[account]
pub struct AdminPriceFeed {
    pub asset_type: u8,
    pub price_usd: u64,
    pub updated_at: i64,
    pub admin: Pubkey,
    pub bump: u8,
}

impl AdminPriceFeed {
    pub const LEN: usize = 8 + // discriminator
        1 +  // asset_type
        8 +  // price_usd, 8 decimals
        8 +  // updated_at
        32 + // admin
        1;   // bump
}
