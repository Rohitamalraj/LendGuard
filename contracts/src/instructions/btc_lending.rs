use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use ika_dwallet_anchor::{CPI_AUTHORITY_SEED, DWalletContext};

use crate::constants::*;
use crate::errors::LendGuardError;
use crate::events::{
    BtcBorrowOpened, BtcBorrowRepaid, BtcLiquidationFinalized, BtcLiquidationInitiated,
};
use crate::instructions::lending::{accrue_interest, current_debt, to_scaled};
use crate::state::{
    AdminPriceFeed, BitcoinBalanceAttestation, BorrowPosition, BtcVaultAccount, LendingPool,
    ProtocolStateAccount,
};

#[derive(Accounts)]
pub struct BorrowAgainstBtcCollateral<'info> {
    #[account(
        mut,
        has_one = owner @ LendGuardError::UnauthorizedCaller,
    )]
    pub btc_vault: Box<Account<'info, BtcVaultAccount>>,

    #[account(
        seeds = [PROTOCOL_STATE_PDA_SEED],
        bump = protocol_state.bump
    )]
    pub protocol_state: Box<Account<'info, ProtocolStateAccount>>,

    #[account(
        mut,
        seeds = [LENDING_POOL_PDA_SEED, lending_pool.borrow_asset_mint.as_ref()],
        bump = lending_pool.bump
    )]
    pub lending_pool: Box<Account<'info, LendingPool>>,

    #[account(
        seeds = [ADMIN_PRICE_FEED_PDA_SEED, &[ASSET_BTC]],
        bump = price_feed.bump
    )]
    pub price_feed: Box<Account<'info, AdminPriceFeed>>,

    #[account(
        seeds = [BTC_ATTESTATION_PDA_SEED, btc_vault.key().as_ref()],
        bump = btc_attestation.bump,
        constraint = btc_attestation.btc_vault == btc_vault.key()
            @ LendGuardError::BitcoinAttestationMismatch,
    )]
    pub btc_attestation: Box<Account<'info, BitcoinBalanceAttestation>>,

    #[account(
        init,
        payer = owner,
        space = BorrowPosition::LEN,
        seeds = [BTC_BORROW_POSITION_PDA_SEED, btc_vault.key().as_ref()],
        bump
    )]
    pub borrow_position: Box<Account<'info, BorrowPosition>>,

    #[account(
        mut,
        address = lending_pool.pool_token_vault @ LendGuardError::PoolTokenVaultMismatch,
    )]
    pub pool_token_vault: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        constraint = borrower_token_account.mint == lending_pool.borrow_asset_mint
            @ LendGuardError::BorrowAssetMintMismatch,
        constraint = borrower_token_account.owner == owner.key()
            @ LendGuardError::TokenAccountOwnerMismatch,
    )]
    pub borrower_token_account: Box<Account<'info, TokenAccount>>,

    #[account(mut)]
    pub owner: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn borrow_against_btc_collateral(
    ctx: Context<BorrowAgainstBtcCollateral>,
    amount: u64,
    health_ciphertext: Pubkey,
) -> Result<()> {
    require!(amount > 0, LendGuardError::InvalidBorrowAmount);

    let now = Clock::get()?.unix_timestamp;
    let protocol = &ctx.accounts.protocol_state;
    let btc_vault = &ctx.accounts.btc_vault;
    let price_feed = &ctx.accounts.price_feed;
    let attestation = &ctx.accounts.btc_attestation;

    require!(!protocol.frozen, LendGuardError::ProtocolFrozen);
    require!(!btc_vault.frozen, LendGuardError::BtcVaultFrozen);
    require!(
        btc_vault.liquidation_initiated_at == 0,
        LendGuardError::BtcLiquidationAlreadyInitiated
    );
    require!(
        btc_vault.proof_status == PROOF_STATUS_VERIFIED,
        LendGuardError::BtcVaultNotVerified
    );
    require!(attestation.satoshis > 0, LendGuardError::InsufficientBtcCollateral);
    require!(
        now.checked_sub(btc_vault.proof_timestamp)
            .ok_or(LendGuardError::InvalidTimestamp)?
            <= PROOF_EXPIRY_SECONDS,
        LendGuardError::ProofExpired
    );
    require!(
        now.checked_sub(attestation.attested_at_unix)
            .ok_or(LendGuardError::InvalidTimestamp)?
            <= BTC_ATTESTATION_MAX_AGE_SECONDS,
        LendGuardError::BitcoinAttestationStale
    );
    require!(
        now.checked_sub(price_feed.updated_at)
            .ok_or(LendGuardError::InvalidTimestamp)?
            <= PRICE_STALENESS_SECONDS,
        LendGuardError::PriceFeedStale
    );

    let max_borrow = calculate_max_btc_borrow(
        attestation.satoshis,
        price_feed.price_usd,
        ctx.accounts.lending_pool.ltv_basis_points,
    )?;
    require!(amount <= max_borrow, LendGuardError::BorrowExceedsCollateralLtv);

    let now_slot = Clock::get()?.slot;
    let pool_pubkey = ctx.accounts.lending_pool.key();
    {
        let pool = &mut ctx.accounts.lending_pool;
        accrue_interest(pool, pool_pubkey, now_slot, now)?;
    }

    let current_total_debt = current_debt(
        ctx.accounts.lending_pool.total_borrowed,
        ctx.accounts.lending_pool.borrow_index,
    )?;
    let available = ctx
        .accounts
        .lending_pool
        .total_liquidity
        .checked_sub(current_total_debt)
        .ok_or(LendGuardError::ArithmeticOverflow)?;
    require!(amount <= available, LendGuardError::InsufficientPoolLiquidity);

    let borrow_index = ctx.accounts.lending_pool.borrow_index;
    let scaled = to_scaled(amount, borrow_index)?;
    {
        let pool = &mut ctx.accounts.lending_pool;
        pool.total_borrowed = pool
            .total_borrowed
            .checked_add(scaled)
            .ok_or(LendGuardError::ArithmeticOverflow)?;
    }

    let pool_bump = ctx.accounts.lending_pool.bump;
    let mint_key = ctx.accounts.lending_pool.borrow_asset_mint;
    let signer_seeds: &[&[&[u8]]] = &[&[
        LENDING_POOL_PDA_SEED,
        mint_key.as_ref(),
        &[pool_bump],
    ]];
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.key(),
        Transfer {
            from: ctx.accounts.pool_token_vault.to_account_info(),
            to: ctx.accounts.borrower_token_account.to_account_info(),
            authority: ctx.accounts.lending_pool.to_account_info(),
        },
        signer_seeds,
    );
    token::transfer(cpi_ctx, amount)?;

    let position = &mut ctx.accounts.borrow_position;
    position.vault = btc_vault.key();
    position.owner = ctx.accounts.owner.key();
    position.borrow_asset = mint_key;
    position.principal = scaled;
    position.borrowed_at = now;
    position.last_updated_at = now;
    position.borrow_index_snapshot = borrow_index;
    position.health_ciphertext = health_ciphertext;
    position.bump = ctx.bumps.borrow_position;

    emit!(BtcBorrowOpened {
        vault_id: btc_vault.vault_id,
        position: position.key(),
        owner: ctx.accounts.owner.key(),
        amount,
        principal: scaled,
        collateral_satoshis: attestation.satoshis,
        timestamp: now,
    });

    Ok(())
}

