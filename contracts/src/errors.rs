use anchor_lang::prelude::*;

#[error_code]
pub enum LendGuardError {
    #[msg("Vault is not verified")]
    VaultNotVerified,

    #[msg("Vault is frozen")]
    VaultFrozen,

    #[msg("Protocol is frozen")]
    ProtocolFrozen,

    #[msg("Proof has expired")]
    ProofExpired,

    #[msg("Invalid proof amount")]
    InvalidProofAmount,

    #[msg("DWallet ID mismatch")]
    DWalletMismatch,

    #[msg("Invalid message approval account")]
    InvalidMessageApproval,

    #[msg("Insufficient collateral amount")]
    InsufficientCollateral,

    #[msg("Invalid asset type")]
    InvalidAssetType,

    #[msg("Unauthorized caller")]
    UnauthorizedCaller,

    #[msg("Risk check failed")]
    RiskCheckFailed,

    #[msg("Invalid Ika program")]
    InvalidIkaProgram,

    #[msg("Invalid Encrypt program")]
    InvalidEncryptProgram,

    #[msg("Invalid ciphertext account")]
    InvalidCiphertextAccount,

    #[msg("Arithmetic overflow")]
    ArithmeticOverflow,

    #[msg("Invalid timestamp")]
    InvalidTimestamp,

    #[msg("Vault already verified")]
    VaultAlreadyVerified,

    #[msg("Vault not found")]
    VaultNotFound,

    #[msg("Invalid withdrawal amount")]
    InvalidWithdrawalAmount,

    #[msg("Invalid deposit amount")]
    InvalidDepositAmount,
}
