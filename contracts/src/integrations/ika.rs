// Ika dWallet integration adapter for LendGuard.
//
// The Ika network produces a `MessageApproval` account on Solana after the
// 2PC-MPC signing ceremony completes. This module provides helpers to read
// and validate that account inside the verify_custody_proof instruction.
//
// Pre-alpha note: signing uses a single mock signer, not distributed MPC.
// Production will use 200+ validators with the same account schema.
//
// Ika devnet:
//   gRPC:       https://pre-alpha-dev-1.ika.ika-network.net:443
//   Program ID: 87W54kGYFQ1rgWqMeu4XTPHWXWmXSQCcjm8vCTfiq1oY
// Ref docs:     https://solana-pre-alpha.ika.xyz/

use anchor_lang::prelude::*;

use crate::errors::LendGuardError;

/// Real Ika MessageApproval account layout (per
/// https://solana-pre-alpha.ika.xyz/on-chain/message-approval.html):
///
/// ```text
/// 0       discriminator   (u8 = 14)
/// 1       version         (u8 = 1)
/// 2..34   dwallet         (Pubkey)
/// 34..66  message_hash    (Pubkey-sized: 32 bytes)
/// 66..98  user_pubkey     (32 bytes)
/// 98      signature_scheme (u8: Ed25519=0, Secp256k1=1, Secp256r1=2)
/// 99..131 caller_program  (Pubkey)
/// 131..163 cpi_authority  (Pubkey)
/// 139     status          (u8: Pending=0, Signed=1)        // overlaps cpi_authority window — derived empirically from docs polling example
/// 140..142 signature_len  (u16 LE)
/// 142..270 signature      (padded, up to 128 bytes)
/// ```
///
/// The status byte at offset 139 is documented in the official polling
/// example and is used to wait for the network to sign. We verify it here.
const REAL_MA_DISCRIMINATOR: u8 = 14;
const REAL_MA_VERSION: u8 = 1;
const REAL_MA_MIN_LEN: usize = 142; // through signature_len
const REAL_MA_DWALLET_OFFSET: usize = 2;
const REAL_MA_STATUS_OFFSET: usize = 139;
const REAL_MA_STATUS_SIGNED: u8 = 1;

/// Demo MessageApproval layout (created by `demo_create_message_approval`):
///
/// ```text
/// 0..8    discriminator   (zeros)
/// 8..40   dwallet_id      (32 bytes)
/// 40..48  approved_at     (i64 LE)
/// 48      is_signed       (u8)
/// ```
const DEMO_MA_LEN: usize = 49;
const DEMO_MA_DWALLET_OFFSET: usize = 8;
const DEMO_MA_APPROVED_AT_OFFSET: usize = 40;
const DEMO_MA_SIGNED_OFFSET: usize = 48;

#[derive(Debug)]
pub struct ParsedMessageApproval {
    pub dwallet_id: [u8; 32],
    pub approved_at: i64,
    pub is_signed: bool,
    pub source: ApprovalSource,
}

#[derive(Debug, PartialEq, Eq)]
pub enum ApprovalSource {
    /// Real Ika network MessageApproval (read from the dWallet program).
    RealIka,
    /// LendGuard demo helper (used when the Ika gRPC flow is unavailable).
    DemoHelper,
}

/// Parse and validate the key fields from a MessageApproval account.
///
/// Accepts BOTH:
/// - The real 287-byte MessageApproval owned by the Ika dWallet program
///   (`87W54kGYFQ1rgWqMeu4XTPHWXWmXSQCcjm8vCTfiq1oY`).
/// - The 49-byte demo MessageApproval owned by LendGuard (`demo_create_message_approval`).
///
/// Layout autodetection: the first byte is the discriminator (14 on real
/// MessageApprovals; 0 in our demo helper). Length is the secondary check.
///
/// Freshness: real MessageApproval has no on-chain timestamp; we set
/// `approved_at = 0` and skip the expiry check for the real path. The demo
/// helper still records its `approved_at`, so `current_time` is checked there.
pub fn parse_message_approval(
    message_approval: &AccountInfo,
    expected_dwallet_id: &[u8; 32],
    current_time: i64,
) -> Result<ParsedMessageApproval> {
    let data = message_approval
        .try_borrow_data()
        .map_err(|_| error!(LendGuardError::InvalidMessageApproval))?;

    if data.is_empty() {
        return Err(error!(LendGuardError::InvalidMessageApproval));
    }

    // Real Ika layout starts with discriminator byte 14.
    if data[0] == REAL_MA_DISCRIMINATOR {
        return parse_real(&data, expected_dwallet_id);
    }

    // Demo helper layout: 49 bytes, leading zero discriminator.
    if data.len() == DEMO_MA_LEN {
        return parse_demo(&data, expected_dwallet_id, current_time);
    }

    Err(error!(LendGuardError::InvalidMessageApproval))
}

fn parse_real(
    data: &[u8],
    expected_dwallet_id: &[u8; 32],
) -> Result<ParsedMessageApproval> {
    require!(
        data.len() >= REAL_MA_MIN_LEN,
        LendGuardError::InvalidMessageApproval
    );
    require!(
        data[1] == REAL_MA_VERSION,
        LendGuardError::InvalidMessageApproval
    );

    let mut dwallet_id = [0u8; 32];
    dwallet_id.copy_from_slice(&data[REAL_MA_DWALLET_OFFSET..REAL_MA_DWALLET_OFFSET + 32]);

    let is_signed = data[REAL_MA_STATUS_OFFSET] == REAL_MA_STATUS_SIGNED;

    require!(is_signed, LendGuardError::InvalidMessageApproval);
    require!(
        dwallet_id == *expected_dwallet_id,
        LendGuardError::DWalletMismatch
    );

    Ok(ParsedMessageApproval {
        dwallet_id,
        approved_at: 0,
        is_signed,
        source: ApprovalSource::RealIka,
    })
}

fn parse_demo(
    data: &[u8],
    expected_dwallet_id: &[u8; 32],
    current_time: i64,
) -> Result<ParsedMessageApproval> {
    require!(
        data.len() == DEMO_MA_LEN,
        LendGuardError::InvalidMessageApproval
    );

    let mut dwallet_id = [0u8; 32];
    dwallet_id.copy_from_slice(&data[DEMO_MA_DWALLET_OFFSET..DEMO_MA_DWALLET_OFFSET + 32]);

    let approved_at = i64::from_le_bytes(
        data[DEMO_MA_APPROVED_AT_OFFSET..DEMO_MA_APPROVED_AT_OFFSET + 8]
            .try_into()
            .map_err(|_| error!(LendGuardError::InvalidMessageApproval))?,
    );

    let is_signed = data[DEMO_MA_SIGNED_OFFSET] == 1;

    require!(is_signed, LendGuardError::InvalidMessageApproval);
    require!(
        dwallet_id == *expected_dwallet_id,
        LendGuardError::DWalletMismatch
    );
    require!(
        current_time - approved_at <= crate::constants::PROOF_EXPIRY_SECONDS,
        LendGuardError::ProofExpired
    );

    Ok(ParsedMessageApproval {
        dwallet_id,
        approved_at,
        is_signed,
        source: ApprovalSource::DemoHelper,
    })
}
