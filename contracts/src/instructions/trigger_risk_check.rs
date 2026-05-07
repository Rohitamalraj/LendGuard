use anchor_lang::prelude::*;
use crate::constants::{PROTOCOL_STATE_PDA_SEED, RISK_STATE_PDA_SEED};
use crate::events::RiskCheckExecuted;
use crate::errors::LendGuardError;
use crate::integrations::read_mocked_ebool;
use crate::state::{ProtocolStateAccount, RiskStateAccount, VaultAccount};

#[derive(Accounts)]
pub struct TriggerRiskCheck<'info> {
    #[account(mut)]
    pub vault: Account<'info, VaultAccount>,

    #[account(
        mut,
        seeds = [RISK_STATE_PDA_SEED, vault.key().as_ref()],
        bump = risk_state.bump
    )]
    pub risk_state: Account<'info, RiskStateAccount>,

    #[account(
        mut,
        seeds = [PROTOCOL_STATE_PDA_SEED],
        bump = protocol_state.bump
    )]
    pub protocol_state: Account<'info, ProtocolStateAccount>,

    /// CHECK: Encrypt program (placeholder; full CPI lands in
    /// `trigger_risk_check_real`).
    pub encrypt_program: UncheckedAccount<'info>,

    /// CHECK: Real Encrypt input ciphertext (backing). Validated by pubkey
    /// match against `risk_state.backing_ciphertext`.
    pub backing_ciphertext: UncheckedAccount<'info>,

    /// CHECK: Real Encrypt input ciphertext (threshold). Validated by pubkey
    /// match against `risk_state.threshold_ciphertext`.
    pub threshold_ciphertext: UncheckedAccount<'info>,

    /// CHECK: EBool result ciphertext. In the demo path this is a LendGuard
    /// helper account whose byte[0] holds the boolean. In the real path it
    /// will be an Encrypt-owned account written by execute_graph.
    #[account(mut)]
    pub result_ciphertext: UncheckedAccount<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn trigger_risk_check(
    ctx: Context<TriggerRiskCheck>,
) -> Result<()> {
    let vault = &mut ctx.accounts.vault;
    let risk_state = &mut ctx.accounts.risk_state;
    let protocol_state = &mut ctx.accounts.protocol_state;
    require!(
        risk_state.vault_id == vault.key(),
        LendGuardError::VaultNotFound
    );
    // Pre-alpha: vault owner OR protocol admin can trigger a risk check on
    // their own vault. Production keeps this admin-only.
    require!(
        protocol_state.admin == ctx.accounts.payer.key()
            || vault.owner == ctx.accounts.payer.key(),
        LendGuardError::UnauthorizedCaller
    );

    // Verify backing and threshold ciphertexts exist
    require!(
        !ctx.accounts.backing_ciphertext.key().eq(&Pubkey::default()),
        LendGuardError::InvalidCiphertextAccount
    );
    require!(
        !ctx.accounts.threshold_ciphertext.key().eq(&Pubkey::default()),
        LendGuardError::InvalidCiphertextAccount
    );
    require!(
        risk_state.backing_ciphertext == ctx.accounts.backing_ciphertext.key(),
        LendGuardError::InvalidCiphertextAccount
    );
    require!(
        risk_state.threshold_ciphertext == ctx.accounts.threshold_ciphertext.key(),
        LendGuardError::InvalidCiphertextAccount
    );

    // TODO: CPI call to Encrypt's execute_graph with check_backing_ratio FHE function
    // The FHE function:
    // ```
    // #[encrypt_fn]
    // fn check_backing_ratio(
    //     current_backing: EUint64,
    //     total_minted: EUint64,
    //     threshold: EUint64
    // ) -> EBool {
    //     let ratio = (current_backing * 100u64) / total_minted;
    //     ratio >= threshold
    // }
    // ```
    //
    // This would involve:
    // 1. Building instruction data with graph bytes
    // 2. Assembling accounts for Encrypt CPI
    // 3. Calling into Encrypt program
    // 4. Waiting for executor to evaluate graph and commit result

    // Pre-alpha adapter path:
    // read mocked EBool from ciphertext account data.
    let is_safe = read_mocked_ebool(&ctx.accounts.result_ciphertext)?;

    let current_time = Clock::get()?.unix_timestamp;

    // If risk check failed (is_safe = false), trigger circuit breaker
    if !is_safe {
        vault.frozen = true;
        protocol_state.frozen = true;

        emit!(crate::events::CircuitBreakerFired {
            vault_id: vault.vault_id,
            reason: "Risk predicate failed".to_string(),
            timestamp: current_time,
        });
    }

    risk_state.last_check_result = is_safe;
    risk_state.last_check_timestamp = current_time;

    emit!(RiskCheckExecuted {
        vault_id: vault.vault_id,
        is_safe,
        timestamp: current_time,
    });

    Ok(())
}
