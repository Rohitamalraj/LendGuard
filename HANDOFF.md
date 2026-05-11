# LendGuard — Developer Handoff Document

> For anyone picking up this project to continue development.  
> Read this fully before touching any code.

---

## 0. Production-readiness milestone (updated May 11 2026)

The codebase has moved from a hackathon collateral-integrity demo to a fully
functional native lending protocol. This section is the **current** state of
truth — the rest of the document is older context.

### What's live on devnet (program `GQia1ewyLgtkgX7HSfuttJ42qNPpYJhUbxeyCPXtcJFR`)

| Concern | Status |
|---|---|
| Real LGUSD SPL mint, mint authority = lending_pool PDA | ✅ |
| Pool token vault (PDA-owned ATA, seeded with 1,000 LGUSD) | ✅ |
| `borrow_against_collateral` does real SPL `Transfer` CPI to borrower's ATA | ✅ |
| `repay_borrow` does real SPL `Transfer` CPI back to pool vault | ✅ |
| `liquidate_position` (permissionless, repays debt + seizes collateral with bonus) | ✅ |
| Aave-style scaled-debt accounting + utilisation-based interest accrual | ✅ |
| Multi-asset price feeds (BTC + ETH + SOL) | ✅ |
| Bitcoin testnet collateral path via Ika Secp256k1 dWallets | ✅ |
| BTC balance keeper (`mempool.space` testnet → `attest_btc_balance`) | ✅ |
| BTC liquidation broadcaster/finalizer script | ✅ |
| Encrypt FHE health-factor ciphertext stored on every borrow position | ✅ |
| `/lend` UI: existing SOL flow + additive Bitcoin testnet collateral section | ✅ |
| `@lendguard/sdk@0.2.0` with builders + decoders + math + tests (23 passing) | ✅ |
| GitHub Actions CI (SDK + web + contracts) | ✅ |
| Multisig upgrade-authority transfer script + ops runbook | ✅ |
| Security self-audit checklist (`docs/SECURITY_AUDIT_CHECKLIST.md`) | ✅ |
| On-chain Encrypt CPI EBool gate at liquidation | ⚠️ Deferred — pre-alpha Encrypt has no Solana CPI surface yet. Plaintext gate is enforced; encrypted health acts as a parallel privacy/MEV signal. |
| Mainnet deploy | ❌ Out of scope until external audit. |

### Devnet artefacts (current, May 9 2026)

| Artefact | Address |
|---|---|
| Program | `GQia1ewyLgtkgX7HSfuttJ42qNPpYJhUbxeyCPXtcJFR` |
| Upgrade authority | `AQHbkBSS6oMMEFL7wgDnBnwYBSVRBLk81pQ2iP86yUrc` |
| LGUSD mint (decimals 6) | `9NuCY56MCS8FcGZ1i3wjpzffjwb9mnAQdX4CwgNWzhpZ` |
| Lending pool PDA | `ERoDLeqLxNvgT7ELJRdVSye3qgaogjd2MrW8PWeCPAL3` |
| Pool token vault (PDA-owned ATA) | `D7yZ7H6ZgsQ1NeTJddQnWxfGjYdZodtnNABkE1u1b9YC` |
| protocol_state PDA | `5xou7zabzaSxyUxzJpXHHghS8chXWXRGDWExfp52gfzb` |
| BTC price feed | `2MZ2WFagd9qo5B2qH4UMqa3dd5KhWZtRGCVjg6KyTYAY` |
| ETH price feed | `6vCHFLPnwUJ37yAR2hLiUikzddUcbyqWr9EjLvvZW3yJ` |
| SOL price feed | `HZbVcrPUY4KZt6Nb1RD61ygUfaD4edeFDv3gsdtkrY2E` |

### Bitcoin testnet collateral upgrade (May 11 2026)

The existing SOL/devnet collateral path was **not changed**. A parallel BTC
testnet path was added using separate account types and PDA seeds.

| Component | Status |
|---|---|
| `BtcVaultAccount` | ✅ `contracts/src/state/btc_vault_account.rs` |
| `BitcoinBalanceAttestation` | ✅ `contracts/src/state/btc_balance_attestation.rs` |
| `register_btc_vault` | ✅ registers Ika Secp256k1 dWallet + `tb1…` address |
| `attest_btc_balance` | ✅ admin keeper posts satoshi balance from Bitcoin testnet |
| `verify_btc_custody_proof` | ✅ verifies real Ika `MessageApproval` against registered dWallet |
| `borrow_against_btc_collateral` | ✅ mints/transfers LGUSD against fresh attested tBTC balance |
| `repay_btc_borrow` | ✅ repay + repay-all dust forgiveness + position close |
| `liquidate_btc_position` | ✅ repays LGUSD and CPI-calls Ika `approve_message` for Bitcoin sighash |
| `finalize_btc_liquidation` | ✅ keeper finalizes after Bitcoin testnet tx confirmation |
| `contracts/scripts/btc-balance-keeper.mjs` | ✅ mempool.space testnet poller |
| `contracts/scripts/btc-liquidation-broadcaster.mjs` | ✅ raw tx broadcast + finalize |
| `/lend` BTC section | ✅ register, load, verify, borrow, repay |

**Upgrade tx:** `4B5PoTG2DRrwx3qnAN31UtBmGgmuvpN9LhLED7ECnMEpnn9eWGLt941M56ApCSvuHGKNH3Qsk6qyeMa2qfSEjuAt`

**Post-upgrade program state:**

- Program ID: `GQia1ewyLgtkgX7HSfuttJ42qNPpYJhUbxeyCPXtcJFR`
- ProgramData: `4Mby1BYNvu9MizaPYCynihb7FM2vg48oEqzEBVDYUBin`
- Last deployed slot: `461667880`
- Data length: `732520` bytes

See `docs/BTC_COLLATERAL_PATH.md` for the full flow and caveats.

### Recent upgrade transactions (chronological)

