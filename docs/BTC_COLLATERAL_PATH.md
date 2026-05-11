# Bitcoin Testnet Collateral Path

> Status: **shipped on Solana devnet** as an additive collateral path.
> Existing SOL/devnet collateral remains unchanged.

LendGuard now supports two collateral surfaces side-by-side:

| Collateral path | Chain | Custody model | Status |
|---|---:|---|---|
| Existing SOL-style vaults | Solana devnet | Program-owned `VaultAccount` / lamport flow | ✅ unchanged |
| Bitcoin testnet vaults | Bitcoin testnet + Solana devnet | Ika Secp256k1 dWallet + keeper balance attestation | ✅ added |

## What Ika provides

Ika is **not** the blocker for Bitcoin collateral. Ika pre-alpha already provides the Bitcoin signing primitives LendGuard needs:

- `Secp256k1` curve for Bitcoin public keys.
- `EcdsaDoubleSha256` for BIP143 / SegWit `P2WPKH` sighashes.
- `TaprootSha256` for Taproot / BIP340.
- Anchor CPI `approve_message`, which creates/verifies real Ika `MessageApproval` accounts.

Ika deliberately does **not** provide Bitcoin balance reads. That is the correct separation of concerns: Ika signs; LendGuard observes Bitcoin testnet balances through a keeper.

## What was added

### On-chain state

- `contracts/src/state/btc_vault_account.rs`
  - `BtcVaultAccount`
  - stores owner, Ika dWallet account, compressed 33-byte Secp256k1 pubkey, `tb1…` address, proof status, attested satoshis, and liquidation state.
- `contracts/src/state/btc_balance_attestation.rs`
  - `BitcoinBalanceAttestation`
  - keeper-signed snapshot of a Bitcoin testnet address balance.
- Existing `BorrowPosition` is reused with a new seed:
  - `btc_borrow_position`
  - prevents collisions with existing SOL-collateral borrow positions.

### On-chain instructions

| Instruction | Purpose |
|---|---|
| `register_btc_vault` | Registers an Ika Secp256k1 dWallet + `tb1…` address and initializes its balance-attestation PDA. |
| `attest_btc_balance` | Admin keeper posts the latest mempool.space testnet balance snapshot. |
| `verify_btc_custody_proof` | Reads a real Ika `MessageApproval` and verifies it matches the registered dWallet. |
| `refresh_btc_custody_proof` | Refreshes proof timestamp after a new Ika approval. |
| `borrow_against_btc_collateral` | Borrows LGUSD against fresh attested tBTC balance using the existing BTC price feed + lending pool. |
| `repay_btc_borrow` | Repays BTC-backed debt; supports `u64::MAX` repay-all dust forgiveness and closes the position. |
| `liquidate_btc_position` | Repays unhealthy debt, CPI-calls Ika `approve_message` for a Bitcoin BIP143 sighash, and freezes the BTC vault pending broadcast. |
| `finalize_btc_liquidation` | Keeper finalizes after the signed Bitcoin testnet transaction confirms. |

### Off-chain scripts

- `contracts/scripts/btc-balance-keeper.mjs`
  - polls all `BtcVaultAccount` accounts.
  - reads `https://mempool.space/testnet/api/address/{tb1...}`.
  - calls `attest_btc_balance`.

Run once:

```bash
node contracts/scripts/btc-balance-keeper.mjs --once
```

Run as keeper:

```bash
POLL_MS=30000 node contracts/scripts/btc-balance-keeper.mjs
```

- `contracts/scripts/btc-liquidation-broadcaster.mjs`
  - broadcasts a signed Bitcoin testnet transaction.
  - waits for confirmations.
  - calls `finalize_btc_liquidation`.

Example:

```bash
BTC_VAULT=<btc_vault_pda> \
BTC_ADDRESS=<tb1q...> \
RAW_TX_HEX=<signed_testnet_tx_hex> \
node contracts/scripts/btc-liquidation-broadcaster.mjs
```

### Frontend

The existing `/lend` page now has a separate **Bitcoin testnet collateral** section:

1. Paste Ika dWallet account pubkey.
2. Paste 33-byte compressed Secp256k1 pubkey.
3. Derive or paste `tb1q…` address.
4. Register BTC vault.
5. Fund address through a public tBTC faucet.
6. Run keeper to post balance attestation.
7. Verify Ika custody proof.
8. Borrow / repay LGUSD.

This section is additive and does not alter the existing SOL collateral UI.

### Client helpers

- `web/lib/btc-address.ts`
  - derives testnet `P2WPKH` address from compressed Secp256k1 pubkey.
  - exposes faucet and mempool.space explorer helpers.
- `web/lib/program-actions.ts`
  - BTC PDA derivations.
  - raw Anchor instruction builders for all BTC instructions.
- `web/lib/lending-client.ts`
  - decoders for `BtcVaultAccount` and `BitcoinBalanceAttestation`.
  - BTC formatting and liquidation math helpers.

## Devnet deployment

Program:

```text
GQia1ewyLgtkgX7HSfuttJ42qNPpYJhUbxeyCPXtcJFR
```

BTC upgrade deployment:

```text
4B5PoTG2DRrwx3qnAN31UtBmGgmuvpN9LhLED7ECnMEpnn9eWGLt941M56ApCSvuHGKNH3Qsk6qyeMa2qfSEjuAt
```

Program data after upgrade:

```text
ProgramData: 4Mby1BYNvu9MizaPYCynihb7FM2vg48oEqzEBVDYUBin
Last deployed slot: 461667880
Data length: 732520 bytes
```

## Caveats

- This is for **Bitcoin testnet**, not Bitcoin mainnet.
- Ika pre-alpha uses a 1-of-1 mock signer and may wipe state during Alpha 1 migration.
- That is acceptable for tBTC because it has no economic value.
- For mainnet BTC, LendGuard should wait for Ika alpha/mainnet, replace the single admin balance keeper with a quorum/SPV proof, and complete an external audit.

