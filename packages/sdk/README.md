# @lendguard/sdk

TypeScript SDK for integrating LendGuard collateral verification and risk checks.

## Install

```bash
npm install @lendguard/sdk
```

## Usage

```ts
import { LendGuard } from "@lendguard/sdk";

const lg = new LendGuard({
  connection,
  wallet,
  cluster: "devnet",
});

const proof = await lg.verifyCustodyProof({
  vaultId,
  expectedDwalletId,
  messageApproval,
});

if (!proof.isValid) {
  throw new Error("Unverified collateral");
}
```

## Status

This package currently includes a typed client scaffold and placeholder methods.
Anchor method wiring will be added as the on-chain IDL/API stabilizes.
