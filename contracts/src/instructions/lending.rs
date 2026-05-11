use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

use crate::constants::*;
use crate::errors::LendGuardError;
use crate::events::{
    AdminPriceUpdated, BorrowOpened, BorrowRepaid, InterestAccrued, LendingPoolInitialized,
    PositionLiquidated,
};
use crate::state::{
    AdminPriceFeed, BorrowPosition, LendingPool, ProtocolStateAccount, VaultAccount,
};

/// Approximate Solana mainnet slots per year: 400ms/slot * 365.25 days.
const SLOTS_PER_YEAR: u128 = 78_840_000;

// ─── initialize_lending_pool ─────────────────────────────────────────────────

#[derive(Accounts)]
#[instruction(asset_type: u8)]
pub struct InitializeLendingPool<'info> {
    #[account(
        init,
        payer = admin,
        space = LendingPool::LEN,
        seeds = [LENDING_POOL_PDA_SEED, borrow_asset_mint.key().as_ref()],
        bump
    )]
    pub lending_pool: Box<Account<'info, LendingPool>>,

    #[account(
        init,
        payer = admin,
        space = AdminPriceFeed::LEN,
        seeds = [ADMIN_PRICE_FEED_PDA_SEED, &[asset_type]],
        bump
    )]
    pub price_feed: Box<Account<'info, AdminPriceFeed>>,

    /// LGUSD-style SPL mint that this pool uses as the borrow asset. The mint
    /// authority MUST already be the lending_pool PDA — bootstrap script does
    /// this off-chain via a one-time `setAuthority` call.
    pub borrow_asset_mint: Box<Account<'info, Mint>>,

    /// Pool token vault — must be a token account whose mint matches
    /// `borrow_asset_mint` and whose owner is the lending_pool PDA.
    #[account(
        mut,
        constraint = pool_token_vault.mint == borrow_asset_mint.key()
            @ LendGuardError::BorrowAssetMintMismatch,
        constraint = pool_token_vault.owner == lending_pool.key()
            @ LendGuardError::TokenAccountOwnerMismatch,
    )]
    pub pool_token_vault: Box<Account<'info, TokenAccount>>,

    #[account(mut)]
    pub admin: Signer<'info>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

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
    require!(initial_liquidity > 0, LendGuardError::InvalidLendingPoolParameter);
    require!(initial_price_usd > 0, LendGuardError::InvalidLendingPoolParameter);
    validate_asset_type(asset_type)?;
    validate_bps(ltv_basis_points, liquidation_threshold_bps, liquidation_bonus_bps)?;

    let mint = &ctx.accounts.borrow_asset_mint;
    let pool_vault = &ctx.accounts.pool_token_vault;

    require!(
        pool_vault.amount >= initial_liquidity,
        LendGuardError::InsufficientPoolLiquidity
    );

    let pool = &mut ctx.accounts.lending_pool;
    pool.borrow_asset = mint.key();
    pool.borrow_asset_mint = mint.key();
    pool.pool_token_vault = pool_vault.key();
    pool.total_liquidity = initial_liquidity;
    pool.total_borrowed = 0;
    pool.admin = ctx.accounts.admin.key();
    pool.ltv_basis_points = ltv_basis_points;
    pool.liquidation_threshold_bps = liquidation_threshold_bps;
    pool.liquidation_bonus_bps = liquidation_bonus_bps;
    pool.mint_decimals = mint.decimals;
    pool.borrow_index = LendingPool::RAY;
    pool.last_update_slot = Clock::get()?.slot;
    pool.base_rate_bps = base_rate_bps;
    pool.rate_slope_bps = rate_slope_bps;
    pool.bump = ctx.bumps.lending_pool;

    let now = Clock::get()?.unix_timestamp;
    let price = &mut ctx.accounts.price_feed;
    price.asset_type = asset_type;
    price.price_usd = initial_price_usd;
    price.updated_at = now;
    price.admin = ctx.accounts.admin.key();
    price.bump = ctx.bumps.price_feed;

    emit!(LendingPoolInitialized {
        pool: pool.key(),
        borrow_asset: pool.borrow_asset,
        initial_liquidity,
        ltv_basis_points,
        liquidation_threshold_bps,
        liquidation_bonus_bps,
        timestamp: now,
    });

    emit!(AdminPriceUpdated {
        asset_type,
        price_usd: initial_price_usd,
        timestamp: now,
    });

    Ok(())
}