| Phase | Tx |
|---|---|
| Fresh deploy (Phase 1: SPL token + liquidate) | `2mQVT4xAYjV16wnm5C127jbp263aXQUYNEJyo51ii9ZaKNF1iFKcTPV9BrWJTMMwsk49bTp5gQiSWfqwjEvkebFu` |
| Upgrade (Phase 3: interest accrual, scaled debt) | `3vGsnKFmLxyDZwLA6U9jghdAL9YC4D3b7z9DHaheEFKRDnryJ8TK6dzD7kEnABBKEcLNzrFP8Keda4QXzkszLyKL` |
| Upgrade (Phase 4: `initialize_admin_price_feed` for multi-asset) | `3nsjKz2HL1pENgAQunRYaBA89pmCQxHCoPHDDSAYhisF1dahvh45XvKYKU331adJoE6KHmkn7jFGo5iUfBB8cQYT` |
| Upgrade (BTC testnet collateral path) | `4B5PoTG2DRrwx3qnAN31UtBmGgmuvpN9LhLED7ECnMEpnn9eWGLt941M56ApCSvuHGKNH3Qsk6qyeMa2qfSEjuAt` |

### How to take this from here to mainnet

1. **External audit.** OtterSec, Halborn, or Neodyme. The self-audit checklist
   (`docs/SECURITY_AUDIT_CHECKLIST.md`) lists everything an auditor will be
   looking at.
2. **Replace `AdminPriceFeed` with a Pyth Pull oracle account.** Layout
   change requires another redeploy.
3. **Wait for the Encrypt mainnet CPI.** Until then, the encrypted health
   factor is privacy-only; the consensus liquidation gate is plaintext.
4. **Transfer upgrade authority to a multisig** — see
   `docs/PRODUCTION_OPS.md` and `contracts/scripts/transfer-upgrade-authority.mjs`.
5. **Publish `@lendguard/sdk@0.2.0` to npm.** Tarball is built and validated
   (`npm publish --access public` from `packages/sdk/`).

---

## 1. What Is LendGuard?

LendGuard started as a **collateral integrity layer** that protected external
lending protocols from bridge-forged ghost collateral, and grew into its own
**native lending protocol**: every component (LGUSD mint, borrow positions,
liquidations, interest accrual) runs on top of Ika dWallet collateral
provenance and Encrypt FHE health monitoring.

**The problem it originally solved:** every DeFi lending protocol today accepts
cross-chain collateral by trusting a bridge message blindly. On April 17 2026
KelpDAO was exploited for $292M this way — a compromised LayerZero validator
forged a message, Aave accepted ghost collateral, and $190M was drained.

**The two Solana-native primitives that make LendGuard work:**

- **Ika dWallets** — 2PC-MPC protocol that produces cryptographically
  unforgeable custody proofs. The deposit guard reads an Ika `MessageApproval`
  account on-chain; a compromised validator cannot forge it.
- **Encrypt FHE** — Fully Homomorphic Encryption that lets the protocol seal
  every borrow position's health factor (debt, collateral, threshold) so MEV
  bots can't deterministically front-run liquidations.

---

## 2. What Has Been Built (Completed Work)

### 2a. Solana Anchor Program — `contracts/`

**Deployed on devnet (Anchor 1.x build, fresh program — May 9 2026):**
- **Program ID:** `GQia1ewyLgtkgX7HSfuttJ42qNPpYJhUbxeyCPXtcJFR` (fresh deploy on May 9 2026 with a rotated upgrade authority — old program ID `FymmJAKSLcadQTjyiGjQW1iyegKLMdHhSND1bDjgZg1X` is orphaned)
- **Fresh deploy tx (Phase-1 lending instructions, May 9 2026):** `Rde3UwUPQy31YSPyuwWKni9KmzpV6xaquR2CQ3nXFTnGHCLaAo9qLwmqdgWEnBQrQraNz92Sgpq4oKuaQxZsTNf`
- **Bootstrap `initialize_protocol` tx:** `3whKD4f4mNNYHFipSMKtZC89KaVxmX2v4TvVpyZ58WBsR3exPd3MgSttNoAjwMwthx3TyBKtV8ycoGzadyxc8J9r`
- **Bootstrap `initialize_lending_pool` (BTC, $90k, 65% LTV) tx:** `3yAzRnCRqgU9aSr4bHa8ZnAUZ4sCod8xCfVVhhWz4gVNGt8AskDEJqAQ67MwYBNMrDHjHtAA4zZT3v4guwaB2u8x`
- **Authority:** `AQHbkBSS6oMMEFL7wgDnBnwYBSVRBLk81pQ2iP86yUrc` (rotated devnet wallet, May 9 2026 — previous authority `DwpDbPrB5TzZAEwcB1WjUdfcTjH39uhhY8Wk8W4KfN38` is retired)
- **ProgramData:** `4Mby1BYNvu9MizaPYCynihb7FM2vg48oEqzEBVDYUBin`
- **Last deployed slot:** `461014961` (fresh deploy, May 9 2026)
- **Bootstrapped PDAs:** protocol_state `5xou7zabzaSxyUxzJpXHHghS8chXWXRGDWExfp52gfzb`, lending_pool `31DCy3cbVMLR1G47wb3QrNGLbF1emNoAAN9oxWtH4YmZ`, admin_price_feed `2MZ2WFagd9qo5B2qH4UMqa3dd5KhWZtRGCVjg6KyTYAY`, lgusd_asset `9q1EkutzNDD8jPk7MqModq4kTeo83Z2ZFU3QH2DPfKAq`

**Prior history (old program `FymmJAKSLcadQTjyiGjQW1iyegKLMdHhSND1bDjgZg1X`, retired):**
- Latest upgrade tx (autodetect Encrypt EBool reader): `3hT5FPEBucLZHj3bbuizZNq78e2SZSpa3p4ebu7Bv8n6EMJvMt1whfZ1GDpV6o3EFmLPQvLzervJDkMptzirW3k8`
- Prior upgrade tx (permissionless `unfreeze_protocol_state`): `48N6Qdxf69k4rnui8TD9LHtX8aRm939DboCaJnujheADiqzk1zSBqPyCT6YN7iGkuMacQS7eKw2HTocXoTHEdtDt`
- Prior upgrade tx (real Ika CPI): `46EMxkn78R5RLZZhgNQtNjnb8taiaGqGNpLkQYVwc5srJZWyo2JJR5dYao373AV76pg2G3p39kcmMkiim2mGGVJp`
- Anchor 1.x migration tx: `2uWb15EGEmBFuSsb17pSFz7ymYqGZDM1NYJJCFKqgRKJpNH6ZBcqdQJjF8fcfSo8jouibfDjan3eDPkV3N9Dbfni`
- Original v0.31 deploy tx: `4cMP868pZ6nB5H7PNV8rtkg2Ew6czMysz4gLJqfFkXbx4aNYD1a2LF8ppi8NbZhv1vzTYx2VWDrWfmDpA8Hc8dGC` (slot 460542552)

