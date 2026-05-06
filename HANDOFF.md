# LendGuard — Developer Handoff Document

> For anyone picking up this project to continue development.  
> Read this fully before touching any code.

---

## 1. What Is LendGuard?

LendGuard is a **Solana-native collateral integrity layer** built for the Frontier Hackathon (Encrypt + Ika track).

**The problem it solves:** Every DeFi lending protocol today accepts cross-chain collateral by trusting a bridge message blindly. On April 17, 2026, KelpDAO was exploited for $292M this way — a compromised LayerZero validator forged a message, Aave accepted ghost collateral, and $190M was drained.

**The solution:** LendGuard uses two Solana-native primitives:

- **Ika dWallets** — 2PC-MPC protocol that produces cryptographically unforgeable custody proofs. The deposit guard reads an Ika `MessageApproval` account on-chain; a compromised validator cannot forge it.
- **Encrypt FHE** — Fully Homomorphic Encryption that lets the protocol evaluate risk thresholds on encrypted data. Liquidation thresholds are invisible to bots, so the circuit breaker fires *before* bots can front-run it.

---

## 2. What Has Been Built (Completed Work)

### 2a. Solana Anchor Program — `contracts/`

**Deployed on devnet:**
- **Program ID:** `FymmJAKSLcadQTjyiGjQW1iyegKLMdHhSND1bDjgZg1X`
- **Deploy tx:** `4cMP868pZ6nB5H7PNV8rtkg2Ew6czMysz4gLJqfFkXbx4aNYD1a2LF8ppi8NbZhv1vzTYx2VWDrWfmDpA8Hc8dGC`
- **Authority:** `DwpDbPrB5TzZAEwcB1WjUdfcTjH39uhhY8Wk8W4KfN38` (the devnet wallet)
- **ProgramData:** `5yNed91zThsgtT7FnohvZhJcb7oAy5xQKyFw9bMPcS7L`
- **Last deployed slot:** `460542552`

All 11 instructions are implemented and deployed:

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

**On-chain account types (PDAs):**

| Account | Seed | File |
|---|---|---|
| `ProtocolStateAccount` | `[b"protocol_state"]` | `state/protocol_state.rs` |
| `VaultAccount` | `[b"vault", owner_pubkey, dwallet_id]` | `state/vault_account.rs` |
| `RiskStateAccount` | `[b"risk_state", vault_pubkey]` | `state/risk_state.rs` |

**Integration adapters:**

- `integrations/ika.rs` — Parses Ika `MessageApproval` account data (dwallet_id, approved_at, is_signed). Validates signature, ID match, and proof freshness (24-hour expiry). Pre-alpha: uses raw AccountInfo, no external crate dependency.
- `integrations/encrypt.rs` — Reads an Encrypt ciphertext account and interprets byte[0] as the EBool result. Pre-alpha: data is plaintext on devnet, same code works on mainnet when FHE is live.
- `fhe/check_backing_ratio.rs` — The `#[encrypt_fn]` DSL circuit definition. **Not compiled into the program binary** (gated by `--features fhe`). This gets sent to the Encrypt off-chain executor.

**Error types** — `errors.rs` has 19 custom error codes including `VaultNotVerified`, `ProtocolFrozen`, `ProofExpired`, `DWalletMismatch`, `ArithmeticOverflow`, etc.

**Build setup decisions made:**
- Removed all unstable pre-alpha git dependencies (`ika-dwallet-anchor`, `encrypt-anchor`, etc.) — they were not needed because adapters work with raw `AccountInfo`
- `anchor-lang = "0.31.1"` (stable, matches deployed CLI)
- FHE circuit gated behind `#[cfg(feature = "fhe")]` — build without the pre-alpha crate by default
- `overflow-checks = true` in release profile (Anchor requirement)
- Platform-tools v1.52 required for `cargo-build-sbf` (manually downloaded to `~/.cache/solana/v1.52/`)

---

### 2b. TypeScript SDK — `packages/sdk/`

Package: `@lendguard/sdk` v0.1.0-alpha.0

All 9 methods implemented in `src/client.ts`:

```typescript
import { LendGuard } from "@lendguard/sdk";

const lg = new LendGuard({ connection, wallet, cluster: "devnet" });

await lg.initializeProtocol();
await lg.registerVault({ dwalletId, assetType: "BTC" });
await lg.initializeRiskState({ vaultId, thresholdCiphertext });
await lg.verifyCustodyProof({ vaultId, expectedDwalletId, messageApproval });
await lg.depositCollateral({ vaultId, protocolState, amount });
await lg.updateBackingState({ vaultId, riskState, backingCiphertext, newBackingAmount });
await lg.triggerRiskCheck({ vaultId, riskState, backingCiphertext, thresholdCiphertext, resultCiphertext });
await lg.circuitBreakerFreeze({ protocolState, caller, reason });
await lg.adminUnfreeze({ vaultId, protocolState });
```

