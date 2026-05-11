use anchor_lang::prelude::*;

/// Off-chain keeper-signed attestation of a Bitcoin testnet address balance.
///
/// Because Ika by design does not read the Bitcoin chain (its job is signing,
/// not observation), the only way for a Solana program to know how much tBTC
/// sits at a `tb1q…` address is for a trusted keeper to attest it. The
/// keeper runs off-chain (`keepers/btc-balance-keeper`), polls
/// `mempool.space/testnet/api/address/{tb1q…}` on a tight loop, and calls
/// `attest_btc_balance` with the latest snapshot.
///
/// One `BitcoinBalanceAttestation` per `BtcVaultAccount`. The PDA is
/// init'd once during `register_btc_vault` and then mutated by every
/// subsequent keeper call.
///
/// Production hardening (out-of-scope for hackathon):
/// - Replace the single admin keeper with a 3-of-5 multi-keeper M-of-N gate.
/// - Or replace the keeper entirely with an SPV / zk Bitcoin header-chain
///   inclusion proof verified on-chain.
#[account]
pub struct BitcoinBalanceAttestation {
    pub btc_vault: Pubkey,
    pub bitcoin_address: [u8; 64],
    pub bitcoin_address_len: u8,
    pub satoshis: u64,
    pub bitcoin_block_height: u64,
    pub bitcoin_block_hash: [u8; 32],
    pub attested_at_slot: u64,
    pub attested_at_unix: i64,
    pub keeper: Pubkey,
    pub bump: u8,
}

impl BitcoinBalanceAttestation {
    pub const LEN: usize = 8 + // discriminator
        32 + // btc_vault
        64 + // bitcoin_address (padded)
        1 +  // bitcoin_address_len
        8 +  // satoshis
        8 +  // bitcoin_block_height
        32 + // bitcoin_block_hash
        8 +  // attested_at_slot
        8 +  // attested_at_unix
        32 + // keeper
        1;   // bump
}
