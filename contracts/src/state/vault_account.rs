use anchor_lang::prelude::*;

#[account]
pub struct VaultAccount {
    pub vault_id: Pubkey,                    // Vault identifier
    pub owner: Pubkey,                       // Vault creator/owner
    pub dwallet_id: [u8; 32],                // Ika dWallet public key
    pub asset_type: u8,                      // BTC=0, ETH=1, SOL=2
    pub deposited_amount: u64,               // Total collateral deposited
    pub proof_status: u8,                    // 0=Pending, 1=Verified, 2=Expired
    pub proof_timestamp: i64,                // When proof was last verified
    pub frozen: bool,                        // Per-vault freeze flag
    pub bump: u8,                            // PDA bump
}

impl VaultAccount {
    pub const LEN: usize = 8 + // discriminator
        32 +    // vault_id
        32 +    // owner
        32 +    // dwallet_id
        1 +     // asset_type
        8 +     // deposited_amount
        1 +     // proof_status
        8 +     // proof_timestamp
        1 +     // frozen
        1;      // bump
}
