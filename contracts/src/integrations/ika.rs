// Ika dWallet integration adapter for LendGuard.
//
// The Ika network produces a MessageApproval account on Solana after the
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

use crate::constants::PROOF_EXPIRY_SECONDS;
use crate::errors::LendGuardError;

/// Minimal parsed view of a MessageApproval account.
/// Full schema is at ika-system-types crate; this reflects the fields
/// LendGuard needs for custody proof validation.
pub struct ParsedMessageApproval {
    pub dwallet_id: [u8; 32],
    pub approved_at: i64,
    pub is_signed: bool,
}

/// Parse and validate the key fields from an Ika MessageApproval account.
///
/// Pre-alpha: we read raw account bytes using the discriminator + offset
/// layout described in the ika-system-types crate. Once ika-sdk-types
/// stabilises its Anchor account derive, replace with a typed
/// `Account<'info, MessageApproval>` constraint.
pub fn parse_message_approval(
    message_approval: &AccountInfo,
    expected_dwallet_id: &[u8; 32],
    current_time: i64,
) -> Result<ParsedMessageApproval> {
    // DEVNET MODE: Skip validation for uninitialized accounts
    // In production, the IKA network initializes MessageApproval accounts
    #[cfg(feature = "devnet")]
    {
        msg!("⚠️  DEVNET MODE: Using relaxed MessageApproval validation");
        
        let data = message_approval
            .try_borrow_data()
            .map_err(|_| error!(LendGuardError::InvalidMessageApproval))?;

        if data.len() < 49 {
            return Err(error!(LendGuardError::InvalidMessageApproval));
        }

        // Check if account is uninitialized (all zeros)
        let mut dwallet_id = [0u8; 32];
        dwallet_id.copy_from_slice(&data[8..40]);
        
        // If uninitialized, accept it for devnet testing
        if dwallet_id == [0u8; 32] {
            msg!("   Accepting uninitialized MessageApproval for devnet testing");
            return Ok(ParsedMessageApproval {
                dwallet_id: *expected_dwallet_id,
                approved_at: current_time,
                is_signed: true,
            });
        }
        
        // Otherwise, do normal validation
    }

    let data = message_approval
        .try_borrow_data()
        .map_err(|_| error!(LendGuardError::InvalidMessageApproval))?;

    // Minimum layout: 8 (discriminator) + 32 (dwallet_id) + 8 (timestamp) + 1 (status)
    require!(data.len() >= 49, LendGuardError::InvalidMessageApproval);

    // Bytes 8..40 → dwallet_id
    let mut dwallet_id = [0u8; 32];
    dwallet_id.copy_from_slice(&data[8..40]);

    // Bytes 40..48 → approved_at (i64 LE)
    let approved_at = i64::from_le_bytes(
        data[40..48]
            .try_into()
            .map_err(|_| error!(LendGuardError::InvalidMessageApproval))?,
    );

    // Byte 48 → is_signed (1 = approved by MPC network)
    let is_signed = data[48] == 1;

    require!(is_signed, LendGuardError::InvalidMessageApproval);
    require!(
        dwallet_id == *expected_dwallet_id,
        LendGuardError::DWalletMismatch
    );
    require!(
        current_time - approved_at <= PROOF_EXPIRY_SECONDS,
        LendGuardError::ProofExpired
    );

    Ok(ParsedMessageApproval {
        dwallet_id,
        approved_at,
        is_signed,
    })
}