**Lending instructions (added in the May 9 2026 milestone):**

| Instruction | File | Purpose |
|---|---|---|
| `initialize_lending_pool` | `instructions/lending.rs` | Bootstrap LGUSD lending pool with real SPL mint, pool token vault, LTV/threshold/bonus, and rate-model parameters |
| `initialize_admin_price_feed` | `instructions/lending.rs` | Admin-only — bootstrap a `AdminPriceFeed` for an asset_type (used to add ETH and SOL feeds after BTC) |
| `update_admin_price` | `instructions/lending.rs` | Admin-only — update the (demo) price feed for an asset; will be replaced by Pyth Pull in production |
| `close_admin_price_feed` | `instructions/lending.rs` | Admin-only — close a stale price feed PDA so it can be re-initialised under a new layout |
| `borrow_against_collateral` | `instructions/lending.rs` | Borrow LGUSD against a verified Ika-backed vault; real SPL `Transfer` CPI from pool vault to borrower's ATA. Stores Encrypt ciphertext PDA for the encrypted health factor |
| `repay_borrow` | `instructions/lending.rs` | Repay (part of) a borrow position; real SPL `Transfer` CPI back to pool vault. Aave-style scaled-debt accounting against `pool.borrow_index` |
| `liquidate_position` | `instructions/lending.rs` | Permissionless — when health < threshold, anyone can repay the full debt and seize the collateral lamports + a liquidation bonus |

**Original collateral-integrity instructions (stable from earlier):**

| Instruction | File | Purpose |
|---|---|---|
| `initialize_protocol` | `instructions/initialize_protocol.rs` | Bootstrap protocol PDA + set admin |
| `register_vault` | `instructions/register_vault.rs` | Create vault PDA, link to Ika dWallet ID |
| `initialize_risk_state` | `instructions/initialize_risk_state.rs` | Create risk PDA, set encrypted threshold key |
| `verify_custody_proof` | `instructions/verify_custody_proof.rs` | Read Ika `MessageApproval`, mark vault VERIFIED |
| `refresh_custody_proof` | `instructions/verify_custody_proof.rs` | Re-verify to reset proof expiry timestamp |
| `deposit_collateral` | `instructions/deposit_collateral.rs` | Accept deposit — blocked if not VERIFIED or frozen |
| `withdraw_collateral` | `instructions/deposit_collateral.rs` | Withdraw — blocked if protocol frozen |
| `reject_unverified_deposit` | `instructions/deposit_collateral.rs` | Admin-only rejection with event emit |
| `update_backing_state` | `instructions/update_backing_state.rs` | Oracle writes backing ciphertext key to risk state |
| `trigger_risk_check` | `instructions/trigger_risk_check.rs` | Reads EBool result from Encrypt ciphertext account |
| `circuit_breaker_freeze` | `instructions/circuit_breaker.rs` | Freeze protocol or vault — admin only |
| `admin_unfreeze` | `instructions/circuit_breaker.rs` | Unfreeze after incident — admin only |
| `close_vault` | `instructions/close_vault.rs` | Close vault and reclaim rent — only if zero balance |
| `approve_custody_signature` | `instructions/approve_custody_signature.rs` | **Real Ika CPI** — invokes `ika_dwallet_anchor::DWalletContext::approve_message` via `invoke_signed` to create a 287-byte `MessageApproval` PDA owned by the Ika dWallet program. |

**On-chain account types (PDAs):**

| Account | Seed | File |
|---|---|---|
| `ProtocolStateAccount` | `[b"protocol_state"]` | `state/protocol_state.rs` |
| `VaultAccount` | `[b"vault", owner_pubkey, dwallet_id]` | `state/vault_account.rs` |
| `RiskStateAccount` | `[b"risk_state", vault_pubkey]` | `state/risk_state.rs` |
| `LendingPool` | `[b"lending_pool", borrow_asset_mint]` | `state/lending_pool.rs` |
| `AdminPriceFeed` | `[b"admin_price", asset_type]` | `state/admin_price_feed.rs` |
| `BorrowPosition` | `[b"borrow_position", vault_pda]` | `state/borrow_position.rs` |

**Integration adapters:**

- `integrations/ika.rs` — Parses Ika `MessageApproval` account data (dwallet_id, approved_at, is_signed). Validates signature, ID match, and proof freshness (24-hour expiry). Pre-alpha: uses raw AccountInfo, no external crate dependency.
- `integrations/encrypt.rs` — Reads an Encrypt ciphertext account and interprets byte[0] as the EBool result. Pre-alpha: data is plaintext on devnet, same code works on mainnet when FHE is live.
- `fhe/check_backing_ratio.rs` — The `#[encrypt_fn]` DSL circuit definition. **Not compiled into the program binary** (gated by `--features fhe`). This gets sent to the Encrypt off-chain executor.

**Error types** — `errors.rs` has 19 custom error codes including `VaultNotVerified`, `ProtocolFrozen`, `ProofExpired`, `DWalletMismatch`, `ArithmeticOverflow`, etc.

**Build setup decisions made:**
- **Anchor 1.x migration completed (May 7, 2026).** Both `ika-dwallet-anchor` and `encrypt-anchor` officially require `anchor-lang = "1"` and `edition = "2024"`, so we migrated. `Cargo.toml` now pulls them in directly so the next round of work can use real CPI.
- All `AccountInfo<'info>` fields in `#[derive(Accounts)]` rewritten as `UncheckedAccount<'info>` with `/// CHECK:` doc comments (Anchor v1 requirement).
- The Ika MessageApproval parser (`integrations/ika.rs`) now autodetects the **real 287-byte Ika layout** (discriminator `14` at offset 0) AND the **49-byte demo layout** (`demo_create_message_approval`). The same `parse_message_approval` works for both, so steps 2–3 of the demo will keep working as we transition to real Ika.
- FHE circuit gated behind `#[cfg(feature = "fhe")]` — build without the pre-alpha crate by default.
- `overflow-checks = true` in release profile (Anchor requirement).
- Platform-tools v1.52 required for `cargo-build-sbf` (manually downloaded to `~/.cache/solana/v1.52/`).
- Build command: `cargo build-sbf` directly (Anchor CLI 1.x optional — `avm install 1.0.0` if you want `anchor build`/`anchor test`).

---

### 2b. TypeScript SDK — `packages/sdk/`

Package: `@lendguard/sdk` v**0.2.0** — fully promoted lending API,
framework-agnostic (only depends on `@solana/web3.js`).