// ─── initialize_admin_price_feed (admin only, multi-asset bootstrap) ─────────
//
// Creates an `AdminPriceFeed` PDA for an asset_type that does not yet have
// one. Used to bootstrap ETH and SOL price feeds in addition to the BTC feed
// the lending pool created at init time. Only the protocol admin (== the
// LendingPool admin) can call this.

#[derive(Accounts)]
#[instruction(asset_type: u8)]
pub struct InitializeAdminPriceFeed<'info> {
    #[account(
        init,
        payer = admin,
        space = AdminPriceFeed::LEN,
        seeds = [ADMIN_PRICE_FEED_PDA_SEED, &[asset_type]],
        bump
    )]
    pub price_feed: Account<'info, AdminPriceFeed>,

    #[account(mut)]
    pub admin: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn initialize_admin_price_feed(
    ctx: Context<InitializeAdminPriceFeed>,
    asset_type: u8,
    initial_price_usd: u64,
) -> Result<()> {
    require!(initial_price_usd > 0, LendGuardError::InvalidLendingPoolParameter);
    validate_asset_type(asset_type)?;

    let now = Clock::get()?.unix_timestamp;
    let feed = &mut ctx.accounts.price_feed;
    feed.asset_type = asset_type;
    feed.price_usd = initial_price_usd;
    feed.updated_at = now;
    feed.admin = ctx.accounts.admin.key();
    feed.bump = ctx.bumps.price_feed;

    emit!(AdminPriceUpdated {
        asset_type,
        price_usd: initial_price_usd,
        timestamp: now,
    });
    Ok(())
}

// ─── close_admin_price_feed (admin only, demo migration) ─────────────────────
//
// Lets the admin retire a stale `AdminPriceFeed` PDA so a new lending pool
// version can re-initialise it with a different layout. Only the original
// admin can call this.

#[derive(Accounts)]
pub struct CloseAdminPriceFeed<'info> {
    #[account(
        mut,
        close = admin,
        seeds = [ADMIN_PRICE_FEED_PDA_SEED, &[price_feed.asset_type]],
        bump = price_feed.bump,
        has_one = admin @ LendGuardError::UnauthorizedCaller
    )]
    pub price_feed: Account<'info, AdminPriceFeed>,

    #[account(mut)]
    pub admin: Signer<'info>,
}

pub fn close_admin_price_feed(_ctx: Context<CloseAdminPriceFeed>) -> Result<()> {
    Ok(())
}

// ─── update_admin_price ──────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct UpdateAdminPrice<'info> {
    #[account(
        mut,
        seeds = [ADMIN_PRICE_FEED_PDA_SEED, &[price_feed.asset_type]],
        bump = price_feed.bump,
        has_one = admin @ LendGuardError::UnauthorizedCaller
    )]
    pub price_feed: Account<'info, AdminPriceFeed>,

    pub admin: Signer<'info>,
}

pub fn update_admin_price(ctx: Context<UpdateAdminPrice>, new_price_usd: u64) -> Result<()> {
    require!(new_price_usd > 0, LendGuardError::InvalidLendingPoolParameter);

    let now = Clock::get()?.unix_timestamp;
    let price_feed = &mut ctx.accounts.price_feed;
    price_feed.price_usd = new_price_usd;
    price_feed.updated_at = now;

    emit!(AdminPriceUpdated {
        asset_type: price_feed.asset_type,
        price_usd: new_price_usd,
        timestamp: now,
    });

    Ok(())
}

// ─── borrow_against_collateral ──────────────────────────────────────────────

#[derive(Accounts)]
pub struct BorrowAgainstCollateral<'info> {
    #[account(
        mut,
        has_one = owner @ LendGuardError::UnauthorizedCaller
    )]
    pub vault: Box<Account<'info, VaultAccount>>,

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
        seeds = [ADMIN_PRICE_FEED_PDA_SEED, &[vault.asset_type]],
        bump = price_feed.bump
    )]
    pub price_feed: Box<Account<'info, AdminPriceFeed>>,

    #[account(
        init,
        payer = owner,
        space = BorrowPosition::LEN,
        seeds = [BORROW_POSITION_PDA_SEED, vault.key().as_ref()],
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

