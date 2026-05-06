use anchor_lang::prelude::*;

#[account]
pub struct RiskStateAccount {
    pub vault_id: Pubkey,                    // Associated vault
    pub backing_ciphertext: Pubkey,          // Encrypt ciphertext account (backing ratio)
    pub threshold_ciphertext: Pubkey,        // Encrypt ciphertext account (threshold)
    pub last_check_result: bool,             // Latest EBool output (safe=true, unsafe=false)
    pub last_check_timestamp: i64,           // When last checked
    pub bump: u8,                            // PDA bump
}

impl RiskStateAccount {
    pub const LEN: usize = 8 + // discriminator
        32 +    // vault_id
        32 +    // backing_ciphertext
        32 +    // threshold_ciphertext
        1 +     // last_check_result
        8 +     // last_check_timestamp
        1;      // bump
}
