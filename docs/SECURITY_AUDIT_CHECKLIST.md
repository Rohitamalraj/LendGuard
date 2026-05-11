# LendGuard — Security Self-Audit Checklist

This is a **pre-audit self-review** of the LendGuard Anchor program at the
state captured by program ID `GQia1ewyLgtkgX7HSfuttJ42qNPpYJhUbxeyCPXtcJFR`
on Solana devnet. It is not a substitute for an external audit — it documents
the threat model we are designing against and what we have / have not
implemented.

Items are tagged:

- ✅ Implemented and verified.
- ⚠️ Partial / known gap, with mitigation notes.
- ❌ Out of scope for this milestone (with rationale).

---

## 1. Account validation & authority

| # | Check | Status | Notes |
|---|-------|--------|-------|
| 1.1 | All mutable accounts use Anchor's `Account<'info, T>` (typed deserialization, owner check) | ✅ | All instructions in `instructions/lending.rs`. |
| 1.2 | All PDAs include explicit `seeds = […]` and `bump = pool.bump` constraints | ✅ | `lending_pool`, `admin_price_feed`, `borrow_position`, `protocol_state`. |
| 1.3 | Cross-account references validated via `has_one` constraints | ✅ | `borrow_position.has_one = vault, owner`; `price_feed.has_one = admin`. |
| 1.4 | Admin-only instructions check `has_one = admin` against the price-feed admin | ✅ | `update_admin_price`, `close_admin_price_feed`. |
| 1.5 | `liquidate_position` is permissionless, but blocks self-liquidation | ✅ | `LendGuardError::SelfLiquidation`. |
| 1.6 | Token account ownership verified before any `token::transfer` | ✅ | `borrower_token_account.owner == owner.key()` and `pool_token_vault.owner == lending_pool.key()`. |
| 1.7 | Borrow asset mint is enforced equal to the pool's mint on every transfer | ✅ | `BorrowAssetMintMismatch` error. |

## 2. Funds-safety primitives

| # | Check | Status | Notes |
|---|-------|--------|-------|
| 2.1 | LGUSD mint authority is the `lending_pool` PDA, not a wallet | ✅ | Bootstrap script transfers authority via `setAuthority`. |
| 2.2 | Pool token vault is owned by the `lending_pool` PDA (off-curve) | ✅ | Via SPL ATA with `allowOwnerOffCurve=true`. |
| 2.3 | All token transfers happen via real SPL `Transfer` CPI, signed with PDA seeds | ✅ | `borrow_against_collateral` does `CpiContext::new_with_signer`. |
| 2.4 | Vault lamports stay above rent-exempt minimum after liquidation | ✅ | `let movable = vault_lamports.saturating_sub(rent_exempt_min);`. |
| 2.5 | Repay amount is capped at the position's outstanding debt | ✅ | `require!(amount <= outstanding_raw)`. |
| 2.6 | Borrow amount is capped by collateral × LTV | ✅ | `BorrowExceedsCollateralLtv`. |
| 2.7 | Borrow amount is capped by available pool liquidity | ✅ | `InsufficientPoolLiquidity`. |
| 2.8 | Liquidation requires the position is actually under-collateralised | ✅ | `is_liquidatable()` check; same math as on-chain price feed. |

## 3. Arithmetic safety

| # | Check | Status | Notes |
|---|-------|--------|-------|
| 3.1 | All u64 arithmetic uses `checked_*` operations | ✅ | `ArithmeticOverflow` error wraps every `?` site. |
| 3.2 | Interest accrual uses u128 intermediates to avoid overflow | ✅ | `borrow_index ≤ 1e19, rate ≤ 1.2e4, elapsed ≤ 1e8 ⇒ ≤ 1.2e31, fits in u128`. |
| 3.3 | Utilisation is capped at 100 % so the rate slope can't extrapolate | ✅ | `.min(BASIS_POINTS_DENOMINATOR as u128)`. |
| 3.4 | Scaled debt conversion (`to_scaled`, `current_debt`) is reversible at index = RAY | ✅ | Verified by SDK unit tests. |
| 3.5 | LTV / liquidation threshold / bonus are validated at pool init | ✅ | `validate_bps`. |

## 4. Time / freshness

| # | Check | Status | Notes |
|---|-------|--------|-------|
| 4.1 | Borrow rejects vaults whose dWallet proof has expired | ✅ | `PROOF_EXPIRY_SECONDS`. |
| 4.2 | Borrow + liquidation reject stale price feeds | ✅ | `PRICE_STALENESS_SECONDS`. |
| 4.3 | Interest accrual is monotonic in `slot` (no time-travel) | ✅ | `if now_slot <= pool.last_update_slot { return Ok(()); }`. |

## 5. Frozen-state semantics

| # | Check | Status | Notes |
|---|-------|--------|-------|
| 5.1 | Borrow respects `protocol.frozen` and `vault.frozen` | ✅ | `ProtocolFrozen`, `VaultFrozen`. |
| 5.2 | Liquidation respects `protocol.frozen` (admin can pause the system) | ✅ |  |
| 5.3 | Repay does *not* require unfrozen state — a borrower can always pay debt down | ✅ | Intentional, mirrors Aave. |

## 6. Encrypt FHE integration (Phase 2)

| # | Check | Status | Notes |
|---|-------|--------|-------|
| 6.1 | Borrow stores a real Encrypt ciphertext PDA on `position.health_ciphertext` | ✅ | Frontend calls `createEncryptInputs` and passes the result. |
| 6.2 | Encrypt program ID is recorded as the only authorized program for that ciphertext | ✅ | `authorized: PROGRAM_ID.toBytes()` in `createEncryptInput`. |
| 6.3 | The on-chain liquidation gate evaluates an EBool produced by an Encrypt graph | ⚠️ | Deferred. Pre-alpha Encrypt does not yet ship a CPI EBool reader. Plaintext consensus gate is enforced; encrypted ciphertext acts as a *private monitoring signal* until on-chain CPI exists. |
| 6.4 | Re-encrypted health factor on price updates | ❌ | Future work — would require an off-chain monitor that re-runs the encrypted graph on every price tick. |

## 7. Ika dWallet integration

| # | Check | Status | Notes |
|---|-------|--------|-------|
| 7.1 | Custody proofs require a `MessageApproval` whose `dwallet_id` matches the vault | ✅ | `verify_custody_proof` ix. |
| 7.2 | Real Ika CPI path exists (`approve_custody_signature`) | ✅ | `instructions/approve_custody_signature.rs`. |
| 7.3 | Demo `MessageApproval` helper is gated behind `demo_*` instructions and not used in production borrow path when real Ika network is reachable | ⚠️ | Pre-alpha Ika network has reach issues; demo ixs remain in the program. Prod build should compile them out via a `demo` cargo feature. |

## 8. Ops / governance

| # | Check | Status | Notes |
|---|-------|--------|-------|
| 8.1 | Program upgrade authority is documented in `HANDOFF.md` | ✅ | `AQHbkBSS6oMMEFL7wgDnBnwYBSVRBLk81pQ2iP86yUrc`. |
| 8.2 | Multisig migration script exists | ✅ | `contracts/scripts/transfer-upgrade-authority.mjs` (Phase 7). |
| 8.3 | Bootstrap script is idempotent | ✅ | All steps `await exists()` before acting. |
| 8.4 | A circuit breaker can freeze the protocol on demand | ✅ | `circuit_breaker_freeze` + `unfreeze_protocol_state`. |

## 9. Front-running / MEV resistance

| # | Check | Status | Notes |
|---|-------|--------|-------|
| 9.1 | Health factor is encrypted at borrow time so MEV bots cannot deterministically predict liquidation | ✅ | Phase 2 — Encrypt ciphertext PDA. |
| 9.2 | Liquidation does not use a public oracle that an attacker could manipulate via flash loans | ⚠️ | Demo uses an admin-set price feed, not Pyth/Switchboard. Prod replaces with a Pyth Pull oracle. |

## 10. Known limitations / future work

- **Encrypt CPI EBool gate** (item 6.3) is the most important production-grade item we cannot ship until Encrypt has a Solana CPI surface. The plaintext gate is correct; encrypted health is a parallel privacy/MEV signal until then.
- **Pyth oracle**: replace `AdminPriceFeed` with a Pyth Pull oracle account before mainnet.
- **Reserve factor**: a portion of accrued interest should accrue to a protocol reserve (today, 100% accrues to lenders).
- **Position auto-rebase on price updates**: today `last_updated_at` only advances on user interactions; long-idle positions accumulate interest correctly via the index but do not emit per-position events.
- **Fuzz tests**: SDK unit tests cover the math for representative cases; a future milestone should fuzz `current_debt`, `is_liquidatable`, and `accrue_interest` with property-based testing.
- **External audit**: this checklist is not a substitute for a third-party audit. We recommend OtterSec / Halborn / Neodyme before any mainnet deploy with real user funds.
