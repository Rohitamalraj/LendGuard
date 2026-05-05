# LendGuard Development Roadmap

## Goal
Ship a hackathon-ready, end-to-end demo where LendGuard enforces collateral provenance and triggers a private-risk circuit breaker using Ika + Encrypt on Solana devnet.

## Milestone Plan

### Phase 0 - Foundations (Day 1)
**Outcomes**
- Finalize architecture, interfaces, and acceptance criteria.
- Establish repo structure and local/devnet environment scripts.

**Deliverables**
- Program account model diagram (vault, protocol config, proof state, risk state).
- API contract doc for frontend <-> backend/indexer <-> Anchor instructions.
- `.env.example` and setup scripts for Solana, Anchor, Ika, Encrypt devnet endpoints.

**Exit Criteria**
- Team can run `anchor test` and frontend locally with stubbed integrations.

---

### Phase 1 - Core Anchor Guardrails (Days 2-3)
**Outcomes**
- Implement protocol state machine and deposit controls.

**Deliverables**
- Instructions:
  - `register_collateral`
  - `verify_custody_proof`
  - `deposit_collateral`
  - `circuit_breaker_freeze`
- Error model (`UnverifiedCollateral`, `StaleProof`, `ProtocolFrozen`, etc.).
- Unit tests for state transitions and access control.

**Exit Criteria**
- Program enforces “verified-or-reject” path in tests.

---

### Phase 2 - Ika Provenance Integration (Days 4-5)
**Outcomes**
- Wire real dWallet proof flow into verification step.

**Deliverables**
- dWallet lifecycle integration (create/init + custody event collection).
- Parser/validator for Ika `MessageApproval` data.
- Freshness and amount consistency checks.
- Integration tests using recorded/mock devnet responses where needed.

**Exit Criteria**
- Valid proof accepted; forged/stale/mismatched proof rejected in automated tests.

---

### Phase 3 - Encrypt Risk Pipeline (Days 6-7)
**Outcomes**
- Add encrypted threshold logic and on-chain freeze triggering.

**Deliverables**
- Encrypt function graph for backing predicate (e.g., `backing_ratio >= threshold`).
- Off-chain executor integration (`execute_graph`) and result commit path.
- Anchor instruction to consume risk output and freeze protocol.
- Tests for pass/fail risk outcomes.

**Exit Criteria**
- Risk fail path flips `frozen = true` and blocks deposits.

---

### Phase 4 - Frontend + Demo UX (Days 8-9)
**Outcomes**
- Build operator/demo interface with deterministic walkthrough.

**Deliverables**
- Next.js pages/components for:
  - vault registration
  - proof verification status
  - deposit action
  - exploit simulation
  - risk check trigger
  - protocol freeze visibility
- Wallet adapter integration and transaction toasts/logs.
- “Demo mode” script or seed data for repeatable runs.

**Exit Criteria**
- Full 3-5 minute flow executable by a new team member without code edits.

---

### Phase 5 - Hardening + Submission (Days 10-11)
**Outcomes**
- Polish reliability, docs, and judging narrative.

**Deliverables**
- End-to-end test script for happy path + attack path.
- README with architecture, setup, usage, constraints, and program IDs.
- `@lendguard/sdk` package prepared and published (or release-candidate tarball produced).
- IDL artifact committed (`target/idl/lendguard.json`) and referenced in docs.
- Optional `crates/lendguard-cpi` scaffold for CPI-based program integrations.
- Demo video script and capture checklist.
- Risk disclosures (devnet limitations, mocked assumptions, production path).

**Exit Criteria**
- Submission-ready repo with reproducible demo and clear technical story.

## Cross-Cutting Workstreams
- **Security:** signer checks, account constraints, replay/staleness defenses.
- **Observability:** structured logs/events for each state transition.
- **DX:** scripts for local reset, deploy, seed, and demo replay.
- **Documentation:** keep architecture and API docs updated per phase.

## Suggested Timeline (11-Day Sprint)
- Day 1: Phase 0
- Days 2-3: Phase 1
- Days 4-5: Phase 2
- Days 6-7: Phase 3
- Days 8-9: Phase 4
- Days 10-11: Phase 5

## Risk Register and Mitigations
- **Ika/Encrypt pre-alpha instability** -> record fallback fixtures and isolate adapters.
- **Devnet RPC inconsistency** -> use retry/backoff and pinned RPC providers.
- **Integration drift near deadline** -> freeze interfaces after Day 5.
- **Demo failure risk** -> maintain scripted deterministic “golden path” runbook.

## Definition of Done
- Smart contract prevents unverified collateral acceptance.
- Encrypted risk check can trigger protocol freeze.
- Frontend demonstrates both safe and attack scenarios.
- External integrator can install `@lendguard/sdk` and run proof verification in a minimal example.
- Tests and docs make behavior reproducible for judges.