pub fn borrow_against_collateral(
    ctx: Context<BorrowAgainstCollateral>,
    amount: u64,
    health_ciphertext: Pubkey,
) -> Result<()> {
    require!(amount > 0, LendGuardError::InvalidBorrowAmount);

    let vault = &ctx.accounts.vault;
    let protocol = &ctx.accounts.protocol_state;
    let price_feed = &ctx.accounts.price_feed;

    require!(!protocol.frozen, LendGuardError::ProtocolFrozen);
    require!(!vault.frozen, LendGuardError::VaultFrozen);
    require!(
        vault.proof_status == PROOF_STATUS_VERIFIED,
        LendGuardError::VaultNotVerified
    );
    require!(vault.deposited_amount > 0, LendGuardError::InsufficientCollateral);

    let now = Clock::get()?.unix_timestamp;
    require!(
        now.checked_sub(vault.proof_timestamp)
            .ok_or(LendGuardError::InvalidTimestamp)?
            <= PROOF_EXPIRY_SECONDS,
        LendGuardError::ProofExpired
    );
    require!(
        now.checked_sub(price_feed.updated_at)
            .ok_or(LendGuardError::InvalidTimestamp)?
            <= PRICE_STALENESS_SECONDS,
        LendGuardError::PriceFeedStale
    );

    let max_borrow = calculate_max_borrow(
        vault.deposited_amount,
        price_feed.price_usd,
        ctx.accounts.lending_pool.ltv_basis_points,
    )?;
    require!(amount <= max_borrow, LendGuardError::BorrowExceedsCollateralLtv);

    let now_slot = Clock::get()?.slot;
    let pool_pubkey = ctx.accounts.lending_pool.key();
    let pool = &mut ctx.accounts.lending_pool;
    accrue_interest(pool, pool_pubkey, now_slot, now)?;

    // Available liquidity is computed in RAW units (vs. the scaled total_borrowed),
    // so convert total_borrowed back to raw for the headroom check.
    let current_total_debt = current_debt(pool.total_borrowed, pool.borrow_index)?;
    let available = pool
        .total_liquidity
        .checked_sub(current_total_debt)
        .ok_or(LendGuardError::ArithmeticOverflow)?;
    require!(amount <= available, LendGuardError::InsufficientPoolLiquidity);

    let scaled = to_scaled(amount, pool.borrow_index)?;
    pool.total_borrowed = pool
        .total_borrowed
        .checked_add(scaled)
        .ok_or(LendGuardError::ArithmeticOverflow)?;

    let pool_key = pool.key();
    let pool_bump = pool.bump;
    let mint_key = pool.borrow_asset_mint;
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

    let borrow_index = ctx.accounts.lending_pool.borrow_index;

    let position = &mut ctx.accounts.borrow_position;
    position.vault = vault.key();
    position.owner = ctx.accounts.owner.key();
    position.borrow_asset = mint_key;
    // principal is stored in SCALED units — see helpers above.
    position.principal = scaled;
    position.borrowed_at = now;
    position.last_updated_at = now;
    position.borrow_index_snapshot = borrow_index;
    position.health_ciphertext = health_ciphertext;
    position.bump = ctx.bumps.borrow_position;

    emit!(BorrowOpened {
        vault_id: vault.vault_id,
        position: position.key(),
        owner: ctx.accounts.owner.key(),
        amount,
        principal: position.principal,
        timestamp: now,
    });

    msg!(
        "borrow: pool={} amount={} scaled_principal={} new_total_scaled={}",
        pool_key,
        amount,
        scaled,
        ctx.accounts.lending_pool.total_borrowed
    );

    Ok(())
}

