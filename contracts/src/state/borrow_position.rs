use anchor_lang::prelude::*;

#[account]
pub struct BorrowPosition {
    pub vault: Pubkey,
    pub owner: Pubkey,
    pub borrow_asset: Pubkey,
    pub principal: u64,
    pub borrowed_at: i64,
    pub last_updated_at: i64,
    pub borrow_index_snapshot: u128,
    pub health_ciphertext: Pubkey,
    pub bump: u8,
}

impl BorrowPosition {
    pub const LEN: usize = 8 + // discriminator
        32 + // vault
        32 + // owner
        32 + // borrow_asset
        8 +  // principal
        8 +  // borrowed_at
        8 +  // last_updated_at
        16 + // borrow_index_snapshot (u128)
        32 + // health_ciphertext
        1;   // bump
}