#[derive(Accounts)]
pub struct RepayBtcBorrow<'info> {
    #[account(
        has_one = owner @ LendGuardError::UnauthorizedCaller,
    )]
    pub btc_vault: Box<Account<'info, BtcVaultAccount>>,

    #[account(
        mut,
        seeds = [LENDING_POOL_PDA_SEED, lending_pool.borrow_asset_mint.as_ref()],
        bump = lending_pool.bump
    )]
    pub lending_pool: Box<Account<'info, LendingPool>>,

    #[account(
        mut,
        seeds = [BTC_BORROW_POSITION_PDA_SEED, btc_vault.key().as_ref()],
        bump = borrow_position.bump,
        has_one = owner @ LendGuardError::UnauthorizedCaller,
    )]
    pub borrow_position: Box<Account<'info, BorrowPosition>>,

    #[account(
        mut,
        address = lending_pool.pool_token_vault @ LendGuardError::PoolTokenVaultMismatch,
    )]
    pub pool_token_vault: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        constraint = borrower_token_account.mint == lending_pool.borrow_asset_mint
            @ LendGuardError::BorrowAssetMintMismatch,
        constraint = borrower_token_account.owner == owner.key()
            @ LendGuardError::TokenAccountOwnerMismatch,
    )]
    pub borrower_token_account: Box<Account<'info, TokenAccount>>,

    #[account(mut)]
    pub owner: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

