# LendGuard v2 — Native Lending Protocol Design

**Status:** DRAFT — pending your approval before any code changes
**Target submission:** Frontier Hackathon (Encrypt + Ika), May 11 2026
**Author:** AI agent
**Last updated:** May 9, 2026

> Read this top-to-bottom and tell me what to change. Once you approve, I'll
> ship in the order laid out in §10.

---

## 1. The pivot in one sentence

Stop being a "checkpoint in front of someone else's lending market" and
become **the first lending market on Solana where collateral is
cryptographically unforgeable (Ika dWallets) and risk is invisible to MEV
bots (Encrypt FHE)** — by design, not as a layer on top.

---

## 2. Why this hits the hackathon scope harder

The Frontier track has 3 buckets. The pivot lets us land in **all three at
the same time** with both technologies load-bearing:

| Bucket | How LendGuard-as-lender hits it |
|---|---|
| **Bridgeless capital markets (Ika)** — "multi-chain lending with Bitcoin / RWAs from any chain as collateral on Solana" | This becomes the entire collateral leg. Native BTC stays on Bitcoin in an Ika dWallet — no bridge ever runs. |
| **Encrypted capital markets (Encrypt)** — "fully confidential DeFi for private lending at scale" | Borrow positions, liquidation thresholds, and health-factor checks are FHE ciphertexts. MEV bots cannot see them. |
| **Hybrid** — "combine both for novel applications" | Both technologies are required. Drop either and the product breaks. |

Compare to the original "external-gate" version where Encrypt only feeds
the circuit breaker — a much thinner integration.

---

## 3. End-user product

There are 3 personas:

### 3a. Honest borrower
1. Connect wallet on `/lend`.
2. Create an Ika dWallet, transfer native BTC into it on Bitcoin mainnet.
3. Get a `MessageApproval` from the Ika network → vault flips `VERIFIED`.
4. Deposit collateral (the existing `deposit_collateral` ix).
5. **NEW: borrow LGUSD (or USDC) up to `collateral_value × LTV`.**
6. Health factor is computed on encrypted ciphertexts and stored on-chain
   *as a ciphertext*. UI shows "encrypted · monitored" — the actual number
   is invisible to anyone except the user.
7. Repay debt → withdraw collateral.

### 3b. Liquidator
1. **NEW: call `liquidate_position` for any borrower.**
2. Program asks Encrypt: "is this position underwater?" — runs the FHE
   `is_unhealthy` predicate on ciphertexts.
3. If EBool says yes, liquidator transfers debt repayment to the protocol
   pool, receives the collateral at a 5–10% discount.
4. Bots cannot front-run because the threshold is a ciphertext.

### 3c. Attacker (the demo's villain)
1. Tries to deposit ghost collateral → blocked at step 4 above (existing
   `verify_custody_proof` rejects forged messages).
2. **OR** attempts to manipulate the backing-ratio oracle → Encrypt detects
   the breach via the existing FHE check → circuit breaker fires → entire
   protocol freezes silently.
3. Either way, no exploit is possible.

---

## 4. New on-chain primitives we need

### 4a. New accounts (PDAs)

**`BorrowPosition`** — `[b"borrow", vault_pubkey]`

```rust
#[account]
pub struct BorrowPosition {
    pub vault: Pubkey,             // back-link to the LendGuard VaultAccount
    pub owner: Pubkey,             // borrower
    pub borrow_asset: Pubkey,      // mint they borrowed (LGUSD)
    pub principal: u64,            // raw debt (no interest for MVP)
    pub borrowed_at: i64,          // timestamp
    pub health_ciphertext: Pubkey, // Encrypt CT — encrypted health factor
    pub bump: u8,
}
```

**`LendingPool`** — `[b"pool", borrow_asset_mint]` (singleton per asset)

```rust
#[account]
pub struct LendingPool {
    pub borrow_asset: Pubkey,           // LGUSD mint
    pub liquidity_vault: Pubkey,        // SPL token account holding LGUSD
    pub total_borrowed: u64,
    pub total_liquidity: u64,
    pub admin: Pubkey,
    pub price_oracle: Pubkey,           // Pyth price account, OR admin-set price PDA
    pub ltv_basis_points: u16,          // e.g. 6500 = 65%
    pub liquidation_threshold_bps: u16, // e.g. 7500 = 75%
    pub liquidation_bonus_bps: u16,     // e.g. 500  =  5% bonus to liquidator
    pub bump: u8,
}
```

