use anchor_lang::prelude::*;
use crate::state::{VaultAccount, RiskStateAccount, ProtocolStateAccount};
use crate::events::RiskCheckExecuted;
use crate::errors::LendGuardError;

#[derive(Accounts)]
pub struct TriggerRiskCheck<'info> {
    #[account(mut)]
    pub vault: Account<'info, VaultAccount>,

    #[account(mut)]
    pub risk_state: Account<'info, RiskStateAccount>,

    #[account(mut)]
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

    // Verify backing and threshold ciphertexts exist
    require!(
        !ctx.accounts.backing_ciphertext.key().eq(&Pubkey::default()),
        LendGuardError::InvalidCiphertextAccount
    );
    require!(
        !ctx.accounts.threshold_ciphertext.key().eq(&Pubkey::default()),
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

    // For now, we simulate reading the result
    let is_safe = true; // In production, read from result_ciphertext after executor commits

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