pub fn repay_btc_borrow(ctx: Context<RepayBtcBorrow>, amount: u64) -> Result<()> {
    require!(amount > 0, LendGuardError::InvalidRepayAmount);

    let now = Clock::get()?.unix_timestamp;
    let now_slot = Clock::get()?.slot;
    let pool_pubkey = ctx.accounts.lending_pool.key();
    {
        let pool = &mut ctx.accounts.lending_pool;
        accrue_interest(pool, pool_pubkey, now_slot, now)?;
    }

    let borrow_index = ctx.accounts.lending_pool.borrow_index;
    let outstanding_raw = current_debt(ctx.accounts.borrow_position.principal, borrow_index)?;
    require!(outstanding_raw > 0, LendGuardError::NoOutstandingDebt);

    let is_repay_all = amount == u64::MAX;
    let actual_amount = if is_repay_all {
        ctx.accounts
            .borrower_token_account
            .amount
            .min(outstanding_raw)
    } else {
        amount.min(outstanding_raw)
    };
    require!(actual_amount > 0, LendGuardError::InvalidRepayAmount);

    let scaled_repay = if is_repay_all || actual_amount == outstanding_raw {
        ctx.accounts.borrow_position.principal
    } else {
        to_scaled(actual_amount, borrow_index)?.min(ctx.accounts.borrow_position.principal)
    };

    let cpi_ctx = CpiContext::new(
        ctx.accounts.token_program.key(),
        Transfer {
            from: ctx.accounts.borrower_token_account.to_account_info(),
            to: ctx.accounts.pool_token_vault.to_account_info(),
            authority: ctx.accounts.owner.to_account_info(),
        },
    );
    token::transfer(cpi_ctx, actual_amount)?;

    let remaining_principal = {
        let position = &mut ctx.accounts.borrow_position;
        position.principal = position
            .principal
            .checked_sub(scaled_repay)
            .ok_or(LendGuardError::ArithmeticOverflow)?;
        position.last_updated_at = now;
        position.borrow_index_snapshot = borrow_index;
        position.principal
    };

    {
        let pool = &mut ctx.accounts.lending_pool;
        pool.total_borrowed = pool
            .total_borrowed
            .checked_sub(scaled_repay)
            .ok_or(LendGuardError::ArithmeticOverflow)?;
    }

    emit!(BtcBorrowRepaid {
        vault_id: ctx.accounts.btc_vault.vault_id,
        position: ctx.accounts.borrow_position.key(),
        owner: ctx.accounts.owner.key(),
        amount: actual_amount,
        remaining_principal,
        timestamp: now,
    });

    if remaining_principal == 0 {
        ctx.accounts
            .borrow_position
            .close(ctx.accounts.owner.to_account_info())?;
    }

    Ok(())
}

