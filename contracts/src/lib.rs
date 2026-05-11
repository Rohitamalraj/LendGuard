use anchor_lang::prelude::*;

mod state;
mod instructions;
mod integrations;
mod events;
mod errors;
mod constants;

// The FHE circuit definition (check_backing_ratio) is compiled separately for
// the Encrypt off-chain executor. It is not included in the Solana program binary
// because it depends on the pre-alpha encrypt-dsl crate.
#[cfg(feature = "fhe")]
mod fhe;

pub use state::*;
pub use instructions::*;
pub use integrations::*;
pub use events::*;
pub use errors::*;
pub use constants::*;

declare_id!("GQia1ewyLgtkgX7HSfuttJ42qNPpYJhUbxeyCPXtcJFR");

#[program]
pub mod lendguard_proof_vault {
    use super::*;

    /// Initialize protocol state PDA and admin.
    pub fn initialize_protocol(ctx: Context<InitializeProtocol>) -> Result<()> {
        instructions::initialize_protocol(ctx)
    }

    /// Register a new collateral vault linked to an Ika dWallet
    pub fn register_vault(
        ctx: Context<RegisterVault>,
        dwallet_id: [u8; 32],
        asset_type: u8,
    ) -> Result<()> {
        instructions::register_vault(ctx, dwallet_id, asset_type)
    }

    /// Initialize risk state PDA for a vault.
    pub fn initialize_risk_state(
        ctx: Context<InitializeRiskState>,
        threshold_ciphertext: Pubkey,
    ) -> Result<()> {
        instructions::initialize_risk_state(ctx, threshold_ciphertext)
    }

    /// Verify custody proof from Ika dWallet
    pub fn verify_custody_proof(
        ctx: Context<VerifyCustodyProof>,
        expected_dwallet_id: [u8; 32],
    ) -> Result<()> {
        instructions::verify_custody_proof(ctx, expected_dwallet_id)
    }

    /// Refresh an existing custody proof (proof expiry check)
    pub fn refresh_custody_proof(
        ctx: Context<VerifyCustodyProof>,
        expected_dwallet_id: [u8; 32],
    ) -> Result<()> {
        instructions::refresh_custody_proof(ctx, expected_dwallet_id)
    }

    /// Deposit collateral (gated by proof verification)
    pub fn deposit_collateral(
        ctx: Context<DepositCollateral>,
        amount: u64,
    ) -> Result<()> {
        instructions::deposit_collateral(ctx, amount)
    }

    /// Withdraw collateral
    pub fn withdraw_collateral(
        ctx: Context<DepositCollateral>,
        amount: u64,
    ) -> Result<()> {
        instructions::withdraw_collateral(ctx, amount)
    }

    /// Reject an unverified deposit (admin only)
    pub fn reject_unverified_deposit(
        ctx: Context<DepositCollateral>,
        amount: u64,
        reason: String,
    ) -> Result<()> {
        instructions::reject_unverified_deposit(ctx, amount, reason)
    }

    /// Update encrypted backing state via Encrypt
    pub fn update_backing_state(
        ctx: Context<UpdateBackingState>,
        new_backing_amount: u64,
    ) -> Result<()> {
        instructions::update_backing_state(ctx, new_backing_amount)
    }

    /// Trigger FHE risk check via Encrypt
    pub fn trigger_risk_check(
        ctx: Context<TriggerRiskCheck>,
    ) -> Result<()> {
        instructions::trigger_risk_check(ctx)
    }

    /// Freeze vault/protocol via circuit breaker
    pub fn circuit_breaker_freeze(
        ctx: Context<CircuitBreakerFreeze>,
        reason: String,
    ) -> Result<()> {
        instructions::circuit_breaker_freeze(ctx, reason)
    }

    /// Unfreeze vault (admin only)
    pub fn admin_unfreeze(
        ctx: Context<AdminUnfreeze>,
    ) -> Result<()> {
        instructions::admin_unfreeze(ctx)
    }

    /// Clear the protocol-level `frozen` flag (admin only). Lets the demo
    /// reset between full runs without redeploying.
    pub fn unfreeze_protocol_state(
        ctx: Context<UnfreezeProtocolState>,
    ) -> Result<()> {
        instructions::unfreeze_protocol_state(ctx)
    }