// ─── repay_borrow ────────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct RepayBorrow<'info> {
    #[account(
        has_one = owner @ LendGuardError::UnauthorizedCaller
    )]
    pub vault: Box<Account<'info, VaultAccount>>,

    #[account(
        mut,
        seeds = [LENDING_POOL_PDA_SEED, lending_pool.borrow_asset_mint.as_ref()],
        bump = lending_pool.bump
    )]
    pub lending_pool: Box<Account<'info, LendingPool>>,

    #[account(
        mut,
        seeds = [BORROW_POSITION_PDA_SEED, vault.key().as_ref()],
        bump = borrow_position.bump,
        has_one = vault @ LendGuardError::UnauthorizedCaller,
        has_one = owner @ LendGuardError::UnauthorizedCaller
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

pub fn repay_borrow(ctx: Context<RepayBorrow>, amount: u64) -> Result<()> {
    require!(amount > 0, LendGuardError::InvalidRepayAmount);

    let now = Clock::get()?.unix_timestamp;
    let now_slot = Clock::get()?.slot;
    let pool_pubkey = ctx.accounts.lending_pool.key();

    // Accrue interest up to the current slot. Scoped so the &mut pool borrow
    // is released before we touch other ctx.accounts fields.
    {
        let pool = &mut ctx.accounts.lending_pool;
        accrue_interest(pool, pool_pubkey, now_slot, now)?;
    }

    let borrow_index = ctx.accounts.lending_pool.borrow_index;
    let outstanding_raw =
        current_debt(ctx.accounts.borrow_position.principal, borrow_index)?;
    require!(outstanding_raw > 0, LendGuardError::NoOutstandingDebt);

    // Silent cap: a caller may pass `u64::MAX` (or any value > outstanding) to
    // mean "repay everything". Partial repays send the exact amount which is
    // naturally <= outstanding, so this is a no-op for them. No funds are
    // lost — the SPL transfer only moves `actual_amount`.
    let actual_amount = amount.min(outstanding_raw);
    require!(actual_amount > 0, LendGuardError::InvalidRepayAmount);

    // Compute the scaled-debt slice to subtract. If we're fully repaying we
    // wipe the entire scaled principal — otherwise we round down conservatively
    // so the position never goes "negative" in raw terms.
    let scaled_repay = if actual_amount == outstanding_raw {
        ctx.accounts.borrow_position.principal
    } else {
        to_scaled(actual_amount, borrow_index)?
            .min(ctx.accounts.borrow_position.principal)
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

    let (remaining_principal, position_key) = {
        let position = &mut ctx.accounts.borrow_position;
        position.principal = position
            .principal
            .checked_sub(scaled_repay)
            .ok_or(LendGuardError::ArithmeticOverflow)?;
        position.last_updated_at = now;
        position.borrow_index_snapshot = borrow_index;
        (position.principal, position.key())
    };

    {
        let pool = &mut ctx.accounts.lending_pool;
        pool.total_borrowed = pool
            .total_borrowed
            .checked_sub(scaled_repay)
            .ok_or(LendGuardError::ArithmeticOverflow)?;
    }

    emit!(BorrowRepaid {
        vault_id: ctx.accounts.vault.vault_id,
        position: position_key,
        owner: ctx.accounts.owner.key(),
        amount: actual_amount,
        remaining_principal,
        timestamp: now,
    });

    // Fully repaid → close the BorrowPosition and refund rent to the borrower.
    // This is the standard Aave/Compound/Solend pattern. It frees the PDA so
    // a fresh borrow on the same vault won't collide with a stale account.
    if remaining_principal == 0 {
        ctx.accounts
            .borrow_position
            .close(ctx.accounts.owner.to_account_info())?;
    }

    Ok(())
}

// ─── liquidate_position ──────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct LiquidatePosition<'info> {
    /// The under-collateralised vault. We mutate the lamport balance + reset
    /// proof status to require re-verification before reuse.
    #[account(mut)]
    pub vault: Box<Account<'info, VaultAccount>>,

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
        seeds = [ADMIN_PRICE_FEED_PDA_SEED, &[vault.asset_type]],
        bump = price_feed.bump
    )]
    pub price_feed: Box<Account<'info, AdminPriceFeed>>,

    #[account(
        mut,
        close = liquidator,
        seeds = [BORROW_POSITION_PDA_SEED, vault.key().as_ref()],
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

    /// CHECK: just receives lamports from the seized vault. Anchor enforces
    /// the writable + signer constraints; we don't need a typed account.
    #[account(mut)]
    pub liquidator: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