#[derive(Accounts)]
pub struct LiquidateBtcPosition<'info> {
    #[account(mut)]
    pub btc_vault: Box<Account<'info, BtcVaultAccount>>,

    #[account(
        seeds = [PROTOCOL_STATE_PDA_SEED],
        bump = protocol_state.bump
    )]
    pub protocol_state: Box<Account<'info, ProtocolStateAccount>>,

    #[account(
        mut,
        seeds = [LENDING_POOL_PDA_SEED, lending_pool.borrow_asset_mint.as_ref()],
        bump = lending_pool.bump
    )]
    pub lending_pool: Box<Account<'info, LendingPool>>,

    #[account(
        seeds = [ADMIN_PRICE_FEED_PDA_SEED, &[ASSET_BTC]],
        bump = price_feed.bump
    )]
    pub price_feed: Box<Account<'info, AdminPriceFeed>>,

    #[account(
        seeds = [BTC_ATTESTATION_PDA_SEED, btc_vault.key().as_ref()],
        bump = btc_attestation.bump,
    )]
    pub btc_attestation: Box<Account<'info, BitcoinBalanceAttestation>>,

    #[account(
        mut,
        seeds = [BTC_BORROW_POSITION_PDA_SEED, btc_vault.key().as_ref()],
        bump = borrow_position.bump,
    )]
    pub borrow_position: Box<Account<'info, BorrowPosition>>,

    #[account(
        mut,
        address = lending_pool.pool_token_vault @ LendGuardError::PoolTokenVaultMismatch,
    )]
    pub pool_token_vault: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        constraint = liquidator_token_account.mint == lending_pool.borrow_asset_mint
            @ LendGuardError::BorrowAssetMintMismatch,
        constraint = liquidator_token_account.owner == liquidator.key()
            @ LendGuardError::TokenAccountOwnerMismatch,
    )]
    pub liquidator_token_account: Box<Account<'info, TokenAccount>>,

    /// CHECK: This LendGuard program — must be executable for Ika CPI.
    #[account(executable, address = crate::ID)]
    pub caller_program: UncheckedAccount<'info>,

    /// CHECK: LendGuard's Ika CPI authority PDA.
    #[account(seeds = [CPI_AUTHORITY_SEED], bump)]
    pub cpi_authority: UncheckedAccount<'info>,

    /// CHECK: Ika dWallet program account.
    #[account(executable)]
    pub dwallet_program: UncheckedAccount<'info>,

    /// CHECK: Ika coordinator PDA.
    pub coordinator: UncheckedAccount<'info>,

    /// CHECK: Ika DWallet account; key must match the registered BTC vault.
    #[account(address = btc_vault.ika_dwallet @ LendGuardError::DWalletMismatch)]
    pub dwallet: UncheckedAccount<'info>,

    /// CHECK: Ika MessageApproval PDA created by the CPI.
    #[account(mut)]
    pub message_approval: UncheckedAccount<'info>,

    #[account(mut)]
    pub liquidator: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn liquidate_btc_position(
    ctx: Context<LiquidateBtcPosition>,
    bitcoin_sighash: [u8; 32],
    message_metadata_digest: [u8; 32],
    user_pubkey: [u8; 32],
    message_approval_bump: u8,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let now_slot = Clock::get()?.slot;
    {
        let pool_pubkey = ctx.accounts.lending_pool.key();
        let pool = &mut ctx.accounts.lending_pool;
        accrue_interest(pool, pool_pubkey, now_slot, now)?;
    }

    let protocol = &ctx.accounts.protocol_state;
    let position = &ctx.accounts.borrow_position;
    let price_feed = &ctx.accounts.price_feed;
    let pool = &ctx.accounts.lending_pool;
    let attestation = &ctx.accounts.btc_attestation;
    let btc_vault = &ctx.accounts.btc_vault;

    require!(!protocol.frozen, LendGuardError::ProtocolFrozen);
    require!(position.principal > 0, LendGuardError::NoOutstandingDebt);
    require!(
        position.owner != ctx.accounts.liquidator.key(),
        LendGuardError::SelfLiquidation
    );
    require!(
        btc_vault.liquidation_initiated_at == 0,
        LendGuardError::BtcLiquidationAlreadyInitiated
    );
    require!(
        now.checked_sub(attestation.attested_at_unix)
            .ok_or(LendGuardError::InvalidTimestamp)?
            <= BTC_ATTESTATION_MAX_AGE_SECONDS,
        LendGuardError::BitcoinAttestationStale
    );
    require!(
        now.checked_sub(price_feed.updated_at)
            .ok_or(LendGuardError::InvalidTimestamp)?
            <= PRICE_STALENESS_SECONDS,
        LendGuardError::PriceFeedStale
    );

    let outstanding_raw = current_debt(position.principal, pool.borrow_index)?;
    require!(
        is_btc_liquidatable(
            attestation.satoshis,
            price_feed.price_usd,
            outstanding_raw,
            pool.liquidation_threshold_bps,
        )?,
        LendGuardError::PositionHealthy
    );

    let repaid_amount = outstanding_raw;
    let scaled_to_close = position.principal;

    let cpi_ctx = CpiContext::new(
        ctx.accounts.token_program.key(),
        Transfer {
            from: ctx.accounts.liquidator_token_account.to_account_info(),
            to: ctx.accounts.pool_token_vault.to_account_info(),
            authority: ctx.accounts.liquidator.to_account_info(),
        },
    );
    token::transfer(cpi_ctx, repaid_amount)?;

    let seized_satoshis = debt_to_satoshis_with_bonus(
        repaid_amount,
        price_feed.price_usd,
        pool.liquidation_bonus_bps,
    )?
    .min(attestation.satoshis);

    let dwallet_ctx = DWalletContext {
        dwallet_program: ctx.accounts.dwallet_program.to_account_info(),
        cpi_authority: ctx.accounts.cpi_authority.to_account_info(),
        caller_program: ctx.accounts.caller_program.to_account_info(),
        cpi_authority_bump: ctx.bumps.cpi_authority,
    };
    dwallet_ctx.approve_message(
        &ctx.accounts.coordinator.to_account_info(),
        &ctx.accounts.message_approval.to_account_info(),
        &ctx.accounts.dwallet.to_account_info(),
        &ctx.accounts.liquidator.to_account_info(),
        &ctx.accounts.system_program.to_account_info(),
        bitcoin_sighash,
        message_metadata_digest,
        user_pubkey,
        IKA_SIGNATURE_SCHEME_SECP256K1,
        message_approval_bump,
    )?;

    {
        let pool = &mut ctx.accounts.lending_pool;
        pool.total_borrowed = pool
            .total_borrowed
            .checked_sub(scaled_to_close)
            .ok_or(LendGuardError::ArithmeticOverflow)?;
    }
    ctx.accounts.borrow_position.principal = 0;
    ctx.accounts.borrow_position.last_updated_at = now;
    ctx.accounts.borrow_position.borrow_index_snapshot = ctx.accounts.lending_pool.borrow_index;

    let btc_vault = &mut ctx.accounts.btc_vault;
    btc_vault.frozen = true;
    btc_vault.liquidation_initiated_at = now;
    btc_vault.liquidation_sighash = bitcoin_sighash;

    emit!(BtcLiquidationInitiated {
        vault_id: btc_vault.vault_id,
        position: ctx.accounts.borrow_position.key(),
        borrower: ctx.accounts.borrow_position.owner,
        liquidator: ctx.accounts.liquidator.key(),
        repaid_amount,
        seized_satoshis,
        bitcoin_sighash,
        message_approval: ctx.accounts.message_approval.key(),
        timestamp: now,
    });

    Ok(())
}