    /// Close a vault (only if no collateral deposited)
    pub fn close_vault(
        ctx: Context<CloseVault>,
    ) -> Result<()> {
        instructions::close_vault(ctx)
    }

    /// Approve a real Ika `MessageApproval` via CPI to the dWallet program.
    /// Requires the target dWallet's authority to be LendGuard's CPI authority
    /// PDA (`PDA([b"__ika_cpi_authority"], LENDGUARD_PROGRAM_ID)`). Off-chain,
    /// callers run DKG via Ika gRPC with `intended_chain_sender` set to that
    /// PDA, then invoke this instruction.
    pub fn approve_custody_signature(
        ctx: Context<ApproveCustodySignature>,
        message_digest: [u8; 32],
        message_metadata_digest: [u8; 32],
        user_pubkey: [u8; 32],
        signature_scheme: u16,
        message_approval_bump: u8,
    ) -> Result<()> {
        instructions::approve_custody_signature(
            ctx,
            message_digest,
            message_metadata_digest,
            user_pubkey,
            signature_scheme,
            message_approval_bump,
        )
    }

    /// Initialize the production lending pool: real LGUSD SPL mint, real
    /// pool token vault, demo price feed, and rate-model parameters.
    #[allow(clippy::too_many_arguments)]
    pub fn initialize_lending_pool(
        ctx: Context<InitializeLendingPool>,
        asset_type: u8,
        initial_liquidity: u64,
        initial_price_usd: u64,
        ltv_basis_points: u16,
        liquidation_threshold_bps: u16,
        liquidation_bonus_bps: u16,
        base_rate_bps: u16,
        rate_slope_bps: u16,
    ) -> Result<()> {
        instructions::initialize_lending_pool(
            ctx,
            asset_type,
            initial_liquidity,
            initial_price_usd,
            ltv_basis_points,
            liquidation_threshold_bps,
            liquidation_bonus_bps,
            base_rate_bps,
            rate_slope_bps,
        )
    }

    /// Update the demo price feed used by the lending protocol.
    pub fn update_admin_price(
        ctx: Context<UpdateAdminPrice>,
        new_price_usd: u64,
    ) -> Result<()> {
        instructions::update_admin_price(ctx, new_price_usd)
    }

    /// Admin-only: close a stale price feed so it can be re-initialised under a
    /// new pool layout. Refunds rent to the admin.
    pub fn close_admin_price_feed(
        ctx: Context<CloseAdminPriceFeed>,
    ) -> Result<()> {
        instructions::close_admin_price_feed(ctx)
    }

    /// Admin-only: bootstrap a fresh AdminPriceFeed for an asset_type that
    /// the initial lending_pool did not create (e.g. ETH or SOL added later).
    pub fn initialize_admin_price_feed(
        ctx: Context<InitializeAdminPriceFeed>,
        asset_type: u8,
        initial_price_usd: u64,
    ) -> Result<()> {
        instructions::initialize_admin_price_feed(ctx, asset_type, initial_price_usd)
    }

    /// Borrow LGUSD against a verified LendGuard vault. CPI transfers tokens
    /// from the pool vault to the borrower's ATA.
    pub fn borrow_against_collateral(
        ctx: Context<BorrowAgainstCollateral>,
        amount: u64,
        health_ciphertext: Pubkey,
    ) -> Result<()> {
        instructions::borrow_against_collateral(ctx, amount, health_ciphertext)
    }

    /// Repay (part of) a borrow position. CPI transfers tokens from the
    /// borrower's ATA back to the pool vault.
    pub fn repay_borrow(
        ctx: Context<RepayBorrow>,
        amount: u64,
    ) -> Result<()> {
        instructions::repay_borrow(ctx, amount)
    }

    /// Liquidate an under-collateralised borrow position. The liquidator
    /// repays the full debt principal in LGUSD and seizes the collateral
    /// + a liquidation bonus.
    pub fn liquidate_position(ctx: Context<LiquidatePosition>) -> Result<()> {
        instructions::liquidate_position(ctx)
    }