pub fn liquidate_position(ctx: Context<LiquidatePosition>) -> Result<()> {
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
    let vault = &ctx.accounts.vault;

    require!(!protocol.frozen, LendGuardError::ProtocolFrozen);
    require!(position.principal > 0, LendGuardError::NoOutstandingDebt);
    require!(
        position.owner != ctx.accounts.liquidator.key(),
        LendGuardError::SelfLiquidation
    );

    require!(
        now.checked_sub(price_feed.updated_at)
            .ok_or(LendGuardError::InvalidTimestamp)?
            <= PRICE_STALENESS_SECONDS,
        LendGuardError::PriceFeedStale
    );

    // Compute the actual on-chain debt (scaled principal × current borrow
    // index) and use that for the liquidation predicate. Plain-text gate is
    // the consensus enforcement; Phase 2 also stores an Encrypt ciphertext
    // for the health factor so the *off-chain monitor* can act privately.
    let outstanding_raw = current_debt(position.principal, pool.borrow_index)?;
    require!(
        is_liquidatable(
            vault.deposited_amount,
            price_feed.price_usd,
            outstanding_raw,
            pool.liquidation_threshold_bps,
        )?,
        LendGuardError::PositionHealthy
    );

    let repaid_amount = outstanding_raw;
    let scaled_to_close = position.principal; // wipes the position entirely

    // 1. Liquidator pays the full debt → pool token vault.
    let cpi_ctx = CpiContext::new(
        ctx.accounts.token_program.key(),
        Transfer {
            from: ctx.accounts.liquidator_token_account.to_account_info(),
            to: ctx.accounts.pool_token_vault.to_account_info(),
            authority: ctx.accounts.liquidator.to_account_info(),
        },
    );
    token::transfer(cpi_ctx, repaid_amount)?;

    // 2. Compute collateral to seize (with bonus). Cap at lamports the vault
    //    can actually move (must keep rent-exempt minimum).
    let seizable_lamports = collateral_with_bonus(
        vault.deposited_amount,
        pool.liquidation_bonus_bps,
    )?;
    let rent = Rent::get()?;
    let vault_lamports = ctx.accounts.vault.to_account_info().lamports();
    let rent_exempt_min = rent.minimum_balance(VaultAccount::LEN);
    let movable = vault_lamports.saturating_sub(rent_exempt_min);
    let seized = seizable_lamports.min(movable);
    require!(seized > 0, LendGuardError::InsufficientCollateralLamports);

    // 3. Move lamports vault → liquidator. Direct lamport accounting because
    //    the vault PDA is program-owned.
    **ctx.accounts.vault.to_account_info().try_borrow_mut_lamports()? = vault_lamports
        .checked_sub(seized)
        .ok_or(LendGuardError::ArithmeticOverflow)?;
    **ctx.accounts.liquidator.to_account_info().try_borrow_mut_lamports()? = ctx
        .accounts
        .liquidator
        .to_account_info()
        .lamports()
        .checked_add(seized)
        .ok_or(LendGuardError::ArithmeticOverflow)?;

    // 4. Update pool + vault state. Position is closed via Anchor's `close`
    //    constraint (rent refund goes to liquidator).
    let pool_mut = &mut ctx.accounts.lending_pool;
    pool_mut.total_borrowed = pool_mut
        .total_borrowed
        .checked_sub(scaled_to_close)
        .ok_or(LendGuardError::ArithmeticOverflow)?;

    let vault_mut = &mut ctx.accounts.vault;
    vault_mut.deposited_amount = vault_mut
        .deposited_amount
        .checked_sub(seized)
        .ok_or(LendGuardError::ArithmeticOverflow)?;
    // Force re-verification of any future borrowing against this vault.
    vault_mut.proof_status = PROOF_STATUS_PENDING;

    emit!(PositionLiquidated {
        vault_id: vault_mut.vault_id,
        position: ctx.accounts.borrow_position.key(),
        borrower: ctx.accounts.borrow_position.owner,
        liquidator: ctx.accounts.liquidator.key(),
        repaid_amount,
        seized_collateral_lamports: seized,
        liquidation_bonus_bps: pool_mut.liquidation_bonus_bps,
        timestamp: now,
    });

    Ok(())
}

