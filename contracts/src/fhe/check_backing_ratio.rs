// Encrypt REFHE — FHE computation graph for LendGuard risk evaluation.
//
// This function is compiled by the `#[encrypt_fn]` macro into a DAG of FHE
// operations. The Encrypt off-chain executor evaluates it on EUint64 ciphertexts
// and commits an EBool result account on Solana.
//
// Pre-alpha note: on devnet all values are stored as plaintext. The same code
// will provide real FHE privacy on Encrypt mainnet with zero changes.
//
// Endpoint:  pre-alpha-dev-1.encrypt.ika-network.net:443
// Program:   4ebfzWdKnrnGseuQpezXdG8yCdHqwQ1SSBHD3bWArND8
// Ref docs:  https://docs.encrypt.xyz/

use encrypt_dsl::prelude::*;

/// Evaluates whether the vault's backing ratio is at or above the threshold.
///
/// Arguments (all EUint64 ciphertexts supplied by the executor):
///   current_backing — total lamport-equivalent collateral locked in the vault
///   total_minted    — total lamports issued against this vault
///   threshold       — minimum acceptable ratio × 100 (e.g. 95 means 95%)
///
/// Returns an EBool:
///   true  → backing ratio is healthy, deposits allowed
///   false → backing ratio below threshold, circuit breaker should fire
#[encrypt_fn]
pub fn check_backing_ratio(
    current_backing: EUint64,
    total_minted: EUint64,
    threshold: EUint64,
) -> EBool {
    // ratio = (current_backing * 100) / total_minted
    let scaled = current_backing * 100u64;
    let ratio = scaled / total_minted;
    ratio >= threshold
}