#[derive(Accounts)]
pub struct FinalizeBtcLiquidation<'info> {
    #[account(mut)]
    pub btc_vault: Box<Account<'info, BtcVaultAccount>>,

    #[account(
        mut,
        seeds = [BTC_ATTESTATION_PDA_SEED, btc_vault.key().as_ref()],
        bump = btc_attestation.bump,
    )]
    pub btc_attestation: Box<Account<'info, BitcoinBalanceAttestation>>,

    #[account(
        mut,
        close = keeper,
        seeds = [BTC_BORROW_POSITION_PDA_SEED, btc_vault.key().as_ref()],
        bump = borrow_position.bump,
    )]
    pub borrow_position: Box<Account<'info, BorrowPosition>>,

    #[account(
        seeds = [PROTOCOL_STATE_PDA_SEED],
        bump = protocol_state.bump
    )]
    pub protocol_state: Box<Account<'info, ProtocolStateAccount>>,

    #[account(mut)]
    pub keeper: Signer<'info>,
}

pub fn finalize_btc_liquidation(
    ctx: Context<FinalizeBtcLiquidation>,
    bitcoin_tx_id: [u8; 32],
    bitcoin_block_height: u64,
    confirmations: u32,
    remaining_satoshis: u64,
) -> Result<()> {
    require!(
        ctx.accounts.keeper.key() == ctx.accounts.protocol_state.admin,
        LendGuardError::KeeperNotAuthorised
    );
    require!(
        ctx.accounts.btc_vault.liquidation_initiated_at > 0,
        LendGuardError::BtcLiquidationNotInitiated
    );
    require!(
        confirmations >= BTC_LIQUIDATION_MIN_CONFIRMATIONS,
        LendGuardError::BitcoinConfirmationsInsufficient
    );
    require!(
        ctx.accounts.borrow_position.principal == 0,
        LendGuardError::OutstandingDebt
    );

    let now = Clock::get()?.unix_timestamp;
    let slot = Clock::get()?.slot;
    let btc_vault = &mut ctx.accounts.btc_vault;
    btc_vault.deposited_satoshis = remaining_satoshis;
    btc_vault.last_attestation_slot = slot;
    btc_vault.proof_status = PROOF_STATUS_PENDING;
    btc_vault.proof_timestamp = 0;
    btc_vault.frozen = false;
    btc_vault.liquidation_initiated_at = 0;
    btc_vault.liquidation_sighash = [0u8; 32];

    let attestation = &mut ctx.accounts.btc_attestation;
    attestation.satoshis = remaining_satoshis;
    attestation.bitcoin_block_height = bitcoin_block_height;
    attestation.attested_at_slot = slot;
    attestation.attested_at_unix = now;
    attestation.keeper = ctx.accounts.keeper.key();

    emit!(BtcLiquidationFinalized {
        vault_id: btc_vault.vault_id,
        position: ctx.accounts.borrow_position.key(),
        bitcoin_tx_id,
        bitcoin_block_height,
        timestamp: now,
    });

    Ok(())
}

