// Encrypt integration adapter — autodetect demo vs real Encrypt ciphertext layouts.
//
// Real Encrypt ciphertext layout (from `encrypt-solana-types::accounts`,
// crate `encrypt-types`, file `chains/solana/program-sdk/types/src/accounts.rs`):
//
//   offset  0..2   discriminator + version
//   offset  2..34  ciphertext_digest        (32 bytes)
//   offset 34..66  authorized               (32 bytes)
//   offset 66..98  network_encryption_pubkey(32 bytes)
//   offset 98      fhe_type                 (1 byte)
//   offset 99      status                   (1 byte: 0=Pending, 1=Verified)
//   total          100 bytes
//
// Demo helper layout (from `instructions::demo_helpers::demo_create_ciphertext`):
//
//   offset 0       value byte               (0=false, non-zero=true)
//
// The reader inspects the data length and a discriminator heuristic to decide
// which path to take, so steps 2/5 of the demo continue working while a real
// Encrypt `execute_graph` flow can drop in later (already wired off-chain in
// `web/lib/encrypt-client.ts`).

use anchor_lang::prelude::*;

use crate::errors::LendGuardError;

// ── Real Encrypt ciphertext offsets (mirrors `encrypt_solana_types::accounts`)
const CT_DIGEST_OFFSET: usize = 2;
const CT_FHE_TYPE_OFFSET: usize = 98;
const CT_STATUS_OFFSET: usize = 99;
const CT_LEN: usize = 100;
const CT_STATUS_VERIFIED: u8 = 1;
const FHE_TYPE_EBOOL: u8 = 1;

/// Source of a parsed EBool — useful for events/logs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EBoolSource {
    /// Real Encrypt-program-owned 100-byte ciphertext, status=Verified.
    RealEncrypt,
    /// LendGuard demo helper account (1+ byte plaintext).
    DemoHelper,
}

/// Parse an EBool from a ciphertext-shaped account, autodetecting demo vs real
/// Encrypt layouts. Use `read_mocked_ebool` if you only need the boolean.
pub fn parse_ebool(result_ciphertext: &AccountInfo) -> Result<(bool, EBoolSource)> {
    require!(
        !result_ciphertext.key().eq(&Pubkey::default()),
        LendGuardError::InvalidCiphertextAccount
    );

    let data = result_ciphertext
        .try_borrow_data()
        .map_err(|_| error!(LendGuardError::InvalidCiphertextAccount))?;

    require!(!data.is_empty(), LendGuardError::InvalidCiphertextAccount);

    if looks_like_real_encrypt(&data) {
        let value = read_real_encrypt_ebool(&data)?;
        return Ok((value, EBoolSource::RealEncrypt));
    }

    // Fallback to demo helper layout: byte[0] is the value.
    Ok((data[0] != 0, EBoolSource::DemoHelper))
}

/// Backwards-compatible single-bool reader. Prefer `parse_ebool` if you also
/// want to know which layout was matched.
pub fn read_mocked_ebool(result_ciphertext: &AccountInfo) -> Result<bool> {
    let (value, _source) = parse_ebool(result_ciphertext)?;
    Ok(value)
}

// ── Helpers ────────────────────────────────────────────────────────────────

/// Treat the buffer as a real Encrypt ciphertext if (a) it's at least 100
/// bytes long, (b) its `fhe_type` byte at offset 98 is the EBool tag, and
/// (c) its `status` byte is one of the known values (0 or 1).
fn looks_like_real_encrypt(data: &[u8]) -> bool {
    if data.len() < CT_LEN {
        return false;
    }
    let fhe_type = data[CT_FHE_TYPE_OFFSET];
    let status = data[CT_STATUS_OFFSET];
    fhe_type == FHE_TYPE_EBOOL && status <= CT_STATUS_VERIFIED
}

/// Read the boolean value out of a real Encrypt ciphertext account. The status
/// must be Verified (graph executor has committed the result).
///
/// The EBool's "value" is encoded in the 32-byte ciphertext_digest. On the
/// Encrypt pre-alpha (no real FHE on devnet), the executor populates the
/// digest with `keccak256(value || padding)`. We accept the convention used
/// by the executor's mock path: low bit of the digest = boolean.
fn read_real_encrypt_ebool(data: &[u8]) -> Result<bool> {
    let status = data[CT_STATUS_OFFSET];
    require!(
        status == CT_STATUS_VERIFIED,
        LendGuardError::InvalidCiphertextAccount
    );

    let digest = &data[CT_DIGEST_OFFSET..CT_DIGEST_OFFSET + 32];
    // In the pre-alpha mock executor, byte 0 of the digest is the plaintext
    // boolean (matches `encode_mock_digest(EBool, value)` in the DSL test
    // utilities). Once real FHE is live, this becomes a real homomorphic
    // ciphertext and decryption goes through `request_decryption` instead —
    // the program-side consumer doesn't need to change here, the off-chain
    // executor is the one that switches code paths.
    Ok(digest[0] != 0)
}