```typescript
import {
  buildBorrowAgainstCollateralIx,
  buildRepayBorrowIx,
  buildLiquidatePositionIx,
  buildUpdateAdminPriceIx,
  readLendingPool,
  readBorrowPosition,
  listAllBorrowPositions,
  currentDebt,
  isLiquidatable,
  formatLgUsd,
  parseLgUsd,
  LGUSD_MINT_DEVNET,
  ASSET_BTC,
} from "@lendguard/sdk";

// Anchor-style ix builders for every lending instruction:
const { ix } = await buildBorrowAgainstCollateralIx({
  owner,
  vaultPda,
  assetType: ASSET_BTC,
  borrowAssetMint: LGUSD_MINT_DEVNET,
  poolTokenVault: pool.poolTokenVault,
  borrowerTokenAccount: ataAddress,
  amount: 25_000_000n, // 25 LGUSD
  healthCiphertext, // optional Encrypt FHE PDA
});

// Account decoders + on-chain readers:
const { pool } = await readLendingPool(connection);
const debt = currentDebt(position.principal, pool.borrowIndex);
```

The legacy `LendGuard` class is also still exported for backward compat with
the original collateral-integrity API (`registerVault`, `verifyCustodyProof`,
etc.).

**Tests:** 23 unit tests in `packages/sdk/test/lending.test.ts` cover Anchor
sighash discriminators, PDA derivation, instruction byte layouts, account
decoder round-trips, and lending math (`currentDebt`, `isLiquidatable`).
Run with `npm test`.

**Status:** Tarball built and validated by `npm publish --dry-run`. To ship:

```bash
cd packages/sdk
npm login   # one-time
npm publish --access public
```

---

### 2c. Frontend — `web/`

Built with Next.js + Tailwind + Solana Wallet Adapter.

| Page/File | Description |
|---|---|
| `web/app/page.tsx` | Landing page |
| `web/app/demo/page.tsx` | **Interactive 6-step demo walkthrough** |
| `web/lib/lendguard-client.ts` | PDA derivation helpers, `DemoVaultState`, Solana connection helpers |
| `web/lib/mock-message-approval.ts` | `buildMockMessageApprovalData()` — builds a fake Ika `MessageApproval` buffer for demo without real Ika network |
| `web/components/landing/` | Navigation, Hero, How-It-Works, Infrastructure sections — all renamed to LendGuard |

**Demo page 6 steps:**
1. Register vault + link dWallet → vault: `PENDING`
2. Verify custody proof → vault: `VERIFIED`
3. Deposit collateral → accepted ✅
4. Simulate bridge exploit → backing ratio drops
5. Trigger Encrypt risk check → `EBool = false`
6. Circuit breaker fires → `frozen = true`, new deposit rejected ❌

**Status:** Pages exist, Wallet Adapter dependencies added. Full interactive wiring to the deployed program still needed (currently uses mock state).

---

### 2d. Scripts & Documentation

| File | Description |
|---|---|
| `scripts/deploy-devnet.sh` | One-command build + deploy + balance diff + on-chain verify |
| `scripts/demo-smoke.sh` | Health check: program on-chain? IDL present? SDK pack OK? |
| `README.md` | Full project README with architecture, setup, SDK snippet, devnet addresses |
| `.env.example` | All environment variable templates with comments |
| `docs/LENDGUARD_IDEA.txt` | Original detailed project idea |
| `docs/LENDGUARD_IDEA_OVERVIEW.md` | Architecture overview |
| `docs/LENDGUARD_DEVELOPMENT_ROADMAP.md` | 11-day phase plan |
| `docs/LENDGUARD_WORKSPLIT_2_DEVS.md` | Dev A / Dev B ownership matrix |

---

## 3. Complete Setup Guide (for a New Machine)

Follow these steps in order. They cover everything from cloning the repo to having the contracts deployed and the frontend running.

---

### Step 0 — Operating System

> **If you are on Windows:** You MUST use **WSL (Windows Subsystem for Linux)**. Solana's build toolchain does not work reliably on native Windows PowerShell. Open WSL for all the steps below.

**Enable WSL if you haven't already (run in PowerShell as Administrator):**

```powershell
wsl --install
# Restart your PC, then open "Ubuntu" from the Start menu
```

Everything from here onwards runs inside the **WSL/Ubuntu terminal** (or a native Linux/Mac terminal).

---

### Step 1 — Clone the Repository

```bash
git clone https://github.com/<your-org>/LendGuard.git
cd LendGuard
```

> Replace `<your-org>` with the actual GitHub username/org. Ask the other developer for the repo URL if unsure.

---

### Step 2 — Install Node.js 18+

```bash
# Check if already installed
node --version   # needs to be v18 or higher

# If not installed, use nvm (recommended)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc          # reload shell
nvm install 18
nvm use 18
node --version            # should print v18.x.x
npm --version             # should print 10.x.x
```

---

### Step 3 — Install Rust

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
# When prompted, choose option 1 (default install)

source ~/.bashrc          # or open a new terminal
rustup --version          # should print rustup 1.x.x
cargo --version           # should print cargo 1.x.x
```

---

### Step 4 — Install Solana CLI

```bash
sh -c "$(curl -sSfL https://release.anza.xyz/v3.1.14/install)"

# Add to PATH (the installer usually does this, but do it manually if not)
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
echo 'export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"' >> ~/.bashrc

solana --version   # should print: solana-cli 3.1.14
```

---

### Step 5 — Install Anchor CLI

> **Do NOT use `avm install`** — it downloads large binaries and consistently times out.  
> Use the npm install instead:

```bash
npm install -g @coral-xyz/anchor-cli@0.31.1

# Fix execute permissions (WSL sometimes strips them)
chmod +x $(npm root -g)/@coral-xyz/anchor-cli/anchor

anchor --version   # should print: anchor-cli 0.31.1
```

---

### Step 6 — Set Up the Wallet

There are two options. **Option A is preferred** (you re-use the existing devnet wallet that already has SOL and is the upgrade authority for the deployed program).

#### Option A — Use the existing devnet wallet (preferred)

Get the `lendguard-devnet.json` file from the other developer (it is NOT in git for security). Then:

```bash
mkdir -p ~/.config/solana
cp /mnt/c/path/to/lendguard-devnet.json ~/.config/solana/lendguard-devnet.json
# Adjust the Windows path above — in WSL, C:\ is /mnt/c/

solana config set \
  --url devnet \
  --keypair ~/.config/solana/lendguard-devnet.json

