export type Cluster = "devnet" | "testnet" | "mainnet-beta";

export interface LendGuardClientConfig {
  connection: unknown;
  wallet?: unknown;
  cluster?: Cluster;
  programId?: string;
  program?: LendGuardProgramLike;
}

export type AssetType = "BTC" | "ETH" | "SOL";

export interface RegisterVaultParams {
  dwalletId: string;
  assetType: AssetType;
}

export interface VerifyCustodyProofParams {
  vaultId: string;
  expectedDwalletId: string;
  messageApproval: string;
}

export interface VerifyCustodyProofResult {
  isValid: boolean;
  checkedAt: number;
}

export interface TriggerRiskCheckParams {
  vaultId: string;
  riskState: string;
  backingCiphertext: string;
  thresholdCiphertext: string;
  resultCiphertext: string;
}

export interface TriggerRiskCheckResult {
  isSafe: boolean;
  checkedAt: number;
}

export interface InitializeProtocolParams {
  admin: string;
}

export interface InitializeRiskStateParams {
  vaultId: string;
  thresholdCiphertext: string;
}

export interface DepositCollateralParams {
  vaultId: string;
  protocolState: string;
  amount: bigint;
}

export interface AdminUnfreezeParams {
  vaultId: string;
  protocolState: string;
}

export interface UpdateBackingStateParams {
  vaultId: string;
  riskState: string;
  backingCiphertext: string;
  newBackingAmount: bigint;
}

export interface LendGuardProgramLike {
  methods: {
    initializeProtocol: () => MethodBuilderLike;
    initializeRiskState: (thresholdCiphertext: string) => MethodBuilderLike;
    registerVault: (dwalletId: number[], assetType: number) => MethodBuilderLike;
    verifyCustodyProof: (dwalletId: number[]) => MethodBuilderLike;
    depositCollateral: (amount: bigint) => MethodBuilderLike;
    updateBackingState: (newBackingAmount: bigint) => MethodBuilderLike;
    triggerRiskCheck: () => MethodBuilderLike;
    circuitBreakerFreeze: (reason: string) => MethodBuilderLike;
    adminUnfreeze: () => MethodBuilderLike;
  };
}

export interface MethodBuilderLike {
  accounts: (accounts: Record<string, unknown>) => MethodBuilderLike;
  rpc: () => Promise<string>;
}
