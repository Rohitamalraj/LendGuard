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

    /// The Encrypt program
    pub encrypt_program: AccountInfo<'info>,

    /// Backing ciphertext (input)
    pub backing_ciphertext: AccountInfo<'info>,

    /// Threshold ciphertext (input)
    pub threshold_ciphertext: AccountInfo<'info>,

    /// Result ciphertext (output, should be EBool)
    #[account(mut)]
    pub result_ciphertext: AccountInfo<'info>,

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
    require!(
        protocol_state.admin == ctx.accounts.payer.key(),
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
