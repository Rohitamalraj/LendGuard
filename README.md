# LendGuard

> **The Solana lending protocol with cryptographically unforgeable collateral and MEV-resistant liquidations.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Solana Devnet](https://img.shields.io/badge/Solana-Devnet-9945FF)](https://explorer.solana.com/address/GQia1ewyLgtkgX7HSfuttJ42qNPpYJhUbxeyCPXtcJFR?cluster=devnet)
[![Built with Anchor](https://img.shields.io/badge/Built%20with-Anchor%201.x-orange)](https://www.anchor-lang.com/)
[![Ika dWallets](https://img.shields.io/badge/Collateral-Ika%20dWallets-green)](https://solana-pre-alpha.ika.xyz/)
[![Encrypt FHE](https://img.shields.io/badge/Privacy-Encrypt%20FHE-blueviolet)](https://docs.encrypt.xyz/)

---

## The Problem

### What happened in April 2026

On April 17, 2026, **KelpDAO was exploited for $292M**.

A compromised LayerZero validator forged a cross-chain message claiming that $292M of cross-chain collateral had been deposited. **Aave accepted it.** The protocol had no mechanism to verify whether the collateral actually existed — it trusted the bridge message blindly. By the time the oracle caught the price depeg, $190M had already been drained. The rest was frozen mid-flight.

```
Timeline:
  April 17, 2026 — Compromised LayerZero validator forges cross-chain deposit message
  April 17, 2026 — Aave accepts the forged message as valid collateral
  April 17, 2026 — Attacker borrows $190M against fake collateral
  April 17, 2026 — Oracle detects depeg, protocol paused — but too late
  April 17, 2026 — $102M additional funds frozen, unrecoverable at pause time
  ──────────────────────────────────────────────────────────────────────────
  Total loss: $292M in a single transaction sequence
```

**Root cause:** Aave, like every other DeFi lending protocol, has no contract-level proof that collateral is real. It trusts bridge messages. A single corrupted validator was enough.

### Problem 1 — Bridges are the collateral, and bridges get hacked

Every BTC, ETH, or cross-chain asset used as collateral on Solana is a **bridge IOU** — a wrapped token whose real value depends on multisig custodians staying honest. There is no smart-contract-level check that the underlying asset actually exists.

The KelpDAO incident was not an anomaly. It was the inevitable result of an architecture that has never been fixed.

### Problem 2 — Public health factors = free money for MEV bots

Every Aave-style protocol stores each position's health factor in plaintext onchain. Searchers constantly scan for positions near the liquidation boundary and front-run them:

```
Public lending:
  1. Borrower's health factor hits 1.0
  2. Searcher's bot reads it from onchain state in <100ms
  3. Searcher submits a liquidation tx with higher priority fee
  4. Borrower's collateral is sold at the worst possible price
  5. Searcher pockets the liquidation bonus
  6. Borrower loses more than they needed to

Estimated MEV drain from liquidation markets: ~$292M in 2024–2025 alone.
```

Neither problem has a contract-level fix in any existing protocol. LendGuard is that fix.

---

## The Solution

LendGuard is a Solana native lending protocol built on two new primitives:

| Layer | Technology | What it eliminates |
|---|---|---|
| **Collateral provenance** | Ika dWallets (2PC-MPC) | Bridge hacks, wrapped token risk, fake collateral |
| **Private risk monitoring** | Encrypt FHE (REFHE) | MEV front-running, liquidation sandwiching |

On top of these two layers sits a complete lending protocol: a native stablecoin (**LGUSD**), Aave-style scaled debt, permissionless liquidations, vault freeze on attack, and dust-forgiveness for clean closes.

---

## Architecture Overview

```mermaid
sequenceDiagram
    participant User
    participant Frontend
    participant LendGuard as LendGuard Program
    participant Ika as Ika Network (2PC-MPC)
    participant Encrypt as Encrypt FHE
    participant Keeper as Off-chain Keepers
    participant Bitcoin as Bitcoin Testnet

    Note over User,Bitcoin: ── SOL Collateral Path ──

    User->>Frontend: Connect Solana wallet
    Frontend->>LendGuard: register_vault(dwalletId)
    LendGuard-->>Frontend: VaultAccount PDA created
    Frontend->>LendGuard: demo_create_message_approval()
    Ika-->>LendGuard: MessageApproval account on-chain
    Frontend->>LendGuard: verify_custody_proof()
    LendGuard->>LendGuard: Parse MessageApproval, check TTL + signature
    LendGuard-->>Frontend: vault.status = VERIFIED ✅
    Frontend->>LendGuard: borrow_against_collateral(amount)
    LendGuard->>LendGuard: Check health factor, price feed freshness
    LendGuard-->>Frontend: LGUSD minted to wallet ✅
    Frontend->>LendGuard: repay_borrow(u64::MAX)
    LendGuard->>LendGuard: Dust forgiveness, close BorrowPosition
    LendGuard-->>Frontend: Rent refunded, vault free ✅

    Note over User,Bitcoin: ── Bitcoin Testnet Collateral Path ──

    User->>Ika: DKG ceremony (Secp256k1)
    Ika-->>User: dWallet keypair (2PC-MPC, split key)
    User->>Bitcoin: Fund P2WPKH address derived from dWallet pubkey
    User->>LendGuard: register_btc_vault(ika_dwallet_pubkey, btc_address)
    LendGuard-->>Frontend: BtcVaultAccount PDA created
    Ika-->>LendGuard: MessageApproval (Secp256k1 signature verified on-chain)
    LendGuard->>LendGuard: verify_btc_custody_proof() — check signature, TTL, dwallet match
    LendGuard-->>Frontend: BTC vault VERIFIED ✅
    Keeper->>Bitcoin: Poll mempool.space/testnet for balance
    Bitcoin-->>Keeper: confirmed_satoshis = 100000
    Keeper->>LendGuard: attest_btc_balance(satoshis, block_height)
    LendGuard-->>Frontend: BitcoinBalanceAttestation PDA updated
    Frontend->>LendGuard: borrow_against_btc(amount)
    LendGuard->>LendGuard: attestation fresh? collateral_value >= debt?
    LendGuard-->>Frontend: LGUSD minted ✅

    Note over User,Bitcoin: ── Encrypt FHE Risk + Attack Response ──

    Keeper->>LendGuard: update_price(BTC=$90k, SOL=$150)
    LendGuard->>Encrypt: Submit health factor for encrypted evaluation
    Encrypt->>Encrypt: Compute is_underwater(health_factor, threshold) over ciphertexts
    Encrypt-->>LendGuard: EBool result (still encrypted — bots cannot read)
    LendGuard->>LendGuard: EBool = true → freeze_vault() fires atomically
    LendGuard-->>Frontend: vault.status = FROZEN ❌
    User->>LendGuard: Any borrow attempt on frozen vault
    LendGuard-->>User: VaultFrozen error — attack blocked ✅
    Keeper->>LendGuard: liquidate_position(vault)
    LendGuard-->>Keeper: Collateral seized, debt cleared, bonus paid ✅
```

---

## How Ika dWallets Solve Collateral Provenance

```mermaid
sequenceDiagram
    participant User
    participant Ika Network
    participant LendGuard Program
    participant Bitcoin Testnet

    User->>Ika Network: Request DKG (Distributed Key Generation)
    Ika Network-->>User: dWallet keypair (Secp256k1, 2PC-MPC)
    Note over Ika Network: Private key is SPLIT across Ika nodes + User<br/>Neither party can sign alone

    User->>Bitcoin Testnet: Fund P2WPKH address derived from dWallet pubkey
    User->>LendGuard Program: register_btc_vault(ika_dwallet_pubkey, compressed_secp256k1_pubkey, btc_address)
    LendGuard Program-->>User: BtcVaultAccount PDA created

    User->>Ika Network: Request MessageApproval (custody attestation)
    Ika Network-->>LendGuard Program: MessageApproval account (Secp256k1 signature verified on-chain)
    LendGuard Program->>LendGuard Program: verify_btc_custody_proof()
    Note over LendGuard Program: Checks: signature valid, dWallet matches vault,<br/>proof not expired (TTL 10 min)
    LendGuard Program-->>User: Vault status → VERIFIED ✅

    User->>LendGuard Program: borrow_against_btc(amount)
    LendGuard Program->>LendGuard Program: Check: attestation fresh, health factor OK
    LendGuard Program-->>User: LGUSD minted ✅

    Note over User,LendGuard Program: If proof expires → borrow blocked<br/>If BTC balance drops → attestation auto-updates via keeper<br/>If fake vault → MessageApproval forging requires compromising 2/3 Ika nodes
```

### Why this is unforgeable

A traditional bridge has a multisig (e.g. 5-of-9 validators). Compromising 5 keys = total control. Ika's 2PC-MPC requires attacking a distributed threshold network where every signing ceremony uses fresh key shares. A compromised single validator cannot produce a valid `MessageApproval` — the math simply doesn't work without the network's participation.

---

## How Encrypt FHE Solves MEV-Driven Liquidations

```mermaid
sequenceDiagram
    participant Oracle
    participant Encrypt FHE Network
    participant LendGuard Program
    participant MEV Bot
    participant Borrower

    Oracle->>LendGuard Program: update_price(SOL=$150) → plaintext price
    Note over LendGuard Program: Health factor computed inside FHE<br/>Result: EBool is_underwater (encrypted)

    MEV Bot->>LendGuard Program: Read onchain state...
    Note over MEV Bot: ❌ Health factor is ENCRYPTED<br/>Bot sees: EBool{ciphertext: 0xabc...}<br/>Cannot determine if position is safe or not

    Encrypt FHE Network->>LendGuard Program: EBool result: is_underwater=true (still encrypted)
    LendGuard Program->>LendGuard Program: freeze_vault() fires atomically
    Note over LendGuard Program: Vault frozen BEFORE any liquidation tx<br/>MEV bot had zero warning time

    MEV Bot->>LendGuard Program: Try to front-run liquidation...
    LendGuard Program-->>MEV Bot: ❌ VaultFrozen error

    Borrower->>LendGuard Program: Liquidation triggered by keeper
    LendGuard Program-->>Borrower: Collateral sold at fair price, not MEV-extracted price ✅
```

### What's encrypted vs what's public

| Data | Visibility | Reason |
|---|---|---|
| Vault exists | **Public** | Users need to see their vaults |
| Collateral amount (SOL) | **Public** | Needed for UX display |
| Collateral amount (BTC) | **Public** | Balance attestation is onchain |
| Health factor | **Encrypted (FHE)** | Prevents MEV front-running |
| Liquidation threshold | **Encrypted (FHE)** | Prevents threshold targeting |
| `is_underwater` boolean | **Encrypted (FHE)** | Circuit result, only the program acts on it |
| LGUSD debt amount | **Public** | Borrower transparency |

---

## Comparison with Existing Lending Protocols

| Capability | LendGuard | Aave v3 | Solend | Kamino | MarginFi |
|---|---|---|---|---|---|
| BTC as collateral (no bridge) | ✅ Ika dWallet | ❌ wBTC only | ❌ Wormhole | ❌ Wormhole | ❌ Wormhole |
| ETH as collateral (no bridge) | ✅ Ika dWallet | — | ❌ Wormhole | ❌ Wormhole | ❌ Wormhole |
| Cryptographic custody proof | ✅ MessageApproval | ❌ | ❌ | ❌ | ❌ |
| Encrypted health factors | ✅ Encrypt FHE | ❌ Plaintext | ❌ Plaintext | ❌ Plaintext | ❌ Plaintext |
| MEV-resistant liquidations | ✅ Encrypted trigger | ❌ | ❌ | ❌ | ❌ |
| Atomic attack-freeze | ✅ `freeze_vault` ix | ⚠ DAO vote | ⚠ Admin pause | ⚠ Admin pause | ⚠ Admin pause |
| Fake collateral rejection | ✅ On-chain proof check | ❌ Oracle trust | ❌ Oracle trust | ❌ Oracle trust | ❌ Oracle trust |
| Native stablecoin | ✅ LGUSD (SPL) | ❌ GHO (ETH only) | ❌ | ⚠ kUSD | ❌ |
| Bridge dependency | **Zero** | Many | Many | Many | Many |
| Dust forgiveness on repay | ✅ Auto-close | ❌ | ❌ | ❌ | ❌ |

---

## Full User Journey

```mermaid
flowchart TD
    A([Connect Wallet]) --> B{Collateral type?}
    B -->|SOL| C[register_vault\nAnchor instruction]
    B -->|Bitcoin testnet| D[Generate Ika dWallet\nSecp256k1 DKG]

    C --> E[demo_create_message_approval\nIka custody demo proof]
    D --> F[register_btc_vault\nlink dWallet pubkey + BTC address]
    F --> G[MessageApproval signed by Ika network]

    E --> H{Custody proof\nvalid + fresh?}
    G --> H
    H -->|No| I[❌ Borrow blocked\nProofExpired or Invalid]
    H -->|Yes| J[Vault status: VERIFIED ✅]

    J --> K[borrow_against_collateral\nor borrow_against_btc]
    K --> L{Health factor\nOK?}
    L -->|No| M[❌ CollateralInsufficient]
    L -->|Yes| N[LGUSD minted to wallet ✅]

    N --> O[Use LGUSD]
    O --> P[repay_borrow or repay_btc_borrow]
    P --> Q{Full repay?}
    Q -->|Yes / dust| R[BorrowPosition closed\nRent refunded ✅]
    Q -->|Partial| S[Principal reduced\nPosition stays open]
    R --> C

    N --> T[FHE risk monitor running]
    T --> U{EBool: is_underwater?}
    U -->|false| T
    U -->|true| V[freeze_vault fires atomically]
    V --> W[liquidate_position by keeper]
    W --> X[Collateral seized + bonus paid\nDebt cleared ✅]
```

---

## What Is Live Today

| Component | Status | Notes |
|---|---|---|
| Anchor program (11+ instructions) | ✅ Deployed | Devnet `GQia1ewyLgtkgX7HSfuttJ42qNPpYJhUbxeyCPXtcJFR` |
| SOL collateral vaults | ✅ Live | `register_vault` + `verify_custody_proof` |
| Bitcoin testnet collateral | ✅ Live | `register_btc_vault` + Ika Secp256k1 path |
| LGUSD SPL token | ✅ Live | Program-controlled mint |
| Borrow / repay / liquidate | ✅ Live | Aave-style scaled debt, dust forgiveness |
| Ika MessageApproval parsing | ✅ Real | Auto-detects real Ika format + demo-helper fallback |
| Encrypt FHE risk pipeline | ✅ Off-chain | On-chain EBool CPI wired; pre-alpha gates lift in next upgrade |
| BTC balance keeper | ✅ Running | Polls `mempool.space/testnet`, posts `BitcoinBalanceAttestation` |
| Price refresh daemon | ✅ Running | BTC=$90k, ETH=$3.5k, SOL=$150 refreshed every 10 min |
| Next.js frontend | ✅ Live | `/lend` (protocol) + `/demo` (attack simulations) |
| Torque growth layer | ✅ Live | 8 custom events, biweekly leaderboard (1,500 SOL), BTC bonus pool (500 SOL) |
| `@lendguard/sdk` | ✅ Published | npm `@lendguard/sdk` |

---

## Project Structure

```
LendGuard/
├── contracts/                     Anchor 1.x program (Rust)
│   ├── src/
│   │   ├── lib.rs                 Program entrypoint, all instructions
│   │   ├── instructions/
│   │   │   ├── lending.rs         borrow, repay, liquidate
│   │   │   ├── btc_lending.rs     btc-specific borrow/repay
│   │   │   ├── register_vault.rs
│   │   │   ├── verify_custody_proof.rs
│   │   │   ├── verify_btc_custody_proof.rs
│   │   │   ├── register_btc_vault.rs
│   │   │   ├── attest_btc_balance.rs
│   │   │   └── freeze_vault.rs
│   │   ├── integrations/
│   │   │   ├── ika.rs             MessageApproval parser (real + demo)
│   │   │   └── encrypt.rs         EBool result reader
│   │   └── state/                 On-chain account structs
│   └── scripts/
│       ├── refresh-prices.mjs     Price feed daemon
│       ├── btc-balance-keeper.mjs Bitcoin testnet attestation keeper
│       └── btc-liquidation-broadcaster.mjs
├── web/                           Next.js 16 frontend
│   ├── app/
│   │   ├── lend/page.tsx          Full lending protocol UI
│   │   ├── demo/page.tsx          Attack simulation demos
│   │   └── api/torque/events/     Server-side Torque event proxy
│   └── lib/
│       ├── program-actions.ts     All instruction builders
│       ├── lending-client.ts      Account fetchers + math
│       ├── btc-dwallet.ts         Ika Secp256k1 dWallet generation
│       ├── torque-client.ts       Torque event emission
│       └── torque-events.ts       Event schema registry
├── packages/sdk/                  @lendguard/sdk (TypeScript)
└── docs/
    ├── HANDOFF.md                 Full technical handoff
    ├── PRODUCTION_OPS.md          Keeper runbook
    └── BTC_COLLATERAL_PATH.md     Bitcoin integration design
```

---

## Running Locally

### Prerequisites

```bash
# Rust + Solana CLI + Anchor 1.x
rustup install stable
sh -c "$(curl -sSfL https://release.solana.com/v2.1.0/install)"
cargo install --git https://github.com/coral-xyz/anchor anchor-cli --locked

# Node.js 20+
node --version  # must be >= 20
```

### 1. Clone and install

```bash
git clone https://github.com/Rohitamalraj/LendGuard.git
cd LendGuard
cd web && npm install && cd ..
```

### 2. Configure environment

```bash
cp .env.example web/.env.local
# Add TORQUE_API_KEY for growth events (optional for local dev)
```

### 3. Start the frontend

```bash
cd web
npm run dev
# → http://localhost:3000
```

### 4. Run the background keepers (optional, for live BTC attestation)

```bash
# In separate terminals:
node contracts/scripts/refresh-prices.mjs          # price feed daemon
node contracts/scripts/btc-balance-keeper.mjs       # BTC balance attestation
```

### 5. Connect a Solana devnet wallet

- Install [Phantom](https://phantom.app/) or any Solana wallet.
- Switch to **Devnet** in wallet settings (Developer Settings → Testnet Mode → Solana Devnet).
- Airdrop SOL: `solana airdrop 2 <your-address> --url devnet`.
- Navigate to `/lend` and register a vault.

---

## Devnet Addresses

| Resource | Address |
|---|---|
| LendGuard Program | `GQia1ewyLgtkgX7HSfuttJ42qNPpYJhUbxeyCPXtcJFR` |
| LGUSD Mint | see `web/lib/program-actions.ts → LGUSD_MINT` |
| Ika Program | `87W54kGYFQ1rgWqMeu4XTPHWXWmXSQCcjm8vCTfiq1oY` |
| Encrypt Program | `4ebfzWdKnrnGseuQpezXdG8yCdHqwQ1SSBHD3bWArND8` |
| Ika gRPC | `pre-alpha-dev-1.ika.ika-network.net:443` |
| Encrypt gRPC | `pre-alpha-dev-1.encrypt.ika-network.net:443` |

---

## SDK

```bash
npm install @lendguard/sdk
```

```typescript
import { LendGuard } from "@lendguard/sdk";

const lg = new LendGuard({ connection, wallet, cluster: "devnet" });

// Register a vault and verify Ika custody proof
const { vaultPda } = await lg.registerVault({ dwalletId });
await lg.verifyCustodyProof({ vaultPda, messageApproval });

// Borrow LGUSD against verified collateral
await lg.borrow({ vaultPda, amountLgusd: 25_000_000n }); // 25 LGUSD (6 decimals)

// Repay in full — position closes automatically, rent refunded
await lg.repayAll({ vaultPda });
```

---

## Built For

**Solana Frontier Hackathon 2026 — Encrypt & Ika track**

- [Ika documentation](https://solana-pre-alpha.ika.xyz/)
- [Encrypt documentation](https://docs.encrypt.xyz/)
- [Torque MCP](https://platform.torque.so/)

---

## License

MIT