// ─── interest-accrual helpers ───────────────────────────────────────────────
//
// Aave-style scaled-debt accounting:
//   - `pool.borrow_index` (1e18) compounds with elapsed slots × utilization rate
//   - `position.principal` stores SCALED debt (= raw_amount * RAY / index_at_borrow)
//   - `pool.total_borrowed` is the SUM of all scaled principals
//   - actual on-chain debt at any time: `principal * pool.borrow_index / RAY`
//
// At v0 deploy time `pool.borrow_index = RAY`, so positions stored before the
// rate model was active migrate transparently (scaled == raw at that moment).

/// Convert raw token units (LGUSD base units) into scaled-debt units using
/// the pool's CURRENT borrow_index. Caller must accrue first.
pub(crate) fn to_scaled(amount: u64, borrow_index: u128) -> Result<u64> {
    let scaled = (amount as u128)
        .checked_mul(LendingPool::RAY)
        .ok_or(LendGuardError::ArithmeticOverflow)?
        .checked_div(borrow_index)
        .ok_or(LendGuardError::ArithmeticOverflow)?;
    u64::try_from(scaled).map_err(|_| LendGuardError::ArithmeticOverflow.into())
}

/// Convert a scaled-debt principal back into the actual current debt in raw
/// token units, using the pool's CURRENT borrow_index. Caller must accrue
/// first for this to reflect interest.
pub(crate) fn current_debt(scaled_principal: u64, borrow_index: u128) -> Result<u64> {
    let raw = (scaled_principal as u128)
        .checked_mul(borrow_index)
        .ok_or(LendGuardError::ArithmeticOverflow)?
        .checked_div(LendingPool::RAY)
        .ok_or(LendGuardError::ArithmeticOverflow)?;
    u64::try_from(raw).map_err(|_| LendGuardError::ArithmeticOverflow.into())
}

/// Apply utilisation-based interest accrual to `pool`. Updates `borrow_index`
/// and `last_update_slot`. No-op when no time has passed or no debt exists.
pub(crate) fn accrue_interest(
    pool: &mut LendingPool,
    pool_key: Pubkey,
    now_slot: u64,
    now_ts: i64,
) -> Result<()> {
    if now_slot <= pool.last_update_slot {
        return Ok(());
    }
    let elapsed: u128 = (now_slot - pool.last_update_slot) as u128;

    if pool.total_borrowed == 0 || pool.total_liquidity == 0 {
        pool.last_update_slot = now_slot;
        return Ok(());
    }

    // current debt in raw units (so utilisation is consistent against
    // total_liquidity, which is also in raw units).
    let current_total_debt = (pool.total_borrowed as u128)
        .checked_mul(pool.borrow_index)
        .ok_or(LendGuardError::ArithmeticOverflow)?
        .checked_div(LendingPool::RAY)
        .ok_or(LendGuardError::ArithmeticOverflow)?;

    // utilisation in basis points (capped at 100 % so the slope can't extrapolate
    // to nonsense if accounting drift ever pushes it over).
    let util_bps = current_total_debt
        .checked_mul(BASIS_POINTS_DENOMINATOR as u128)
        .ok_or(LendGuardError::ArithmeticOverflow)?
        .checked_div(pool.total_liquidity as u128)
        .ok_or(LendGuardError::ArithmeticOverflow)?
        .min(BASIS_POINTS_DENOMINATOR as u128);

    let annual_rate_bps = (pool.base_rate_bps as u128)
        .checked_add(
            (pool.rate_slope_bps as u128)
                .checked_mul(util_bps)
                .ok_or(LendGuardError::ArithmeticOverflow)?
                .checked_div(BASIS_POINTS_DENOMINATOR as u128)
                .ok_or(LendGuardError::ArithmeticOverflow)?,
        )
        .ok_or(LendGuardError::ArithmeticOverflow)?;

    // delta_index = borrow_index * annual_rate_bps * elapsed / (SLOTS_PER_YEAR * 10_000)
    // u128 headroom check:
    //   borrow_index ≤ 10*RAY ≈ 1e19, annual_rate_bps ≤ 12_000, elapsed ≤ ~1e8 ⇒ ≈ 1.2e31, fits.
    let delta_index = pool
        .borrow_index
        .checked_mul(annual_rate_bps)
        .ok_or(LendGuardError::ArithmeticOverflow)?
        .checked_mul(elapsed)
        .ok_or(LendGuardError::ArithmeticOverflow)?
        .checked_div(
            SLOTS_PER_YEAR
                .checked_mul(BASIS_POINTS_DENOMINATOR as u128)
                .ok_or(LendGuardError::ArithmeticOverflow)?,
        )
        .ok_or(LendGuardError::ArithmeticOverflow)?;

    let prev_index = pool.borrow_index;
    pool.borrow_index = pool
        .borrow_index
        .checked_add(delta_index)
        .ok_or(LendGuardError::ArithmeticOverflow)?;
    pool.last_update_slot = now_slot;

    if delta_index > 0 {
        emit!(InterestAccrued {
            pool: pool_key,
            previous_index: prev_index,
            new_index: pool.borrow_index,
            elapsed_slots: elapsed as u64,
            timestamp: now_ts,
        });
    }

    Ok(())
}

