# LendGuard Idea Overview

## One-line Pitch
LendGuard is a Solana-native collateral integrity layer for lending protocols that verifies cross-chain collateral provenance with Ika dWallet custody proofs and protects risk controls with Encrypt FHE-based private threshold checks.

## Problem Statement
Cross-chain collateral lending currently depends on bridge attestations that can be forged or delayed under validator compromise. Lending markets cannot independently verify whether wrapped collateral is truly backed on its origin chain. This creates systemic insolvency risk: fake collateral can be minted, borrowed against, and only detected after losses occur.

## LendGuard Thesis
LendGuard moves trust from bridge relayers to cryptographic proof-of-custody:
- **Ika dWallets** provide programmable, bridgeless custody signals for native-origin assets.
- **Encrypt REFHE** keeps liquidation/freeze thresholds confidential, preventing MEV bots from predicting and front-running defensive actions.
- **Anchor controls** enforce acceptance rules at the program level, not just off-chain monitoring.

## Core Value Proposition
- **For lenders (Marginfi/Mango-style integrations):** reject unverified collateral at deposit time.
- **For LST/LRT issuers:** expose verifiable collateral backing to integrators.
- **For institutions:** enable auditable, non-custodial collateral receipts without centralized trust.

## Integration Strategy (Productization)
LendGuard should be shipped as both protocol infrastructure and developer tooling:
- **`@lendguard/sdk` (TypeScript npm package):** primary integration path for lending teams and LST/LRT issuers.
- **Published Anchor IDL + devnet program ID:** enables direct client generation and CPI wiring.
- **Optional `lendguard-cpi` crate (Rust):** demonstrates on-chain composability for Anchor-native integrations.

For hackathon judging, the npm SDK is the highest-leverage deliverable because it makes integration effort obvious and testable in minutes.

## System Overview
1. **Provenance Vault (Ika layer)**  
   User opens a dWallet and locks native-origin collateral (or devnet proxy asset).  
   Ika emits/authorizes a custody proof (`MessageApproval`) containing amount, wallet, and freshness metadata.

2. **Verification + Guardrails (Anchor layer)**  
   LendGuard verifies proof validity (signer, asset mapping, amount bounds, staleness window).  
   Deposits are accepted only for verified vault state.

3. **Encrypted Risk Monitor (Encrypt layer)**  
   Protocol threshold and latest backing state are represented as ciphertext inputs.  
   `execute_graph` evaluates encrypted predicate(s), returning encrypted boolean outputs.

4. **Silent Circuit Breaker**  
   If risk predicate fails, LendGuard freezes new collateral actions immediately.  
   Defensive action can occur before public actors observe threshold conditions.

## Why This Is Novel
- Moves from **oracle/bridge trust** to **program-enforced custody provenance**.
- Introduces **private risk policy execution** (FHE) for anti-front-run controls.
- Composes both into a single lending security primitive rather than standalone tooling.

## Scope for Hackathon
### In Scope
- Anchor program implementing vault registration, proof verification, guarded deposit, and freeze state.
- Ika devnet integration for dWallet lifecycle + `MessageApproval` verification path.
- Encrypt devnet integration for encrypted threshold evaluation and boolean risk output consumption.
- Minimal Next.js operator UI to drive happy path and exploit simulation.
- `@lendguard/sdk` package exposing ergonomic integration methods such as:
  - `verifyCustodyProof(...)`
  - `registerCollateralVault(...)`
  - `checkRiskState(...)`

### Explicit Devnet Assumptions
- Ika mock signer / reduced decentralization in pre-alpha environment.
- Encrypt pre-alpha storage/privacy constraints on devnet.
- Native BTC/ETH represented via mapped proxy assets where required for demo.

## Success Criteria
- Unverified collateral deposit fails deterministically.
- Verified collateral deposit succeeds.
- Simulated proof/backing divergence triggers encrypted risk check failure.
- Circuit breaker flips protocol to frozen state and blocks new deposits.
- Demo communicates “prevention at acceptance layer,” not “detection after depeg.”

## Demo Narrative (Under 5 Minutes)
1. Create vault + link dWallet.
2. Submit valid custody proof and deposit successfully.
3. Simulate exploit condition (backing mismatch/proof staleness).
4. Run encrypted risk check and trigger freeze.
5. Attempt new deposit and show rejection from program guard.

## Naming and Positioning
Use **LendGuard** consistently as the product name.  
Tagline recommendation: **“Cryptographic Collateral Provenance for Solana Lending.”**