solana config get        # confirm settings
solana balance           # should show ~17 SOL
```

This wallet is the **upgrade authority** for the deployed program (`GQia1ewyLgtkgX7HSfuttJ42qNPpYJhUbxeyCPXtcJFR`). You need it to redeploy or upgrade the program.

#### Option B — Create a fresh wallet (if you just want to test, not redeploy)

```bash
solana-keygen new --outfile ~/.config/solana/lendguard-devnet.json
# Save the seed phrase somewhere safe!

solana config set --url devnet --keypair ~/.config/solana/lendguard-devnet.json
solana balance           # shows 0 SOL

# Airdrop test SOL (devnet faucet, sometimes flaky — try a few times if it fails)
solana airdrop 2
solana balance           # should show 2 SOL

# Or use the web faucet: https://faucet.solana.com
# Paste your address and request 5 SOL
```

> **Note:** With a fresh wallet you can interact with the already-deployed program, but you CANNOT redeploy or upgrade it. To redeploy you need Option A.

---

### Step 7 — Configure the contracts/ keypair

The program's own keypair (the key that determines the program address) lives at `contracts/target/deploy/lendguard_proof_vault-keypair.json`. This is also NOT in git.

```bash
# Check if it already exists
ls contracts/target/deploy/

# If the file is missing, copy it from another dev, OR generate a new one
# WARNING: generating a new keypair gives a new program ID — you'd need to update Anchor.toml + .env
mkdir -p contracts/target/deploy
solana-keygen new --no-bip39-passphrase \
  --outfile contracts/target/deploy/lendguard_proof_vault-keypair.json

# Print the public key — it should match the program ID in Anchor.toml
solana-keygen pubkey contracts/target/deploy/lendguard_proof_vault-keypair.json
# Expected: GQia1ewyLgtkgX7HSfuttJ42qNPpYJhUbxeyCPXtcJFR
```

If the pubkey does NOT match (because you generated a new keypair), you need to update the program ID everywhere:

```bash
# Update Anchor.toml — change the lendguard_proof_vault address
# Update contracts/src/lib.rs — change declare_id!(...)
# Update packages/sdk/src/client.ts — change DEFAULT_PROGRAM_ID
# Update .env.example and your .env — change LENDGUARD_PROGRAM_ID
```

---

### Step 8 — Install JS dependencies

```bash
# SDK
cd packages/sdk && npm install && cd ../..

# Contracts test runner
cd contracts && yarn install && cd ..

# Frontend
cd web && npm install && cd ..
```

---

### Step 9 — Set up environment variables

```bash
cp .env.example .env
# Edit .env and fill in any blanks
# Most values are already correct for devnet — you mainly need SOLANA_PRIVATE_KEY
# if any script needs it (most scripts use the keypair file directly)
```

---

### Step 10 — Handle platform-tools (first build only)

`cargo-build-sbf` needs ~519 MB of Solana SBF platform-tools. It tries to download them automatically on first build. **If the build hangs or times out**, download manually:

```bash
# Check if already downloaded
ls ~/.cache/solana/v1.52/platform-tools/bin/

# If missing, download manually (use --continue to resume if it drops)
wget --continue \
  -O ~/.cache/solana/v1.52/platform-tools-linux-x86_64.tar.bz2 \
  "https://github.com/anza-xyz/platform-tools/releases/download/v1.52/platform-tools-linux-x86_64.tar.bz2"
# This file is ~519 MB — can take 10–30 min depending on your connection

# After download completes, extract it
mkdir -p ~/.cache/solana/v1.52/platform-tools
tar xjf ~/.cache/solana/v1.52/platform-tools-linux-x86_64.tar.bz2 \
  -C ~/.cache/solana/v1.52/platform-tools --strip-components=1

# Verify
ls ~/.cache/solana/v1.52/platform-tools/bin/   # should show clang, rust, etc.
```

---

### Step 11 — Build the Anchor program

```bash
cd contracts
cargo-build-sbf
```

Expected output (takes 2–5 min first time, faster after):
```
   Compiling lendguard-proof-vault v0.1.0
    Finished release [optimized] target(s) in 3m 22s
```

The compiled `.so` file will be at:
```
contracts/target/deploy/lendguard_proof_vault.so
```

If you see errors, check:
- Cargo.toml `anchor-lang = "0.31.1"` — do not change this version
- You're running from inside the `contracts/` directory
- `overflow-checks = true` is present in `[profile.release]`

---

### Step 12 — Deploy to devnet

```bash
# From repo root
chmod +x scripts/deploy-devnet.sh
bash scripts/deploy-devnet.sh
```

The script will:
1. Print your wallet balance before deploy
2. Run `cargo-build-sbf` inside `contracts/`
3. Deploy the `.so` using `solana program deploy` with the program keypair
4. Print balance after (so you can see how much SOL the deploy cost — typically ~3–6 SOL for a fresh deploy, ~0.001 SOL for an upgrade)
5. Run `solana program show` to confirm it's live

**Expected final output:**
```
Program Id: GQia1ewyLgtkgX7HSfuttJ42qNPpYJhUbxeyCPXtcJFR
Owner: BPFLoaderUpgradeab1e11111111111111111111111
Data Account: 4Mby1BYNvu9MizaPYCynihb7FM2vg48oEqzEBVDYUBin
Authority: AQHbkBSS6oMMEFL7wgDnBnwYBSVRBLk81pQ2iP86yUrc
```

---

### Step 13 — Initialize the protocol on-chain (one-time, already done for the live deploy)

> **Already done for the May 9 2026 fresh deploy.** `protocol_state` PDA `5xou7zabzaSxyUxzJpXHHghS8chXWXRGDWExfp52gfzb` is bootstrapped, plus the BTC `lending_pool`/`admin_price_feed` defaults. If you redeploy under a *new* program ID you must rerun the bootstrap script: `node contracts/scripts/bootstrap-devnet.mjs` (uses `contracts/lendguard-devnet.json` as the admin keypair). It is idempotent — skips PDAs that already exist.

The fastest way is a small script in the `contracts/` directory:

```bash
cd contracts
yarn ts-node -e "
const anchor = require('@coral-xyz/anchor');
const fs = require('fs');

const wallet = new anchor.Wallet(
  anchor.web3.Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(process.env.HOME + '/.config/solana/lendguard-devnet.json')))
  )
);
const connection = new anchor.web3.Connection('https://api.devnet.solana.com', 'confirmed');
const provider = new anchor.AnchorProvider(connection, wallet, {});
anchor.setProvider(provider);

