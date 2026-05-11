use anchor_lang::prelude::*;

/// Bitcoin testnet collateral vault, backed by an Ika Secp256k1 dWallet whose
/// `tb1q…` address is observed by an off-chain balance keeper. Parallel to
/// the original `VaultAccount` (Curve25519 + SOL lamports) — the two never
/// share PDAs or state, but both can be sourced for borrows against the same
/// LGUSD lending pool.
///
/// Design notes:
/// - `ika_dwallet` is the on-chain Pubkey of the Ika DWallet account
///   (PDA derived inside the Ika program from `curve_u16_le || public_key`).
///   We use this 32-byte address as the third PDA seed to keep our seeds
///   inside Solana's 32-byte limit.
/// - `dwallet_pubkey` stores the raw 33-byte compressed Secp256k1 public key
///   so anyone reading the account can re-derive the `tb1q…` address and
///   verify the BIP143 sighash construction off-chain.
/// - `bitcoin_address` is the bech32-encoded testnet address (`tb1q…` for
///   P2WPKH or `tb1p…` for P2TR). Stored as raw bytes with a length tag so
///   the keeper can match it against the address it polls.
/// - `deposited_satoshis` and `last_attestation_slot` are convenience
///   shortcuts — the canonical source of truth is the
///   `BitcoinBalanceAttestation` PDA.
/// - `liquidation_initiated_at` / `liquidation_sighash` track an in-flight
///   liquidation that is waiting for the Bitcoin testnet broadcaster keeper
///   to publish the signed tx and finalize on Solana.
#[account]
pub struct BtcVaultAccount {
    pub vault_id: Pubkey,
    pub owner: Pubkey,
    pub ika_dwallet: Pubkey,
    pub dwallet_pubkey: [u8; 33],
    pub bitcoin_address: [u8; 64],
    pub bitcoin_address_len: u8,
    pub deposited_satoshis: u64,
    pub last_attestation_slot: u64,
    pub proof_status: u8,
    pub proof_timestamp: i64,
    pub frozen: bool,
    pub liquidation_initiated_at: i64,
    pub liquidation_sighash: [u8; 32],
    pub bump: u8,
}

impl BtcVaultAccount {
    pub const LEN: usize = 8 + // discriminator
        32 + // vault_id
        32 + // owner
        32 + // ika_dwallet
        33 + // dwallet_pubkey (compressed Secp256k1)
        64 + // bitcoin_address (padded; max bech32 testnet ~62 chars)
        1 +  // bitcoin_address_len
        8 +  // deposited_satoshis
        8 +  // last_attestation_slot
        1 +  // proof_status
        8 +  // proof_timestamp
        1 +  // frozen
        8 +  // liquidation_initiated_at
        32 + // liquidation_sighash
        1;   // bump
}
