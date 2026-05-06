use anchor_lang::prelude::*;

use crate::errors::LendGuardError;

/// Pre-alpha adapter for Encrypt risk outputs.
///
/// Current behavior:
/// - expects `result_ciphertext` data first byte to represent a mocked boolean
/// - `0` => false (unsafe), any non-zero => true (safe)
///
/// This isolates parsing logic so we can swap to real Encrypt account decoding
/// once `execute_graph` + result schemas are finalized.
pub fn read_mocked_ebool(result_ciphertext: &AccountInfo) -> Result<bool> {
    require!(
        !result_ciphertext.key().eq(&Pubkey::default()),
        LendGuardError::InvalidCiphertextAccount
    );

    let data = result_ciphertext
        .try_borrow_data()
        .map_err(|_| error!(LendGuardError::InvalidCiphertextAccount))?;

    require!(!data.is_empty(), LendGuardError::InvalidCiphertextAccount);

    Ok(data[0] != 0)
}
