import type { AdminUnfreezeParams, DepositCollateralParams, InitializeProtocolParams, InitializeRiskStateParams, LendGuardClientConfig, LendGuardProgramLike, RegisterVaultParams, TriggerRiskCheckParams, TriggerRiskCheckResult, UpdateBackingStateParams, VerifyCustodyProofParams, VerifyCustodyProofResult } from "./types.js";
export declare class LendGuard {
    readonly connection: unknown;
    readonly wallet?: unknown;
    readonly cluster: LendGuardClientConfig["cluster"];
    readonly programId: string;
    readonly program?: LendGuardProgramLike;
    constructor(config: LendGuardClientConfig);
    initializeProtocol(_params?: InitializeProtocolParams): Promise<{
        tx: string;
    }>;
    initializeRiskState(params: InitializeRiskStateParams): Promise<{
        tx: string;
    }>;
    depositCollateral(params: DepositCollateralParams): Promise<{
        tx: string;
    }>;
    adminUnfreeze(params: AdminUnfreezeParams): Promise<{
        tx: string;
    }>;
    registerVault(params: RegisterVaultParams): Promise<{
        vaultId: string;
    }>;
    verifyCustodyProof(params: VerifyCustodyProofParams): Promise<VerifyCustodyProofResult>;
    updateBackingState(params: UpdateBackingStateParams): Promise<{
        tx: string;
    }>;
    triggerRiskCheck(params: TriggerRiskCheckParams): Promise<TriggerRiskCheckResult>;
    private assertRequired;
    private toAssetType;
    private toBytes32;
}
