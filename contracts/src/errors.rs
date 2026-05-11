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

    #[msg("Invalid lending pool parameter")]
    InvalidLendingPoolParameter,

    #[msg("Invalid borrow amount")]
    InvalidBorrowAmount,

    #[msg("Insufficient pool liquidity")]
    InsufficientPoolLiquidity,

    #[msg("Borrow would exceed collateral LTV")]
    BorrowExceedsCollateralLtv,

    #[msg("Borrow position has outstanding debt")]
    OutstandingDebt,

    #[msg("Invalid repay amount")]
    InvalidRepayAmount,

    #[msg("Price feed is stale")]
    PriceFeedStale,

    #[msg("Position is healthy and cannot be liquidated")]
    PositionHealthy,

    #[msg("Position has no outstanding debt")]
    NoOutstandingDebt,

    #[msg("Liquidator cannot liquidate their own position")]
    SelfLiquidation,

    #[msg("Pool token vault mismatch")]
    PoolTokenVaultMismatch,

    #[msg("Borrow asset mint mismatch")]
    BorrowAssetMintMismatch,

    #[msg("Token account owner mismatch")]
    TokenAccountOwnerMismatch,

    #[msg("Insufficient collateral lamports for liquidation")]
    InsufficientCollateralLamports,

    #[msg("Encrypted liquidation gate did not authorise the liquidation")]
    LiquidationNotAuthorised,

    // ─── Bitcoin testnet collateral path ─────────────────────────────────
    #[msg("Invalid Secp256k1 dWallet public key (must be 33 bytes compressed)")]
    InvalidDwalletPubkey,

    #[msg("Invalid Bitcoin testnet address (must be non-empty bech32 'tb…' under 63 bytes)")]
    InvalidBitcoinAddress,

    #[msg("Bitcoin balance attestation is stale; ask the keeper to refresh before borrowing")]
    BitcoinAttestationStale,

    #[msg("Attestation refers to a different vault or address than the one supplied")]
    BitcoinAttestationMismatch,

    #[msg("Caller is not the authorised BTC balance keeper")]
    KeeperNotAuthorised,

    #[msg("BTC vault custody proof has not been verified yet")]
    BtcVaultNotVerified,

    #[msg("BTC vault is frozen")]
    BtcVaultFrozen,

    #[msg("BTC vault already has an outstanding borrow position")]
    BtcVaultHasOpenDebt,

    #[msg("BTC liquidation has not been initiated for this position")]
    BtcLiquidationNotInitiated,

    #[msg("BTC liquidation is already in flight; wait for the broadcaster keeper to finalise")]
    BtcLiquidationAlreadyInitiated,

    #[msg("Bitcoin tx sighash submitted does not match the one committed on-chain at liquidation time")]
    BitcoinLiquidationSighashMismatch,

    #[msg("Bitcoin tx confirmations submitted are below the protocol minimum")]
    BitcoinConfirmationsInsufficient,

    #[msg("Insufficient tBTC collateral for the requested borrow")]
    InsufficientBtcCollateral,
}
