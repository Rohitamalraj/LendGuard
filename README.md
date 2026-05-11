# LendGuard

**Cryptographic Collateral Provenance for Solana Lending.**

> "What would have saved KelpDAO $292 million."

LendGuard is a Solana-native collateral integrity layer that makes it **cryptographically impossible** to deposit fake cross-chain collateral, and **economically impossible** to front-run the protocol's own defense mechanism.

Built for the **Frontier Hackathon** — Encrypt & Ika track.

---

## The Problem

On April 17, 2026, KelpDAO was exploited for $292M. A compromised LayerZero validator forged a cross-chain message. Aave accepted it. $190M was drained before the oracle caught the depeg.

**Root cause:** every DeFi lending protocol trusts bridge messages blindly. No protocol has a smart-contract-level solution.

LendGuard is that solution.

---

## How It Works

### Layer 1 — Ika dWallet Custody Proof
- User creates a dWallet via Ika's 2PC-MPC network (co-controlled: user + Ika network)
- Native BTC/ETH is locked on origin chain inside the dWallet
- Ika produces a `MessageApproval` account on Solana: _"X BTC locked in dWallet Y at timestamp Z"_
- LendGuard's Anchor program reads the `MessageApproval` — **deposit rejected unless proof is valid and fresh**
- A compromised validator cannot forge this: 2PC-MPC requires network participation, not a single signature

### Layer 2 — Encrypt FHE Risk Monitor
- Liquidation threshold stored as FHE ciphertext (`threshold_ciphertext`) — invisible to bots
- Backing ratio updated by oracle as encrypted input (`backing_ciphertext`)
- `execute_graph` runs `check_backing_ratio(current_backing, total_minted, threshold)` entirely on ciphertexts
- Result is an encrypted boolean (`EBool`) committed on-chain
- If `EBool = false` → circuit breaker fires **before** bots can read the threshold

### Layer 3 — Silent Circuit Breaker (Anchor Program)
```
initialize_protocol()     → bootstrap protocol PDA + admin
register_vault()          → create vault PDA, link dWallet ID
initialize_risk_state()   → create risk PDA, set threshold ciphertext
verify_custody_proof()    → parse Ika MessageApproval, mark vault VERIFIED
deposit_collateral()      → REJECTED if not VERIFIED or protocol frozen
update_backing_state()    → oracle writes backing ciphertext key
trigger_risk_check()      → reads EBool from Encrypt result account
circuit_breaker_freeze()  → if EBool = false → protocol.frozen = true
admin_unfreeze()          → admin recovers protocol after incident
```

---

## Demo Flow (3 Minutes)

1. **Register vault + link dWallet** → vault state: `PENDING`
2. **Verify custody proof** → LendGuard parses `MessageApproval` → vault state: `VERIFIED`
3. **Deposit collateral** → accepted ✅
4. **Simulate bridge exploit** → backing ratio drops, no new `MessageApproval` arrives
5. **Trigger encrypted risk check** → `EBool = false` returned by Encrypt executor
6. **Circuit breaker fires** → `protocol.frozen = true` on-chain silently
7. **New deposit attempt** → rejected with `ProtocolFrozen` ❌

---

## Project Structure

```
LendGuard/
├── contracts/                  Anchor program (Rust)
│   ├── src/
│   │   ├── lib.rs              Program entrypoint, all instructions
│   │   ├── instructions/       One file per instruction
│   │   │   ├── initialize_protocol.rs
│   │   │   ├── initialize_risk_state.rs
│   │   │   ├── register_vault.rs
│   │   │   ├── verify_custody_proof.rs
│   │   │   ├── deposit_collateral.rs
│   │   │   ├── update_backing_state.rs
│   │   │   ├── trigger_risk_check.rs
│   │   │   ├── circuit_breaker.rs
│   │   │   └── close_vault.rs
│   │   ├── state/              On-chain account structs
│   │   │   ├── vault_account.rs
│   │   │   ├── protocol_state.rs
│   │   │   └── risk_state.rs
│   │   ├── integrations/       External protocol adapters
│   │   │   ├── ika.rs          Ika MessageApproval parser
│   │   │   └── encrypt.rs      Encrypt EBool result reader
│   │   ├── fhe/
│   │   │   └── check_backing_ratio.rs  #[encrypt_fn] DSL graph
│   │   ├── events.rs
│   │   ├── errors.rs
│   │   └── constants.rs
│   └── tests/
│       └── integration_tests.ts
├── packages/
│   └── sdk/                    @lendguard/sdk (TypeScript)
│       └── src/
│           ├── client.ts
│           ├── types.ts
│           └── index.ts
├── web/                        Next.js frontend
│   ├── app/
│   │   └── page.tsx            Landing page
│   └── components/landing/
├── docs/
│   ├── LENDGUARD_IDEA.txt
│   ├── LENDGUARD_IDEA_OVERVIEW.md
│   ├── LENDGUARD_DEVELOPMENT_ROADMAP.md
│   └── LENDGUARD_WORKSPLIT_2_DEVS.md
└── .env.example
```