// Load IDL from built artifact
const idl = JSON.parse(fs.readFileSync('./target/idl/lendguard_proof_vault.json'));
const programId = new anchor.web3.PublicKey('GQia1ewyLgtkgX7HSfuttJ42qNPpYJhUbxeyCPXtcJFR');
const program = new anchor.Program(idl, provider);

(async () => {
  const [protocolStatePda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from('protocol_state')],
    programId
  );
  const tx = await program.methods.initializeProtocol()
    .accounts({ protocolState: protocolStatePda, admin: wallet.publicKey, systemProgram: anchor.web3.SystemProgram.programId })
    .rpc();
  console.log('Protocol initialized! tx:', tx);
  console.log('Protocol state PDA:', protocolStatePda.toBase58());
})();
"
```

You only need to do this once per program deployment. If you redeploy without wiping the PDA, you do not need to call this again.

---

### Step 14 — Verify smoke test

```bash
bash scripts/demo-smoke.sh
```

All three checks should pass:
- ✅ Program account exists on devnet
- ✅ IDL artifact present at `contracts/target/idl/`
- ✅ SDK `npm pack --dry-run` succeeds

---

### Step 15 — Run frontend

```bash
cd web
npm run dev
# Open http://localhost:3000/demo
```

You should see the 6-step demo page. Connect a Phantom/Backpack wallet set to **devnet** and walk through the steps.

---

## 4. What Is Left To Do

### PRIORITY 1 — Must Have for Hackathon Submission

| Task | Where | Notes |
|---|---|---|
| **Wire demo page to real on-chain calls** | `web/app/demo/page.tsx` | Connect all 6 steps to the deployed program using `@lendguard/sdk` + Wallet Adapter |
| **Write integration tests (happy path + attack path)** | `contracts/tests/integration_tests.ts` | Two scenarios: (1) valid proof → deposit accepted, (2) no proof → deposit rejected. Run with `anchor test` |
| **Publish `@lendguard/sdk` to npm** | `packages/sdk/` | `cd packages/sdk && npm run build && npm publish --access public`. Need an npm account. |
| **Export and commit IDL** | `contracts/target/idl/` | After `cargo-build-sbf`, the IDL lives at `contracts/target/idl/lendguard_proof_vault.json`. Copy it to `artifacts/idl/` and commit so judges can use it without building. |
| **Record demo video** | — | 3-5 min screencast walking through all 6 demo steps on devnet. Required for submission. |
| **Fill in README submission section** | `README.md` | Add video link, confirm all devnet addresses are correct, add build/test badge. |

---

### PRIORITY 2 — High Impact, Differentiates Submission

| Task | Where | Notes |
|---|---|---|
| **Wire real Ika `approve_message` in the browser** | ✅ **Shipped** — `contracts/src/instructions/approve_custody_signature.rs`, `web/lib/ika-pda.ts`, `web/lib/ika-flow.ts`, "Real Ika" panel on `web/app/demo/page.tsx` | LendGuard now has its own `approve_custody_signature` instruction that CPIs into Ika `approve_message` via `ika_dwallet_anchor::DWalletContext::approve_message` using `invoke_signed`. Off-chain helper `runRealIkaFlow` orchestrates DKG → derive PDAs → submit tx → request sign. Deployed in upgrade tx `46EMxkn78R5RLZZhgNQtNjnb8taiaGqGNpLkQYVwc5srJZWyo2JJR5dYao373AV76pg2G3p39kcmMkiim2mGGVJp`. **Remaining work:** swap step 2 of the main 6-step demo to use `runRealIkaFlow` instead of `buildDemoCreateMessageApprovalIx`. This also requires step 1 to register the vault with the real dWallet pubkey (so `vault.dwallet_id == messageApproval.dwallet`). |
| **Real Encrypt `execute_graph` end-to-end** | `contracts/src/instructions/evaluate_risk_graph.rs` (TBD) + `web/app/demo/page.tsx` step 5 | The on-chain reader is already autodetecting (`integrations/encrypt.rs::parse_ebool` accepts both real 100-byte EBool ciphertexts and the demo `byte[0]` format). Three pieces remain: **(1) compile the `check_backing_ratio` FHE graph bytes** — easiest path is a host-side `tools/compile-graph/` Cargo crate that depends on `encrypt-dsl` and dumps the bytes from `check_backing_ratio()` into a `.bin` file (the macro generates this function for you). **(2) Add `evaluate_risk_graph` LendGuard instruction** that wraps `EncryptContext::execute_graph(ix_data, [backing_ct, threshold_ct, result_ct])` (see `chains/solana/program-sdk/anchor/src/lib.rs` and the coin-flip example in `chains/solana/examples/coin-flip/anchor/src/lib.rs` — the same shape we used for Ika `approve_custody_signature`). **(3) Wire into demo step 5** — replace `buildDemoCreateCiphertextIx` for the EBool with the CPI call, then poll `result_ct.status` until it hits `1`. The Encrypt executor writes the result back asynchronously, so polling matches how the executor exposes its work. Pre-alpha caveat: the Encrypt devnet executor may not respond yet (mirrors the Ika gRPC `requestDKG → no on-chain dWallet` situation we hit). |
| **Compile and ship the `check_backing_ratio` graph bytes** | `contracts/src/fhe/` + `packages/sdk/` | Enable the `fhe` feature, run `cargo build` to generate the graph DAG via `#[encrypt_fn]`, dump the bytes, and embed them in the SDK so the frontend can pass them to `execute_graph`. |
| **Demo seed script** | `scripts/seed-demo-state.sh` | Optional: wraps `initialize_protocol` (already callable from the demo on first run) so a fresh contributor can prep state without opening the UI. |

---

### PRIORITY 3 — Nice to Have

| Task | Where | Notes |
|---|---|---|
| **CPI crate scaffold** | `crates/lendguard-cpi/` | Publish a `lendguard-cpi` Rust crate so other Anchor programs can call LendGuard directly. Not strictly needed but impresses judges. |
| **Fix remaining compiler warnings** | `contracts/src/lib.rs` | The `ambiguous glob re-exports` warnings can be fixed by removing `pub use lendguard_proof_vault::*;` from the bottom of `lib.rs`. |
| **Add `no-entrypoint`/`cpi`/`no-idl` feature flags to `Cargo.toml`** | `contracts/Cargo.toml` | These suppress the `unexpected cfg` warnings from Anchor macros. |
| **Airdrop handler in tests** | `contracts/tests/integration_tests.ts` | The airdrop call is wrapped in try-catch — add retry logic with exponential backoff for more reliable CI. |

