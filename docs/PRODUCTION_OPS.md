# LendGuard — Production Ops Runbook

Live program: `GQia1ewyLgtkgX7HSfuttJ42qNPpYJhUbxeyCPXtcJFR` (devnet).

This document covers the operational tasks an admin will run to keep
LendGuard production-ready.

---

## 1. Bootstrap a fresh deploy

When the program is freshly deployed (or rotates to a new program ID), run
the idempotent bootstrap script:

```bash
LENDGUARD_AUTHORITY_KEYPAIR=/path/to/admin.json \
  node contracts/scripts/bootstrap-devnet.mjs
```

This will:

1. Initialize `protocol_state` if missing.
2. Create the LGUSD SPL mint (or reuse the cached one in `contracts/lgusd-mint.json`).
3. Create the pool's PDA-owned token vault and mint the initial supply
   (1,000 LGUSD by default).
4. Transfer LGUSD mint authority to the `lending_pool` PDA.
5. Initialize the `lending_pool` with hackathon defaults (BTC, $90k start
   price, 65 % LTV, 75 % liquidation threshold, 5 % liquidation bonus, 2 %
   base APR + 15 % slope).
6. Initialize the BTC, ETH, and SOL admin price feeds.

The script is **fully idempotent** — every step skips if its target account
already exists.

## 2. Update prices

The program enforces `PRICE_STALENESS_SECONDS = 1 hour` on every borrow and
liquidation. If the last `update_admin_price` is older than that, borrows
fail with `PriceFeedStale (0x178a / 6026)`.

Three ways to refresh:

**a) Keeper script (recommended for demos / scheduled cron).**

```bash
LENDGUARD_AUTHORITY_KEYPAIR=/path/to/admin.json \
  node contracts/scripts/refresh-prices.mjs

# override defaults via env vars:
BTC_USD=92000 ETH_USD=3600 SOL_USD=160 \
  node contracts/scripts/refresh-prices.mjs
```

Refreshes BTC, ETH and SOL feeds in a single transaction. Run every
15–30 min from a cron / CI scheduled job.

**b) `/lend` page (manual demo).** The "Protocol Controls" panel's "BTC
$90k" / "Crash to $50k" buttons each issue an `update_admin_price` ix.

**c) Programmatic.**

```ts
import { buildUpdateAdminPriceIx, ASSET_BTC } from "@lendguard/sdk";
const { ix } = await buildUpdateAdminPriceIx({
  admin: admin.publicKey,
  assetType: ASSET_BTC,
  newPriceUsd: 90_000_00000000n, // 8 decimals
});
```

Production replaces this with a Pyth Pull oracle account; the
`AdminPriceFeed` exists for hackathon-grade demos only.

## 2a. Repaying a borrow (full vs. partial)

`repay_borrow(amount)` accepts any value:

- `amount < outstanding` → partial repay, position stays open.
- `amount >= outstanding` → the program silently caps the SPL transfer to
  the exact outstanding debt **and closes the `BorrowPosition` account**,
  refunding rent to the borrower. Pass `u64::MAX` (i.e. `2^64 - 1`) for
  this behaviour from any client.

The `/lend` page exposes both as separate buttons (`Repay` and `Repay All`).
Closing the position is what frees the deterministic `BorrowPosition` PDA
so a subsequent borrow on the same vault can re-`init` it.

## 3. Pause the protocol

If something goes wrong, the admin can freeze the protocol:

```ts
import { buildCircuitBreakerFreezeIx } from "@lendguard/sdk"; // not yet shipped
// — for now, use the /demo page's "Freeze" button or send a circuit_breaker_freeze ix manually.
```

This blocks `borrow_against_collateral` and `liquidate_position`. Repays
remain open so users can always pay debt down. Unfreeze with
`unfreeze_protocol_state`.

## 4. Transfer upgrade authority to a multisig

Use the wrapper script:

```bash
# Inspect first
LENDGUARD_AUTHORITY_KEYPAIR=/path/to/admin.json \
LENDGUARD_NEW_AUTHORITY=<multisig pubkey> \
LENDGUARD_DRY_RUN=1 \
  node contracts/scripts/transfer-upgrade-authority.mjs

# Once you've verified the new authority pubkey, run for real
LENDGUARD_AUTHORITY_KEYPAIR=/path/to/admin.json \
LENDGUARD_NEW_AUTHORITY=<multisig pubkey> \
  node contracts/scripts/transfer-upgrade-authority.mjs
```

The script:

1. Resolves the program's `ProgramData` PDA.
2. Reads the on-chain authority and verifies the keypair matches.
3. Builds and submits a BPF Loader Upgradeable `SetAuthority` (variant 4) ix.
4. Prints the tx signature.

After this, no single keypair can upgrade the program. Future upgrades
require a multisig signature.

To irreversibly **revoke** upgrade authority entirely, set
`LENDGUARD_NEW_AUTHORITY` to the all-zero pubkey (`11111111111111111111111111111111`)
or use `solana program set-upgrade-authority --final`.

## 5. Verify a deployed binary matches the source

```bash
cd contracts
cargo build-sbf --features no-idl
sha256sum target/deploy/lendguard_proof_vault.so
solana program dump GQia1ewyLgtkgX7HSfuttJ42qNPpYJhUbxeyCPXtcJFR /tmp/onchain.so --url devnet
sha256sum /tmp/onchain.so
```

The two hashes should match. (Anchor's `idl-build` mode mutates the binary,
so build with `--features no-idl` for byte-equivalence against `solana program dump`.)

## 6. Backups

Critical artefacts to keep off-machine:

- `contracts/lendguard-devnet.json` — current upgrade authority secret.
- `contracts/lgusd-mint.json` — LGUSD mint pubkey (the secret key was burned
  after `setAuthority` so this file just records the address).
- `contracts/target/deploy/lendguard_proof_vault-keypair.json` — program
  keypair (allows redeployment from clean state).

All three are in `.gitignore`. Loss of the upgrade authority means the
program is frozen (no upgrades possible); loss of the program keypair just
means a fresh program ID is required.