fn calculate_max_btc_borrow(
    satoshis: u64,
    price_usd: u64,
    ltv_basis_points: u16,
) -> Result<u64> {
    let collateral_value_usd_8 = (satoshis as u128)
        .checked_mul(price_usd as u128)
        .ok_or(LendGuardError::ArithmeticOverflow)?
        .checked_div(SATOSHIS_PER_BTC as u128)
        .ok_or(LendGuardError::ArithmeticOverflow)?;

    let max_borrow_usd_8 = collateral_value_usd_8
        .checked_mul(ltv_basis_points as u128)
        .ok_or(LendGuardError::ArithmeticOverflow)?
        .checked_div(BASIS_POINTS_DENOMINATOR as u128)
        .ok_or(LendGuardError::ArithmeticOverflow)?;

    let max_borrow_units = max_borrow_usd_8
        .checked_mul(BORROW_ASSET_DECIMALS as u128)
        .ok_or(LendGuardError::ArithmeticOverflow)?
        .checked_div(PRICE_DECIMALS as u128)
        .ok_or(LendGuardError::ArithmeticOverflow)?;

    u64::try_from(max_borrow_units).map_err(|_| LendGuardError::ArithmeticOverflow.into())
}

fn is_btc_liquidatable(
    satoshis: u64,
    price_usd: u64,
    debt: u64,
    liquidation_threshold_bps: u16,
) -> Result<bool> {
    let collateral_value_borrow_units = (satoshis as u128)
        .checked_mul(price_usd as u128)
        .ok_or(LendGuardError::ArithmeticOverflow)?
        .checked_div(SATOSHIS_PER_BTC as u128)
        .ok_or(LendGuardError::ArithmeticOverflow)?
        .checked_mul(BORROW_ASSET_DECIMALS as u128)
        .ok_or(LendGuardError::ArithmeticOverflow)?
        .checked_div(PRICE_DECIMALS as u128)
        .ok_or(LendGuardError::ArithmeticOverflow)?;

    let liquidation_value = collateral_value_borrow_units
        .checked_mul(liquidation_threshold_bps as u128)
        .ok_or(LendGuardError::ArithmeticOverflow)?
        .checked_div(BASIS_POINTS_DENOMINATOR as u128)
        .ok_or(LendGuardError::ArithmeticOverflow)?;

    Ok((debt as u128) > liquidation_value)
}

fn debt_to_satoshis_with_bonus(
    debt: u64,
    price_usd: u64,
    liquidation_bonus_bps: u16,
) -> Result<u64> {
    let satoshis = (debt as u128)
        .checked_mul(PRICE_DECIMALS as u128)
        .ok_or(LendGuardError::ArithmeticOverflow)?
        .checked_mul(SATOSHIS_PER_BTC as u128)
        .ok_or(LendGuardError::ArithmeticOverflow)?
        .checked_div(BORROW_ASSET_DECIMALS as u128)
        .ok_or(LendGuardError::ArithmeticOverflow)?
        .checked_div(price_usd as u128)
        .ok_or(LendGuardError::ArithmeticOverflow)?;

    let with_bonus = satoshis
        .checked_mul(
            (BASIS_POINTS_DENOMINATOR as u128)
                .checked_add(liquidation_bonus_bps as u128)
                .ok_or(LendGuardError::ArithmeticOverflow)?,
        )
        .ok_or(LendGuardError::ArithmeticOverflow)?
        .checked_div(BASIS_POINTS_DENOMINATOR as u128)
        .ok_or(LendGuardError::ArithmeticOverflow)?;

    u64::try_from(with_bonus).map_err(|_| LendGuardError::ArithmeticOverflow.into())
}