---

## 5. Critical State You Must Know

### The devnet wallet

- **Address:** `DwpDbPrB5TzZAEwcB1WjUdfcTjH39uhhY8Wk8W4KfN38` (authority / upgrade authority)
- **Balance:** ~17.64 SOL (as of last deploy)
- **Key file:** `contracts/lendguard-devnet.json` — **NOT in git**. Get from the other developer over a secure channel.

### Protocol state is NOT initialized yet

The program is deployed but `initialize_protocol` has never been called. Before any vault can be created or deposit attempted, you must call this once:

```typescript
const lg = new LendGuard({ connection, wallet, program });
await lg.initializeProtocol();
// This creates the ProtocolStateAccount PDA
// Seeds: ["protocol_state"]
// Admin = wallet pubkey
```

### PDA derivation

If you need to derive PDAs manually:

```typescript
// Protocol State
const [protocolStatePda] = PublicKey.findProgramAddressSync(
  [Buffer.from("protocol_state")],
  new PublicKey("GQia1ewyLgtkgX7HSfuttJ42qNPpYJhUbxeyCPXtcJFR")
);

// Vault
const [vaultPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("vault"), ownerPubkey.toBuffer(), Buffer.from(dwalletIdBytes)],
  new PublicKey("GQia1ewyLgtkgX7HSfuttJ42qNPpYJhUbxeyCPXtcJFR")
);

// Risk State
const [riskStatePda] = PublicKey.findProgramAddressSync(
  [Buffer.from("risk_state"), vaultPda.toBuffer()],
  new PublicKey("GQia1ewyLgtkgX7HSfuttJ42qNPpYJhUbxeyCPXtcJFR")
);
```

---

## 6. Useful Commands Reference

```bash
# Rebuild and redeploy
bash scripts/deploy-devnet.sh

# Smoke check (program on devnet + SDK health)
bash scripts/demo-smoke.sh

# Build only (no deploy)
cd contracts && cargo-build-sbf

# Deploy only (already built)
solana program deploy \
  --program-id contracts/target/deploy/lendguard_proof_vault-keypair.json \
  --url devnet \
  --keypair ~/.config/solana/lendguard-devnet.json \
  contracts/target/deploy/lendguard_proof_vault.so

# Check wallet balance
solana balance --url devnet --keypair ~/.config/solana/lendguard-devnet.json

# Check program on-chain
solana program show GQia1ewyLgtkgX7HSfuttJ42qNPpYJhUbxeyCPXtcJFR --url devnet

# Run integration tests
cd contracts && anchor test

# Build SDK
cd packages/sdk && npm run build

# Publish SDK (when ready)
cd packages/sdk && npm run build && npm publish --access public

# Start frontend
cd web && npm install && npm run dev
```

---

## 7. Key External Docs

| Resource | URL |
|---|---|
| Ika pre-alpha docs | https://solana-pre-alpha.ika.xyz/ |
| Ika GitHub | https://github.com/dwallet-labs/ika-pre-alpha |
| Encrypt FHE docs | https://docs.encrypt.xyz/ |
| Encrypt GitHub | https://github.com/dwallet-labs/encrypt-pre-alpha |
| Anchor docs | https://www.anchor-lang.com/ |
| Solana devnet faucet | https://faucet.solana.com |
| Solana Explorer (devnet) | https://explorer.solana.com/?cluster=devnet |

---

## 8. Repository Structure Quick Reference

```
LendGuard/
├── contracts/                    Anchor program (Rust)
│   ├── Anchor.toml               Workspace config + program ID + devnet provider
│   ├── Cargo.toml                anchor-lang 0.31.1, thiserror, optional encrypt-dsl
│   ├── src/
│   │   ├── lib.rs                Program entrypoint + declare_id
│   │   ├── instructions/         11 instruction handlers
│   │   ├── state/                3 PDA account structs
│   │   ├── integrations/         Ika + Encrypt raw adapters
│   │   ├── fhe/                  check_backing_ratio #[encrypt_fn] DSL (feature-gated)
│   │   ├── events.rs             Anchor event structs
│   │   ├── errors.rs             19 custom error codes
│   │   └── constants.rs          PDA seeds, asset types, proof status codes
│   └── tests/
│       └── integration_tests.ts  Anchor TypeScript integration tests (scaffold)
├── packages/
│   └── sdk/                      @lendguard/sdk (TypeScript)
│       └── src/
│           ├── client.ts         LendGuard class — 9 methods, real + mock modes
│           ├── types.ts          All TypeScript param/result interfaces
│           └── index.ts          Barrel export
├── web/                          Next.js frontend
│   ├── app/demo/page.tsx         6-step interactive demo page
│   ├── app/page.tsx              Landing page
│   ├── lib/lendguard-client.ts   PDA derivation + DemoVaultState helpers
│   └── lib/mock-message-approval.ts  Mock Ika MessageApproval for demo
├── scripts/
│   ├── deploy-devnet.sh          One-command build + deploy + balance report
│   └── demo-smoke.sh             Health check for demo readiness
├── docs/                         Architecture + roadmap + work split docs
├── .env.example                  All env vars with descriptions
└── README.md                     Main README for judges
```

---

## 9. What Real vs Mocked Means

Understanding this is essential for the demo and for judge questions:

