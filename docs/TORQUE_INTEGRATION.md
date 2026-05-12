# Torque Integration

LendGuard uses Torque as a growth, analytics, and readiness layer. It does not
use Torque for token rewards, raffles, rebates, or transaction execution.

Torque docs:

- MCP overview and setup: https://platform.torque.so/docs
- Quickstart: https://platform.torque.so/docs/mcp/quickstart
- Configuration: https://platform.torque.so/docs/mcp/configuration
- Data sources and custom events: https://platform.torque.so/docs/mcp/tools/data-sources
- Incentive workflow: https://platform.torque.so/docs/mcp/guides/creating-incentives

## What is implemented

### 1. Custom event ingestion

The frontend records LendGuard actions and posts them to:

```txt
POST /api/torque/events
```

The server route validates the event name and forwards to Torque:

```txt
POST https://ingest.torque.so/events
Content-Type: application/json
x-api-key: <TORQUE_API_KEY>
```

If `TORQUE_API_KEY` is missing, events are still stored locally in the browser
so the hackathon demo remains usable offline.

### 2. Structured onboarding

`GuardianPanel` renders a "LendGuard Guardian" quest:

1. Connect wallet
2. Verify custody proof
3. Borrow LGUSD
4. Repay safely
5. Register BTC testnet collateral
6. Complete attack demo

Each step is driven by a Torque custom event rather than by a reward payout.

### 3. Funnel analytics

The same events power local funnel stats in the UI:

- total events
- completed quest steps
- security engagement
- reputation tier

Once a Torque API key is configured, the same data becomes queryable in Torque.

### 4. Behavioral gates

The UI computes off-chain readiness signals:

- Borrow readiness: custody proof event observed
- BTC flow unlocked: wallet-connected event observed
- Liquidator beta readiness: custody proof + attack demo completion observed

These are advisory product-policy gates. The Solana program remains the source
of truth for vault, borrow, repay, and liquidation safety.

### 5. Reputation, not rewards

The integration intentionally avoids token payouts. LendGuard is a collateral
integrity product, so the Torque layer is framed as reputation and protocol
health telemetry:

- Builder
- Guardian
- Liquidator beta readiness

## Torque MCP setup

Add the Torque MCP server to Cursor:

```json
{
  "mcpServers": {
    "torque": {
      "command": "npx",
      "args": ["@torque-labs/mcp@latest"],
      "env": {
        "TORQUE_API_TOKEN": "your-auth-token"
      }
    }
  }
}
```

Then in Cursor ask:

```txt
Authenticate with Torque using this token: <token>
Create a project named LendGuard with defaultProgramAddress GQia1ewyLgtkgX7HSfuttJ42qNPpYJhUbxeyCPXtcJFR
Create and attach the custom events from docs/TORQUE_INTEGRATION.md
Create an API key named LendGuard web app
```

Copy the returned API key into:

```txt
TORQUE_API_KEY=<key>
```

## Custom event schemas

These map directly to `web/lib/torque-events.ts`.

### lendguard_wallet_connected

```json
{
  "eventName": "lendguard_wallet_connected",
  "name": "LendGuard Wallet Connected",
  "fields": [
    { "fieldName": "cluster", "type": "string" },
    { "fieldName": "source", "type": "string" }
  ]
}
```

### lendguard_sol_vault_registered

```json
{
  "eventName": "lendguard_sol_vault_registered",
  "name": "LendGuard SOL Vault Registered",
  "fields": [
    { "fieldName": "vault", "type": "string" },
    { "fieldName": "tx", "type": "string" },
    { "fieldName": "collateral_type", "type": "string" }
  ]
}
```

### lendguard_btc_vault_registered

```json
{
  "eventName": "lendguard_btc_vault_registered",
  "name": "LendGuard BTC Vault Registered",
  "fields": [
    { "fieldName": "vault", "type": "string" },
    { "fieldName": "tx", "type": "string" },
    { "fieldName": "collateral_type", "type": "string" },
    { "fieldName": "bitcoin_address", "type": "string" },
    { "fieldName": "ika_mode", "type": "string" }
  ]
}
```

### lendguard_custody_proof_verified

```json
{
  "eventName": "lendguard_custody_proof_verified",
  "name": "LendGuard Custody Proof Verified",
  "fields": [
    { "fieldName": "vault", "type": "string" },
    { "fieldName": "tx", "type": "string" },
    { "fieldName": "collateral_type", "type": "string" },
    { "fieldName": "proof_source", "type": "string" }
  ]
}
```

### lendguard_btc_attestation_posted

```json
{
  "eventName": "lendguard_btc_attestation_posted",
  "name": "LendGuard BTC Balance Attested",
  "fields": [
    { "fieldName": "vault", "type": "string" },
    { "fieldName": "tx", "type": "string" },
    { "fieldName": "satoshis", "type": "number" },
    { "fieldName": "bitcoin_block_height", "type": "number" }
  ]
}
```

### lendguard_lgusd_borrow_opened

```json
{
  "eventName": "lendguard_lgusd_borrow_opened",
  "name": "LendGuard LGUSD Borrow Opened",
  "fields": [
    { "fieldName": "position", "type": "string" },
    { "fieldName": "vault", "type": "string" },
    { "fieldName": "tx", "type": "string" },
    { "fieldName": "amount_lgusd", "type": "number" },
    { "fieldName": "collateral_type", "type": "string" }
  ]
}
```

### lendguard_lgusd_repaid

```json
{
  "eventName": "lendguard_lgusd_repaid",
  "name": "LendGuard LGUSD Repaid",
  "fields": [
    { "fieldName": "position", "type": "string" },
    { "fieldName": "vault", "type": "string" },
    { "fieldName": "tx", "type": "string" },
    { "fieldName": "amount_lgusd", "type": "number" },
    { "fieldName": "repay_all", "type": "boolean" },
    { "fieldName": "collateral_type", "type": "string" }
  ]
}
```

### lendguard_attack_demo_completed

```json
{
  "eventName": "lendguard_attack_demo_completed",
  "name": "LendGuard Attack Demo Completed",
  "fields": [
    { "fieldName": "vault", "type": "string" },
    { "fieldName": "tx", "type": "string" },
    { "fieldName": "attack_type", "type": "string" },
    { "fieldName": "blocked", "type": "boolean" }
  ]
}
```

## Friction log

- The public docs describe custom event ingestion clearly, but the exact
  browser-app integration pattern is left to the project. LendGuard solves this
  with a server proxy so `TORQUE_API_KEY` is never exposed to the client.
- The docs focus heavily on incentives and reward distribution. For a security
  protocol, the more natural fit is custom events, reputation, and analytics.
- Sybil resistance is described in the track brief, but the public docs page
  fetched during implementation did not expose a concrete identity API. The UI
  therefore models Sybil-resistant access as a future Torque-backed readiness
  gate rather than hardcoding an unknown endpoint.