    /// Register a Bitcoin testnet collateral vault controlled by an Ika
    /// Secp256k1 dWallet. This is additive to the existing SOL/devnet vault
    /// flow; it never mutates or replaces `VaultAccount`.
    pub fn register_btc_vault(
        ctx: Context<RegisterBtcVault>,
        ika_dwallet: Pubkey,
        dwallet_pubkey: [u8; 33],
        bitcoin_address: Vec<u8>,
    ) -> Result<()> {
        instructions::register_btc_vault(ctx, ika_dwallet, dwallet_pubkey, bitcoin_address)
    }

    /// Admin keeper posts the latest tBTC balance observed on Bitcoin testnet.
    pub fn attest_btc_balance(
        ctx: Context<AttestBtcBalance>,
        satoshis: u64,
        bitcoin_block_height: u64,
        bitcoin_block_hash: [u8; 32],
    ) -> Result<()> {
        instructions::attest_btc_balance(ctx, satoshis, bitcoin_block_height, bitcoin_block_hash)
    }

    /// Verify a real Ika MessageApproval for the registered Secp256k1 dWallet.
    pub fn verify_btc_custody_proof(ctx: Context<VerifyBtcCustodyProof>) -> Result<()> {
        instructions::verify_btc_custody_proof(ctx)
    }

    /// Refresh a BTC custody proof after a new MessageApproval is signed.
    pub fn refresh_btc_custody_proof(ctx: Context<VerifyBtcCustodyProof>) -> Result<()> {
        instructions::refresh_btc_custody_proof(ctx)
    }

    /// Borrow LGUSD against a verified, freshly attested Bitcoin testnet vault.
    pub fn borrow_against_btc_collateral(
        ctx: Context<BorrowAgainstBtcCollateral>,
        amount: u64,
        health_ciphertext: Pubkey,
    ) -> Result<()> {
        instructions::borrow_against_btc_collateral(ctx, amount, health_ciphertext)
    }

    /// Repay an LGUSD borrow opened against a BTC testnet vault.
    pub fn repay_btc_borrow(ctx: Context<RepayBtcBorrow>, amount: u64) -> Result<()> {
        instructions::repay_btc_borrow(ctx, amount)
    }

    /// Liquidate an unhealthy BTC-backed position. The liquidator repays LGUSD
    /// immediately; LendGuard CPI-calls Ika to sign the Bitcoin testnet tx
    /// sighash, and the broadcaster keeper publishes the signed tx.
    pub fn liquidate_btc_position(
        ctx: Context<LiquidateBtcPosition>,
        bitcoin_sighash: [u8; 32],
        message_metadata_digest: [u8; 32],
        user_pubkey: [u8; 32],
        message_approval_bump: u8,
    ) -> Result<()> {
        instructions::liquidate_btc_position(
            ctx,
            bitcoin_sighash,
            message_metadata_digest,
            user_pubkey,
            message_approval_bump,
        )
    }

    /// Finalize a BTC liquidation after the broadcaster keeper observes the
    /// signed transaction confirmed on Bitcoin testnet.
    pub fn finalize_btc_liquidation(
        ctx: Context<FinalizeBtcLiquidation>,
        bitcoin_tx_id: [u8; 32],
        bitcoin_block_height: u64,
        confirmations: u32,
        remaining_satoshis: u64,
    ) -> Result<()> {
        instructions::finalize_btc_liquidation(
            ctx,
            bitcoin_tx_id,
            bitcoin_block_height,
            confirmations,
            remaining_satoshis,
        )
    }

    // ─── Demo-only helpers (pre-alpha) ────────────────────────────────────
    // These exist so the LendGuard demo can produce on-chain mock accounts
    // matching the byte layouts the Ika and Encrypt integrations expect,
    // without depending on the off-chain Ika / Encrypt networks. Production
    // builds remove these.

    pub fn demo_create_message_approval(
        ctx: Context<DemoCreateMessageApproval>,
        dwallet_id: [u8; 32],
        is_signed: bool,
    ) -> Result<()> {
        instructions::demo_create_message_approval(ctx, dwallet_id, is_signed)
    }

    pub fn demo_create_ciphertext(
        ctx: Context<DemoCreateCiphertext>,
        label: [u8; 8],
        value: u8,
    ) -> Result<()> {
        instructions::demo_create_ciphertext(ctx, label, value)
    }
}

// Re-export for visibility
pub use lendguard_proof_vault::*;

