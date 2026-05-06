# LendGuard Work Split (2 Developers)

## Team Model
Use ownership by subsystem with a strict integration contract by Day 3 to avoid merge thrash.

- **Developer A (Protocol + Security Lead):** Anchor program, account model, verification logic, freeze mechanism, tests.
- **Developer B (Integrations + Product Lead):** Ika/Encrypt adapters, Next.js demo UI, transaction orchestration, demo tooling.

## Ownership Matrix

### Developer A - Protocol + Security
- Define Anchor accounts, PDA seeds, and instruction interfaces.
- Implement:
  - `register_collateral`
  - `verify_custody_proof`
  - `deposit_collateral`
  - `circuit_breaker_freeze`
- Add invariant tests:
  - cannot deposit without verification
  - stale/malformed proof rejection
  - frozen protocol blocks deposits
- Own error taxonomy and event schema.
- Conduct final pre-submission contract threat review.

### Developer B - Integrations + UX
- Implement Ika dWallet interaction layer and proof ingestion pipeline.
- Implement Encrypt graph execution trigger and output handling.
- Build and publish `@lendguard/sdk` package:
  - typed client wrapper for proof verification and risk checks
  - package docs and integration snippets
  - npm release flow (`0.1.0-alpha` acceptable for hackathon)
- Build frontend flows:
  - connect wallet
  - create/register vault
  - verify proof
  - deposit
  - simulate exploit
  - trigger/check freeze
- Own demo script automation, seeded state scripts, and video walk-through prep.
- Maintain user-facing docs and architecture visuals.

## Joint Responsibilities
- Agree on canonical protobuf/JSON/internal struct mapping for custody proof payload.
- Pair on integration test harness for full happy path and exploit path.
- Daily security sanity review for signer/auth/account constraints.
- Keep README accurate to latest program and UI behavior.
- Publish IDL and devnet program IDs with a verified integration example.

## Interface Contract (Freeze Early)
By end of Day 3, lock:
- instruction names and argument schema
- account list and mutability/signers
- event payload structure
- frontend adapter input/output contracts

Any post-freeze change requires both developers sign-off.

## Day-by-Day Split (11-Day Sprint)
- **Day 1:** A -> account model + program skeleton, B -> frontend scaffold + adapter stubs
- **Day 2:** A -> register/verify instructions, B -> Ika proof fetch/parse
- **Day 3:** A -> deposit/freeze logic + tests, B -> UI wiring to stubbed methods; freeze interfaces
- **Day 4:** A -> proof validation hardening, B -> real Ika integration
- **Day 5:** A+B -> integration tests for verification/deposit
- **Day 6:** A -> on-chain risk state consumption, B -> Encrypt graph execution integration
- **Day 7:** A+B -> encrypted risk fail -> freeze end-to-end validation
- **Day 8:** A -> security edge cases, B -> exploit simulation UX polish
- **Day 9:** A+B -> full demo rehearsal and reliability fixes
- **Day 10:** A -> final contract review + optional CPI crate polish, B -> SDK publish + README integration section
- **Day 11:** A+B -> integration smoke test from fresh project, submission packaging, final run recording

## PR Strategy
- Small PRs only (1 feature slice each), target under ~400 lines where possible.
- Required reviewers:
  - Contract-affecting PRs: Developer A mandatory.
  - Integration/UI PRs touching tx flow: Developer B mandatory.
- No direct pushes to main during sprint.

## Definition of Team Success
- End-to-end demo runs reliably in one scripted flow.
- Both developers can execute each other’s runbooks.
- Judges can understand architecture in under 2 minutes from docs + UI.