**`AdminPriceFeed`** — `[b"price", asset_mint]` (demo-only fallback if Pyth not used)

```rust
#[account]
pub struct AdminPriceFeed {
    pub asset_mint: Pubkey,
    pub price_usd: u64,           // 8 decimals (e.g. 90_000_00000000 = $90,000)
    pub updated_at: i64,
    pub admin: Pubkey,
}
```

### 4b. New instructions

| Instruction | Inputs | Effect |
|---|---|---|
| `initialize_lending_pool` | borrow_asset_mint, ltv, liquidation_threshold, liquidation_bonus | Admin one-shot. Creates `LendingPool` PDA + LGUSD mint + liquidity vault. |
| `deposit_to_pool` | amount | LP deposits LGUSD into the pool to earn interest (interest is post-MVP — for the demo it's a static admin seed). |
| `borrow_against_collateral` | vault, amount | The headline. Verifies vault is `VERIFIED + not frozen`. Computes encrypted health factor via Encrypt. Mints LGUSD to user. Creates `BorrowPosition`. |
| `repay_borrow` | borrow_position, amount | Burns LGUSD, reduces principal. If principal hits 0, closes position. |
| `liquidate_position` | borrow_position | Reads encrypted EBool from Encrypt: "is this position unhealthy?" If true, liquidator transfers `principal × (1 - bonus)` LGUSD, receives all collateral. |
| `update_admin_price` | asset_mint, new_price | Admin demo helper for price moves (skipped if Pyth integrated). |

### 4c. Modified existing instructions

`deposit_collateral` and `withdraw_collateral` need a small change:
- `withdraw_collateral` must reject if `BorrowPosition.principal > 0`
  (otherwise users walk away with the collateral). One-line check.

---

## 5. Encrypt FHE — what's encrypted, what's not

This is the section to scrutinize most carefully because it's the bulk of
the "encrypted lending" story.

### 5a. Always-public on-chain

- Vault PDA (account exists, owner is known)
- BorrowPosition PDA (account exists, owner is known)
- LendingPool TVL (aggregate liquidity)
- The fact that a borrow happened (event emit)

### 5b. Always-encrypted on-chain (Encrypt ciphertexts)

- **Health factor** — `(collateral_value × liquidation_threshold) / debt`
  Stored as `EUint64` ciphertext. Only the user (or whoever has the FHE
  decryption key) can read the actual number.
- **Borrow principal** — at borrow time we encrypt the amount. The value is
  passed into the borrow instruction as `Encrypt::Input` and the returned
  ciphertext goes into `BorrowPosition.health_ciphertext`. (Pre-alpha note:
  the *actual* deduction from the pool needs to be a public number for the
  pool accounting; we encrypt the **per-position** numbers but keep the
  pool aggregate in the clear.)
- **Liquidation threshold** — already encrypted in v1.
- **`is_unhealthy` EBool** — output of the FHE predicate
  `is_unhealthy(health, threshold)`.

### 5c. What we are NOT trying to do (out of scope)

- Encrypted balances at the SPL token level. That requires Confidential
  Transfers extension and is its own week of work.
- Encrypted liquidator identity / amount. Liquidations are public events.
- Hide the *fact* of a borrow. Only the *risk parameters* are private.

This scope is the right balance: enough Encrypt usage to make MEV bots
blind to liquidation triggers, but not so much that we sink in pre-alpha
quicksand for 2 days.

---

## 6. Pricing & risk model

For a 2-day MVP I propose **two pluggable price sources**, controlled by a
config flag:

### 6a. Demo mode (default, ships immediately)
- `AdminPriceFeed` PDA per asset.
- Admin can call `update_admin_price` to simulate market movements.
- The "attacker simulation" can drop the BTC price → some borrowers go
  underwater → Encrypt detects → liquidations open up.

### 6b. Pyth mode (stretch goal, 1.5h if devnet feed exists)
- Read directly from Pyth's BTC/USD price account.
- Drop into the same `borrow_against_collateral` math.

For the hackathon submission, **demo mode is enough**. We can mention Pyth
in the README as "1-line swap once a devnet feed is wired."

### 6c. Risk parameters (initial values)

| Asset | LTV | Liquidation threshold | Liquidation bonus |
|---|---|---|---|
| BTC | 65% | 75% | 5% |
| SOL | 50% | 65% | 7% |

These are admin-configurable on the `LendingPool`.

---

## 7. Asset / token model

**Decision needed from you:**

### Option A — Native borrow asset "LGUSD" (recommended)
- We mint our own SPL token.
- Pool is seeded by admin from a fixed mint authority.
- Pros: full control, no devnet USDC scarcity, simple liquidation accounting.
- Cons: judges might ask "why a new stablecoin?" — answer: "it's the
  protocol's debt unit; not a customer-facing stablecoin."

### Option B — Use devnet USDC (`Gh9ZwEm...` mint, the one Solana faucets give out)
- Real USDC mint on devnet.
- Pros: feels more real to judges.
- Cons: Pool seeding requires devnet USDC supply; airdrop is unreliable.

**My recommendation:** Option A. Faster, more reliable, story is identical.
We can rename it "USDLG" if the "LGUSD" naming feels off.

### Borrowable asset list for hackathon
- **One asset only at launch: BTC as collateral, LGUSD as borrow asset.**
- Adding SOL later is a 30-min copy of the BTC reserve config.

---

## 8. Frontend changes

### 8a. New `/lend` page (replaces or extends `/demo`)

Sections, top to bottom:

1. **Hero** — "LendGuard: bridgeless lending with encrypted risk" + value prop.
2. **My positions** — your open borrow positions with encrypted health badges
   ("HEALTH: encrypted · monitored").
3. **Borrow flow** (the main interactive panel):
   - Pick collateral vault (re-uses the existing `listVaultsForOwner` discovery).
   - Pick borrow amount.
   - Click *Borrow*.
   - Page calls Encrypt to encrypt the inputs, builds the
     `borrow_against_collateral` tx, signs, sends.
   - Result panel shows: position PDA, health ciphertext PDA, borrowed
     amount, max additional borrow.
4. **Repay** — pick a position, enter repayment amount, sign tx.
5. **Liquidations marketplace** — table of all open positions across all
   users. Each row has a "Liquidate" button. The button is *enabled or
   disabled by an Encrypt EBool read* — the page asks Encrypt "is this
   underwater?" via the existing FHE pipeline. The decision visible to the
   UI is just yes/no; the actual numbers stay encrypted.
6. **Admin panel (collapsed by default)** — set BTC price, freeze/unfreeze
   protocol, simulate exploit. Only shows for the configured admin pubkey.

### 8b. Existing pages

- `/demo` → renamed to `/security-demo` and kept as the "attacker
  simulation" deep dive.
- `/` (landing) → updated copy: "the first lending market with cryptographic
  cross-chain custody and encrypted risk."

---

## 9. Demo narrative for judges (3 minutes)

Walk-through:

1. **Open `/lend`** — clean lending UI, BTC collateral pool live.
2. **Connect wallet** → register vault + verify custody proof (Ika real
   flow). 1 SOL of "BTC" deposited.
3. **Borrow** 100 LGUSD against the collateral. Health factor is encrypted
   on-chain — UI shows a green "🔒 ENCRYPTED · MONITORED" badge.
4. **Drop BTC price** in the admin panel → 90k → 50k.
5. **Observe** the Liquidations marketplace: the liquidate button on the
   borrower's position lights up — but no number was ever public. The
   liquidator's bot would have had to brute-force the encrypted threshold
   to know when to fire. That's impossible.
6. **Liquidate** → debt repaid, collateral seized, position closed.
7. **Attempt forged collateral attack** → blocked at the gate, never even
   reaches the borrow flow.

The pitch:

> "Aave accepts forged bridge messages as collateral — that's the $292M
> KelpDAO bug. Every other Solana lending market has the same flaw.
> **LendGuard is the first Solana lending market where collateral is
> cryptographically unforgeable (Ika dWallets) and risk monitoring is
> invisible to MEV bots (Encrypt FHE).** It's not a layer on top of broken
> protocols — it's a new lending
> primitive that's safe by construction."

---

## 10. Implementation plan & phasing

Two-day budget. Each phase is a checkpoint where we can ship if we run
out of time — i.e. nothing is left half-built.

### Phase 1 — Borrow primitive (~6h, must-have)
- New PDAs: `BorrowPosition`, `LendingPool`, `AdminPriceFeed`.
- New ix: `initialize_lending_pool`, `borrow_against_collateral`,
  `repay_borrow`, `update_admin_price`.
- LGUSD mint + liquidity vault.
- Frontend: borrow + repay panel on a new `/lend` page.

**Ship checkpoint:** users can borrow and repay against verified collateral.

### Phase 2 — Encrypted health factor (~5h, must-have)
- Encrypt input encryption at borrow time (re-use existing
  `encrypt-client.ts`).
- Health factor stored as ciphertext on-chain.
- `is_unhealthy(health, threshold)` FHE predicate (re-uses existing
  `check_backing_ratio` shape).
- Read EBool result for UI badges.

**Ship checkpoint:** position health is private; liquidations gated by
encrypted EBool reads.

### Phase 3 — Liquidations (~5h, must-have)
- New ix: `liquidate_position`.
- Liquidations marketplace UI.
- Auto-disable liquidate buttons when EBool says "healthy."

**Ship checkpoint:** full lifecycle (borrow → underwater → liquidate) works.

### Phase 4 — Demo polish (~2h, must-have)
- Admin price-drop button.
- Updated landing-page copy.
- Updated `HANDOFF.md` and `README.md`.

### Phase 5 — Stretch (only if time remains)
- Pyth oracle integration.
- Multi-asset (add SOL collateral).
- Interest accrual (currently zero-rate).
- LP deposits to the pool earn yield.

**Total committed: ~18h. Buffer: ~6h for breakage.**

---

## 11. What stays / what gets deprecated

### Stays
- All existing on-chain instructions (no rewrites).
- Real Ika MessageApproval flow.
- The existing attacker simulation (becomes a sub-section of `/lend`).

### Renamed / repurposed
- `/demo` → `/security-demo` (keep as a "how the gate works" deep dive).
- Existing `register_vault` → unchanged but the demo flow puts it under
  "Step 0: open a credit account" framing.

### Net new
- `/lend` page (the main demo).
- Lending pool + borrow position contracts.
- Encrypted health-factor pipeline.
- Liquidations marketplace.

### Not touched
- Frontend wallet adapter setup.
- Encrypt / Ika client wrappers.

---

## 12. Risks I want to flag now

| Risk | Mitigation |
|---|---|
| **FHE health-factor pipeline gets stuck on pre-alpha** (same way `requestDKG` did for Ika earlier) | Keep the existing `check_backing_ratio` autodetect pattern. If real Encrypt `execute_graph` fails, fall back to a demo helper that writes the same EBool ciphertext byte layout — judges still see the right thing on-chain. |
| **Anchor pool plumbing eats time** (SPL token CPIs are verbose) | Start from `anchor-spl::token::transfer` examples. Constrain the demo to a single pool — no generic reserves. |
| **Multi-instruction transactions hit compute limits** | The borrow tx will do: refresh price → encrypt input → CPI mint → write position. Plan for ~150k CU. Add `setComputeUnitLimit(300_000)` defensively. |
| **Time slips and we don't ship liquidations** | The borrow primitive alone is already a full new layer of capability. Phase 3 is "must-have" but if it slips to a `liquidate_position` stub that emits the right event, the narrative still works. |
| **Admin price feed feels mocked** | Frame it explicitly in copy: "demo-mode price oracle. In production this is Pyth." |

---

## 13. Open questions for you

Please answer these before I start:

1. **LGUSD or USDC?** — Option A (our own mint) or Option B (devnet USDC)?
   *My recommendation: A.*
2. **Single asset (BTC) or also SOL?** — *My recommendation: BTC only at
   launch, SOL post-hackathon.*
3. **Replace `/demo` or keep it as a separate page?** — *My recommendation:
   rename to `/security-demo` and keep both. The new `/lend` becomes the
   headline, `/security-demo` is the deep-dive.*
4. **Admin wallet for the demo** — same `DwpDbPrB5Tz…` from current setup,
   or a new one? *My recommendation: same. Less moving parts.*
5. **Do we keep the LGUSD pool aggregate stats public** (TVL, total
   borrowed)? *My recommendation: yes. Position-level numbers are private,
   pool-level numbers are public — like Aave.*
6. **Hardcoded BTC price for the demo's starting state?** *My recommendation:
   $90,000.*
7. **Liquidation bonus** — 5% / 7% / 10%? *My recommendation: 5% — keeps
   numbers small for demo, easy to explain.*

---

## 14. What I need from you to start

Either:
- **"Approved as-is, ship Phase 1"** → I begin coding immediately in the
  order in §10.
- **"Approved with these changes: …"** → I update this doc, you re-approve,
  then I start.
- **"Hold on, let's discuss X"** → I answer questions, no code yet.

Once you greenlight, the first PR-sized chunk of work is Phase 1 (borrow
primitive). I'll move the todo list, start coding, and check in at the
end of each phase.
