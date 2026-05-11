/**
 * Bitcoin testnet address derivation from a Secp256k1 compressed public key.
 *
 * Used by the LendGuard BTC collateral flow: Ika produces a 33-byte
 * compressed Secp256k1 pubkey via DKG, we derive the corresponding
 * P2WPKH (`tb1q…`) address client-side so the keeper can poll its balance
 * and the user can fund it from a faucet.
 *
 * No external Bitcoin library required — uses `@noble/hashes` for the
 * SHA-256 + RIPEMD-160 hash160 step and `bech32` for the BIP173 encoding.
 *
 * P2WPKH derivation (BIP141 / BIP173):
 *   hash160       = ripemd160(sha256(compressedPubkey))
 *   witness_prog  = [version=0x00] || hash160 (20 bytes)
 *   address       = bech32_encode(hrp="tb", [0] ++ to5bit(hash160))
 *
 * Testnet HRP is "tb" (mainnet would be "bc").
 */

import { bech32 } from "bech32";
import { ripemd160 } from "@noble/hashes/ripemd160";
import { sha256 } from "@noble/hashes/sha256";

/** Bitcoin testnet bech32 human-readable prefix. */
export const BTC_TESTNET_HRP = "tb";

/**
 * Convert a compressed Secp256k1 public key (33 bytes, starting with 0x02 or
 * 0x03) into its corresponding P2WPKH Bitcoin testnet address.
 *
 * Throws if the input is malformed.
 */
export function secp256k1PubkeyToTestnetP2WPKH(
  compressedPubkey: Uint8Array,
): string {
  if (compressedPubkey.length !== 33) {
    throw new Error(
      `Expected 33-byte compressed Secp256k1 pubkey, got ${compressedPubkey.length}`,
    );
  }
  if (compressedPubkey[0] !== 0x02 && compressedPubkey[0] !== 0x03) {
    throw new Error(
      `Compressed pubkey must start with 0x02 or 0x03, got 0x${compressedPubkey[0].toString(16)}`,
    );
  }

  const sha = sha256(compressedPubkey);
  const hash160 = ripemd160(sha);
  if (hash160.length !== 20) {
    throw new Error(`hash160 must be 20 bytes, got ${hash160.length}`);
  }

  const words = [0, ...bech32.toWords(hash160)];
  return bech32.encode(BTC_TESTNET_HRP, words);
}

/**
 * Decode a `tb1q…` testnet address back into its 20-byte witness program.
 * Returns null if the address is not a valid P2WPKH testnet address.
 */
export function testnetP2WPKHToHash160(address: string): Uint8Array | null {
  try {
    const decoded = bech32.decode(address);
    if (decoded.prefix !== BTC_TESTNET_HRP) return null;
    if (decoded.words.length === 0 || decoded.words[0] !== 0) return null;
    const program = new Uint8Array(bech32.fromWords(decoded.words.slice(1)));
    if (program.length !== 20) return null;
    return program;
  } catch {
    return null;
  }
}

/**
 * URL of a public Bitcoin testnet faucet that pays small amounts of tBTC
 * to a user-supplied address. Used by the UI to provide a one-click flow
 * for funding a freshly-derived `tb1q…` LendGuard vault.
 */
export const BTC_TESTNET_FAUCETS = [
  "https://coinfaucet.eu/en/btc-testnet/",
  "https://bitcoinfaucet.uo1.net/",
  "https://testnet-faucet.com/btc-testnet/",
];

/**
 * Public mempool.space testnet base URL. Used both client-side (for the
 * "open in explorer" link) and by the balance keeper (for polling
 * `/api/address/{addr}` and `/api/blocks/tip/height|hash`).
 */
export const MEMPOOL_SPACE_TESTNET = "https://mempool.space/testnet";

/** Convenience: build the explorer link for an address. */
export function mempoolAddressUrl(address: string): string {
  return `${MEMPOOL_SPACE_TESTNET}/address/${address}`;
}

/** Convenience: build the explorer link for a tx id (hex string). */
export function mempoolTxUrl(txid: string): string {
  return `${MEMPOOL_SPACE_TESTNET}/tx/${txid}`;
}