- If `config.program` (an Anchor program client) is provided, methods make real on-chain calls.
- If `config.program` is omitted, methods return mock values — useful for UI dev without a wallet.
- `src/types.ts` has all TypeScript interfaces for params/results.

**Status:** Not yet published to npm. `npm pack --dry-run` passes. Ready to publish.

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

This wallet is the **upgrade authority** for the deployed program (`FymmJAKSLcadQTjyiGjQW1iyegKLMdHhSND1bDjgZg1X`). You need it to redeploy or upgrade the program.

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
# Expected: FymmJAKSLcadQTjyiGjQW1iyegKLMdHhSND1bDjgZg1X
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
Program Id: FymmJAKSLcadQTjyiGjQW1iyegKLMdHhSND1bDjgZg1X
Owner: BPFLoaderUpgradeab1e11111111111111111111111
Data Account: 5yNed91zThsgtT7FnohvZhJcb7oAy5xQKyFw9bMPcS7L
Authority: DwpDbPrB5TzZAEwcB1WjUdfcTjH39uhhY8Wk8W4KfN38
```

---

### Step 13 — Initialize the protocol on-chain (one-time, run this once)

> **This has NOT been done yet.** The program is deployed but the `ProtocolStateAccount` PDA does not exist yet on devnet. Someone must call `initialize_protocol` exactly once before any vault can be created.

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
const programId = new anchor.web3.PublicKey('FymmJAKSLcadQTjyiGjQW1iyegKLMdHhSND1bDjgZg1X');
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
| **Real Ika dWallet creation flow** | `web/lib/lendguard-client.ts` | Call Ika's gRPC to create a real dWallet on devnet. Docs: https://solana-pre-alpha.ika.xyz/ Replace `buildMockMessageApprovalData()` with real Ika proof for the demo. |
| **Real Encrypt `execute_graph` call** | Frontend / off-chain script | Call Encrypt's executor endpoint `pre-alpha-dev-1.encrypt.ika-network.net:443` with the `check_backing_ratio` circuit. Store result EBool account, then call `trigger_risk_check` on-chain. Docs: https://docs.encrypt.xyz/ |
| **`initialize_protocol` on devnet** | Script / frontend | The protocol state PDA has not been initialized yet (program is deployed but no accounts created). Someone must call `initialize_protocol` once before anything else works. |
| **Demo seed script** | `scripts/seed-demo-state.sh` | Create a script that calls `initialize_protocol`, `register_vault`, `initialize_risk_state` so the demo always starts from a clean, known state. |

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
  new PublicKey("FymmJAKSLcadQTjyiGjQW1iyegKLMdHhSND1bDjgZg1X")
);

// Vault
const [vaultPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("vault"), ownerPubkey.toBuffer(), Buffer.from(dwalletIdBytes)],
  new PublicKey("FymmJAKSLcadQTjyiGjQW1iyegKLMdHhSND1bDjgZg1X")
);

// Risk State
const [riskStatePda] = PublicKey.findProgramAddressSync(
  [Buffer.from("risk_state"), vaultPda.toBuffer()],
  new PublicKey("FymmJAKSLcadQTjyiGjQW1iyegKLMdHhSND1bDjgZg1X")
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
solana program show FymmJAKSLcadQTjyiGjQW1iyegKLMdHhSND1bDjgZg1X --url devnet

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
| Ika `MessageApproval` parsing | ✅ **Real schema** | Parser reads the actual account layout. Mock signer in pre-alpha (not 200+ MPC nodes) |
| Encrypt `EBool` reading | ✅ **Real account read** | Reads ciphertext account byte[0]. Pre-alpha stores plaintext instead of ciphertext |
| `#[encrypt_fn]` DSL circuit | ✅ **Real syntax** | Same code runs on mainnet with real FHE — zero changes needed |
| Distributed MPC (Ika) | 🔶 **Mock on pre-alpha** | Single devnet signer, not 200+ validators |
| Real FHE privacy (Encrypt) | 🔶 **Mock on pre-alpha** | Plaintext on devnet, FHE on mainnet |
| Native BTC/ETH custody | 🔶 **Proxied** | devnet SOL used as proxy for cross-chain assets |

---

*Last updated: May 7, 2026. Program deployed at slot 460542552.*
