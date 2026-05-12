# @lendguard/sdk

[![npm version](https://img.shields.io/npm/v/@lendguard/sdk.svg)](https://www.npmjs.com/package/@lendguard/sdk)

Framework-agnostic TypeScript SDK for the **LendGuard** native lending protocol on Solana — built on **Ika dWallets** for cryptographically-provable cross-chain collateral (SOL **and** native Bitcoin via Secp256k1 dWallets) and **Encrypt FHE** for private, anti-MEV risk monitoring.

## Install

```bash
npm install @lendguard/sdk @solana/web3.js
```

Peer deps: `@solana/web3.js >= 1.95`.

## What's in 0.3.0

- **SOL collateral path** — `buildBorrowAgainstCollateralIx`, `buildRepayBorrowIx`, `buildLiquidatePositionIx`, plus admin helpers
- **🆕 BTC collateral path** (native Bitcoin via Ika Secp256k1 dWallets) — 8 new instruction builders:
  - `buildRegisterBtcVaultIx`
  - `buildVerifyBtcCustodyProofIx`
  - `buildRefreshBtcCustodyProofIx`
  - `buildAttestBtcBalanceIx`
  - `buildBorrowAgainstBtcCollateralIx`
  - `buildRepayBtcBorrowIx`
  - `buildLiquidateBtcPositionIx`
  - `buildFinalizeBtcLiquidationIx`
- All BTC PDA helpers: `deriveBtcVaultPda`, `deriveBtcAttestationPda`, `deriveBtcBorrowPositionPda`, `deriveIkaCpiAuthority`
- Account decoders for `LendingPool`, `BorrowPosition`, `AdminPriceFeed`, `ProtocolState`

## Quick start — borrow LGUSD against SOL collateral

```ts
import {
  buildBorrowAgainstCollateralIx,
  deriveVaultPda,
  LGUSD_MINT_DEVNET,
} from "@lendguard/sdk";
import { Connection, Transaction, PublicKey } from "@solana/web3.js";

const connection = new Connection("https://api.devnet.solana.com", "confirmed");
const owner = wallet.publicKey;
const [vaultPda] = deriveVaultPda(owner, ikaDwalletPubkey);

const { ix } = await buildBorrowAgainstCollateralIx({
  owner,
  vaultPda,
  borrowAssetMint: LGUSD_MINT_DEVNET,
  poolTokenVault,
  borrowerTokenAccount,
  amount: 25_000_000n, // 25 LGUSD (6-decimal)
});

const sig = await connection.sendTransaction(new Transaction().add(ix), [wallet]);
```

## Quick start — register a Bitcoin testnet vault

```ts
import {
  buildRegisterBtcVaultIx,
  buildVerifyBtcCustodyProofIx,
  deriveBtcVaultPda,
} from "@lendguard/sdk";

const { ix: registerIx, btcVaultPda } = await buildRegisterBtcVaultIx({
  owner: wallet.publicKey,
  ikaDwallet: ikaDwalletAccount,        // 32-byte Ika dWallet pubkey
  dwalletPubkey: compressedSecp256k1,   // 33 bytes
  bitcoinAddress: "tb1q...",
});

const verifyIx = await buildVerifyBtcCustodyProofIx({
  owner: wallet.publicKey,
  btcVaultPda,
  messageApprovalPda,                   // produced by Ika DKG/signing flow
});

// Combine register + verify in a single transaction.
const tx = new Transaction().add(registerIx, verifyIx);
```

## Quick start — borrow against attested BTC

After an authorized keeper has posted a `BitcoinBalanceAttestation`:

```ts
import { buildBorrowAgainstBtcCollateralIx, LGUSD_MINT_DEVNET } from "@lendguard/sdk";

const { ix } = await buildBorrowAgainstBtcCollateralIx({
  owner: wallet.publicKey,
  btcVaultPda,
  borrowAssetMint: LGUSD_MINT_DEVNET,
  poolTokenVault,
  borrowerTokenAccount,
  amount: 50_000_000n, // 50 LGUSD
});
```

To repay everything at once (debt + accrued interest, with on-chain dust forgiveness):

```ts
import { buildRepayBtcBorrowIx } from "@lendguard/sdk";

const ix = await buildRepayBtcBorrowIx({
  /* ...accounts... */
  amount: (1n << 64n) - 1n,             // u64::MAX → repay everything
});
```

## Devnet program IDs

| Component | Address |
|---|---|
| LendGuard program | `LGUARDxJP9G4QH7uW2GuV5KKqPRkrCZcZ8jKqcQVUWJ` |
| LGUSD mint | `LGUSDcMv5sH6KEqMW9P5GE52f72NgaT9CrLuFA3JTH4` |
| Ika dWallet program | `87W54kGYFQ1rgWqMeu4XTPHWXWmXSQCcjm8vCTfiq1oY` |

## Project links

- Repository: <https://github.com/Rohitamalraj/LendGuard>
- Live demo: <https://lendguard.vercel.app>
- Protocol docs: see `/docs` in the repo