| Feature | Status | Details |
|---|---|---|
| Anchor program guardrails | ✅ **Real** | Deployed and enforcing all rules on devnet |
| Encrypt input ciphertexts (step 4) | ✅ **Real network call** | `web/lib/encrypt-client.ts` uses `@encrypt.xyz/pre-alpha-solana-client/grpc-web` to call the live executor at `pre-alpha-dev-1.encrypt.ika-network.net:443`. Backing & threshold ciphertext PDAs are real accounts owned by the Encrypt program (`4ebfzWdKnrnGseuQpezXdG8yCdHqwQ1SSBHD3bWArND8`) — visible on Solana Explorer. |
| Encrypt `execute_graph` (step 5) | 🔶 **Demo helper for the result, but reader is real** | Inputs are real Encrypt ciphertexts (above). The EBool result is still written by `demo_create_ciphertext`, but the on-chain reader (`integrations/encrypt.rs::parse_ebool`) **autodetects both layouts** — a 100-byte buffer with `fhe_type=EBool (1)` at offset 98 and `status=Verified (1)` at offset 99 triggers the real Encrypt code path; anything else falls back to the demo `byte[0]`. Mirror of what `parse_message_approval` does for Ika. The remaining gap is connecting the two on-chain: a `LendGuard.evaluate_risk_graph` instruction that CPIs into `EncryptContext::execute_graph`. The Encrypt executor watches for these txs and writes back to the result_ct asynchronously. See PRIORITY 2 for the plan. |
| `#[encrypt_fn]` DSL circuit | ✅ **Real syntax** | `contracts/src/fhe/check_backing_ratio.rs` compiles under the `fhe` feature flag. Same code runs on mainnet — zero changes needed. |
| Ika `MessageApproval` (step 2 of the 6-step flow) | 🔶 **LendGuard demo helper for the main demo, but real Ika is now wired separately** | The main 6-step demo still calls `buildDemoCreateMessageApprovalIx` (49-byte stand-in) so it works without depending on Ika devnet uptime. **Real Ika is fully wired** in `web/lib/ika-flow.ts` and exposed via the "Real Ika dWallet experiment" panel under the steps — it does live DKG → derive PDAs → submit `approve_custody_signature` (LendGuard CPI → Ika `approve_message`) → `requestSign`. Result: a real 287-byte `MessageApproval` PDA owned by the Ika program. Our parser autodetects both layouts (discriminator `14` = real Ika, otherwise demo). |
| Anchor framework version | ✅ **1.x** | Migrated May 7, 2026 (program upgrade tx `2uWb15EGEmBFuSsb17pSFz7ymYqGZDM1NYJJCFKqgRKJpNH6ZBcqdQJjF8fcfSo8jouibfDjan3eDPkV3N9Dbfni`). Same program ID. Both `ika-dwallet-anchor` and `encrypt-anchor` are now linked into the program — real CPI is unblocked. |
| Distributed MPC (Ika) | 🔶 **Mock on pre-alpha** | Even in production-Ika today, signing uses a single mock signer per the dWallet docs disclaimer. |
| Real FHE privacy (Encrypt) | 🔶 **Mock on pre-alpha** | Pre-alpha is plaintext on-chain (per Encrypt docs). Real FHE lands at mainnet. |
| Native BTC/ETH custody | 🔶 **Proxied** | devnet SOL used as proxy for cross-chain assets |

### Where the real integration lives

- `contracts/Cargo.toml` — pulls in `anchor-lang = "1"`, `ika-dwallet-anchor`, `ika-system-types`, `encrypt-anchor`, `encrypt-types` directly from the dwallet-labs git repos. The build target is `edition = "2024"`.
- `contracts/src/integrations/ika.rs` — `parse_message_approval` autodetects both the real 287-byte Ika layout (discriminator `14`, status byte at offset 139) and the legacy 49-byte demo layout. Returns a `ParsedMessageApproval { source: ApprovalSource }` so callers can tell which path was taken.
- `web/lib/encrypt-client.ts` — gRPC-Web wrapper around `createInput`. Reads endpoint from `NEXT_PUBLIC_ENCRYPT_GRPC_URL` (default: pre-alpha endpoint).
- `web/lib/ika-client.ts` — gRPC-Web wrapper around the Ika dWallet executor (`requestDkg` / `requestPresign` / `requestSign`). Reads endpoint from `NEXT_PUBLIC_IKA_GRPC_URL`.
- `web/lib/ika-pda.ts` — Ika program PDA derivations (`deriveIkaCpiAuthorityPda`, `deriveDwalletCoordinatorPda`, `deriveDwalletPda`, `deriveMessageApprovalPda`). Mirrors the seeds used by the dWallet program (sources cited inline).
- `web/lib/ika-flow.ts` — High-level orchestrator `runRealIkaFlow`: DKG → derive → submit LendGuard `approve_custody_signature` → `requestSign`. Used by the "Real Ika" panel on the demo page.
- `contracts/src/instructions/approve_custody_signature.rs` — LendGuard instruction that CPIs into Ika `approve_message` via `invoke_signed` (uses `ika_dwallet_anchor::DWalletContext::approve_message`). The CPI authority PDA is `[b"__ika_cpi_authority"]` derived from the LendGuard program ID.
- `web/scripts/patch-ika-sdk.sh` — Postinstall hook (in `package.json`) that strips `.js` extensions from the published Ika SDK imports so Turbopack can resolve them. Required because the SDK ships `.ts` source with ESM `.js` import paths.
- `web/app/demo/page.tsx` step 4 — calls `createEncryptInputs([{value: 95}, {value: 85}])` before submitting our `initialize_risk_state` + `update_backing_state` instructions in a single tx.
- `next.config.mjs` — `transpilePackages` lets Next.js compile both Encrypt and Ika SDK `.ts` sources (which ship in their `exports` field).

### Optional env vars (web/.env.local)

```
NEXT_PUBLIC_LENDGUARD_PROGRAM=GQia1ewyLgtkgX7HSfuttJ42qNPpYJhUbxeyCPXtcJFR
NEXT_PUBLIC_SOLANA_RPC_URL=https://api.devnet.solana.com
NEXT_PUBLIC_ENCRYPT_GRPC_URL=https://pre-alpha-dev-1.encrypt.ika-network.net:443
NEXT_PUBLIC_ENCRYPT_PROGRAM=4ebfzWdKnrnGseuQpezXdG8yCdHqwQ1SSBHD3bWArND8
NEXT_PUBLIC_IKA_GRPC_URL=https://pre-alpha-dev-1.ika.ika-network.net:443
NEXT_PUBLIC_IKA_PROGRAM=87W54kGYFQ1rgWqMeu4XTPHWXWmXSQCcjm8vCTfiq1oY
```

---

*Last updated: May 7, 2026 (Real Ika CPI shipped). Program upgrade tx `46EMxkn78R5RLZZhgNQtNjnb8taiaGqGNpLkQYVwc5srJZWyo2JJR5dYao373AV76pg2G3p39kcmMkiim2mGGVJp`. New `approve_custody_signature` instruction performs `invoke_signed` CPI into Ika `approve_message`; off-chain orchestrator `web/lib/ika-flow.ts` runs DKG → derive PDAs → approve → sign. Live test panel on the demo page under the 6 steps. Anchor 1.x stays in place. Real Ika MessageApproval parser in `integrations/ika.rs` autodetects demo (49 bytes) vs real (287 bytes) layouts. Encrypt input ciphertexts already real via `@encrypt.xyz/pre-alpha-solana-client@0.1.1`.*