// ─── helpers ─────────────────────────────────────────────────────────────────

fn validate_asset_type(asset_type: u8) -> Result<()> {
    require!(
        asset_type == ASSET_BTC || asset_type == ASSET_ETH || asset_type == ASSET_SOL,
        LendGuardError::InvalidAssetType
    );
    Ok(())
}

fn validate_bps(ltv: u16, liquidation_threshold: u16, liquidation_bonus: u16) -> Result<()> {
    require!(ltv > 0, LendGuardError::InvalidLendingPoolParameter);
    require!(
        (ltv as u64) < BASIS_POINTS_DENOMINATOR,
        LendGuardError::InvalidLendingPoolParameter
    );
    require!(
        (liquidation_threshold as u64) > (ltv as u64)
            && (liquidation_threshold as u64) <= BASIS_POINTS_DENOMINATOR,
        LendGuardError::InvalidLendingPoolParameter
    );
    require!(
        (liquidation_bonus as u64) <= BASIS_POINTS_DENOMINATOR / 2,
        LendGuardError::InvalidLendingPoolParameter
    );
    Ok(())
}

pub(crate) fn calculate_max_borrow(
    deposited_amount: u64,
    price_usd: u64,
    ltv_basis_points: u16,
) -> Result<u64> {
    let collateral_value_usd_8 = (deposited_amount as u128)
        .checked_mul(price_usd as u128)
        .ok_or(LendGuardError::ArithmeticOverflow)?
        .checked_div(COLLATERAL_DECIMALS as u128)
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

/// True iff `debt > collateral_value * liquidation_threshold_bps / 10000`.
/// All intermediate arithmetic is in u128 to avoid overflow on extreme prices.
pub(crate) fn is_liquidatable(
    deposited_amount: u64,
    price_usd: u64,
    debt: u64,
    liquidation_threshold_bps: u16,
) -> Result<bool> {
    let collateral_value_borrow_units = (deposited_amount as u128)
        .checked_mul(price_usd as u128)
        .ok_or(LendGuardError::ArithmeticOverflow)?
        .checked_div(COLLATERAL_DECIMALS as u128)
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

pub(crate) fn collateral_with_bonus(deposited_amount: u64, bonus_bps: u16) -> Result<u64> {
    let bonus_factor = (BASIS_POINTS_DENOMINATOR as u128)
        .checked_add(bonus_bps as u128)
        .ok_or(LendGuardError::ArithmeticOverflow)?;

    let with_bonus = (deposited_amount as u128)
        .checked_mul(bonus_factor)
        .ok_or(LendGuardError::ArithmeticOverflow)?
        .checked_div(BASIS_POINTS_DENOMINATOR as u128)
        .ok_or(LendGuardError::ArithmeticOverflow)?;

    u64::try_from(with_bonus).map_err(|_| LendGuardError::ArithmeticOverflow.into())
}