---

## Tech Stack

| Component | Technology |
|---|---|
| Collateral custody | [Ika dWallets](https://solana-pre-alpha.ika.xyz/) (2PC-MPC, devnet) |
| Encrypted risk logic | [Encrypt REFHE](https://docs.encrypt.xyz/) (`#[encrypt_fn]` DSL, devnet) |
| Core program | Anchor 0.32 (Rust), Solana devnet |
| Frontend | Next.js 16, Tailwind CSS |
| SDK | `@lendguard/sdk` (TypeScript, npm) |

---

## Setup & Local Development

### Prerequisites

```bash
# Rust + Solana CLI + Anchor CLI
rustup install stable
sh -c "$(curl -sSfL https://release.solana.com/v1.18.22/install)"
cargo install --git https://github.com/coral-xyz/anchor anchor-cli --locked

# Node.js 18+
node --version
```

### 1. Configure environment

```bash
cp .env.example .env
# Fill in SOLANA_PRIVATE_KEY and update program IDs after deploy
```

### 2. Build and deploy contract

```bash
bash scripts/deploy-devnet.sh
```

### 3. Run integration tests

```bash
cd contracts
anchor test
```

### 3b. Run demo smoke check (recommended before recording)

```bash
bash scripts/demo-smoke.sh
```

### 4. Start frontend

```bash
cd web
npm install
npm run dev
# Open http://localhost:3000
```

### One-command runbook (WSL)

```bash
# from repo root
chmod +x scripts/*.sh
bash scripts/deploy-devnet.sh
bash scripts/demo-smoke.sh
```

---

## SDK Integration

```bash
npm install @lendguard/sdk
```

```typescript
import { LendGuard } from "@lendguard/sdk";

const lg = new LendGuard({ connection, wallet, cluster: "devnet" });

// Verify Ika custody proof before accepting collateral
const proof = await lg.verifyCustodyProof({
  vaultId,
  expectedDwalletId,
  messageApproval,
});

if (!proof.isValid) {
  throw new Error("Unverified collateral — deposit rejected");
}

// Trigger Encrypt FHE risk check
const risk = await lg.triggerRiskCheck({
  vaultId, riskState,
  backingCiphertext, thresholdCiphertext, resultCiphertext,
});

// { isSafe: false } → circuit breaker has already fired
```

---

## Devnet Addresses

| Resource | Value |
|---|---|
| LendGuard Program | `GQia1ewyLgtkgX7HSfuttJ42qNPpYJhUbxeyCPXtcJFR` |
| Ika Program | `87W54kGYFQ1rgWqMeu4XTPHWXWmXSQCcjm8vCTfiq1oY` |
| Encrypt Program | `4ebfzWdKnrnGseuQpezXdG8yCdHqwQ1SSBHD3bWArND8` |
| Ika gRPC | `pre-alpha-dev-1.ika.ika-network.net:443` |
| Encrypt gRPC | `pre-alpha-dev-1.encrypt.ika-network.net:443` |

---

## What Is Real vs Mocked

| | Status |
|---|---|
| Anchor program instructions + guards | ✅ Real |
| Ika `MessageApproval` account parsing | ✅ Real schema, mock signer on devnet |
| Encrypt `#[encrypt_fn]` DSL graph | ✅ Real macro, plaintext on devnet |
| Encrypt `EBool` result reading adapter | ✅ Real account read, plaintext on devnet |
| Distributed MPC (200+ validators) | 🔶 Mock single signer on pre-alpha devnet |
| Real FHE encryption | 🔶 Plaintext on pre-alpha devnet |
| Native BTC/ETH custody | 🔶 devnet SOL proxy |

---

## License

MIT

