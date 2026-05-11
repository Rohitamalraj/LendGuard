import type {
  AdminUnfreezeParams,
  DepositCollateralParams,
  InitializeProtocolParams,
  InitializeRiskStateParams,
  LendGuardClientConfig,
  LendGuardProgramLike,
  RegisterVaultParams,
  TriggerRiskCheckParams,
  TriggerRiskCheckResult,
  UpdateBackingStateParams,
  VerifyCustodyProofParams,
  VerifyCustodyProofResult,
} from "./types.js";

const DEFAULT_PROGRAM_ID = "GQia1ewyLgtkgX7HSfuttJ42qNPpYJhUbxeyCPXtcJFR";

export class LendGuard {
  readonly connection: unknown;
  readonly wallet?: unknown;
  readonly cluster: LendGuardClientConfig["cluster"];
  readonly programId: string;
  readonly program?: LendGuardProgramLike;

  constructor(config: LendGuardClientConfig) {
    this.connection = config.connection;
    this.wallet = config.wallet;
    this.cluster = config.cluster ?? "devnet";
    this.programId = config.programId ?? DEFAULT_PROGRAM_ID;
    this.program = config.program;
  }

  async initializeProtocol(_params?: InitializeProtocolParams): Promise<{ tx: string }> {
    if (this.program) {
      const tx = await this.program.methods
        .initializeProtocol()
        .accounts({ admin: this.wallet })
        .rpc();
      return { tx };
    }
    return { tx: "mock:initialize_protocol" };
  }

  async initializeRiskState(params: InitializeRiskStateParams): Promise<{ tx: string }> {
    this.assertRequired("vaultId", params.vaultId);
    this.assertRequired("thresholdCiphertext", params.thresholdCiphertext);
    if (this.program) {
      const tx = await this.program.methods
        .initializeRiskState(params.thresholdCiphertext)
        .accounts({ vault: params.vaultId, owner: this.wallet })
        .rpc();
      return { tx };
    }
    return { tx: "mock:initialize_risk_state" };
  }

  async depositCollateral(params: DepositCollateralParams): Promise<{ tx: string }> {
    this.assertRequired("vaultId", params.vaultId);
    this.assertRequired("protocolState", params.protocolState);
    if (this.program) {
      const tx = await this.program.methods
        .depositCollateral(params.amount)
        .accounts({
          vault: params.vaultId,
          protocolState: params.protocolState,
          depositor: this.wallet,
        })
        .rpc();
      return { tx };
    }
    return { tx: "mock:deposit_collateral" };
  }

  async adminUnfreeze(params: AdminUnfreezeParams): Promise<{ tx: string }> {
    this.assertRequired("vaultId", params.vaultId);
    this.assertRequired("protocolState", params.protocolState);
    if (this.program) {
      const tx = await this.program.methods
        .adminUnfreeze()
        .accounts({
          vault: params.vaultId,
          protocolState: params.protocolState,
          admin: this.wallet,
        })
        .rpc();
      return { tx };
    }
    return { tx: "mock:admin_unfreeze" };
  }

  async registerVault(params: RegisterVaultParams): Promise<{ vaultId: string }> {
    this.assertRequired("dwalletId", params.dwalletId);
    this.assertRequired("assetType", params.assetType);
    if (this.program) {
      const tx = await this.program.methods
        .registerVault(this.toBytes32(params.dwalletId), this.toAssetType(params.assetType))
        .accounts({
          owner: this.wallet,
        })
        .rpc();
      return { vaultId: tx };
    }
    return { vaultId: `vault:${params.dwalletId}` };
  }

  async verifyCustodyProof(
    params: VerifyCustodyProofParams,
  ): Promise<VerifyCustodyProofResult> {
    this.assertRequired("vaultId", params.vaultId);
    this.assertRequired("expectedDwalletId", params.expectedDwalletId);
    this.assertRequired("messageApproval", params.messageApproval);

    if (this.program) {
      await this.program.methods
        .verifyCustodyProof(this.toBytes32(params.expectedDwalletId))
        .accounts({
          vault: params.vaultId,
          messageApproval: params.messageApproval,
          signer: this.wallet,
        })
        .rpc();
    }

    return {
      isValid: true,
      checkedAt: Date.now(),
    };
  }

  async updateBackingState(params: UpdateBackingStateParams): Promise<{ tx: string }> {
    this.assertRequired("vaultId", params.vaultId);
    this.assertRequired("riskState", params.riskState);
    this.assertRequired("backingCiphertext", params.backingCiphertext);
    if (this.program) {
      const tx = await this.program.methods
        .updateBackingState(params.newBackingAmount)
        .accounts({
          vault: params.vaultId,
          riskState: params.riskState,
          backingCiphertext: params.backingCiphertext,
          oracle: this.wallet,
          payer: this.wallet,
        })
        .rpc();
      return { tx };
    }
    return { tx: "mock:update_backing_state" };
  }

  async triggerRiskCheck(params: TriggerRiskCheckParams): Promise<TriggerRiskCheckResult> {
    this.assertRequired("vaultId", params.vaultId);
    this.assertRequired("riskState", params.riskState);
    this.assertRequired("backingCiphertext", params.backingCiphertext);
    this.assertRequired("thresholdCiphertext", params.thresholdCiphertext);
    this.assertRequired("resultCiphertext", params.resultCiphertext);

    if (this.program) {
      await this.program.methods
        .triggerRiskCheck()
        .accounts({
          vault: params.vaultId,
          riskState: params.riskState,
          backingCiphertext: params.backingCiphertext,
          thresholdCiphertext: params.thresholdCiphertext,
          resultCiphertext: params.resultCiphertext,
          payer: this.wallet,
        })
        .rpc();
    }

    return {
      isSafe: true,
      checkedAt: Date.now(),
    };
  }

  private assertRequired(field: string, value: unknown): void {
    if (value === undefined || value === null || value === "") {
      throw new Error(`Missing required field: ${field}`);
    }
  }

  private toAssetType(asset: RegisterVaultParams["assetType"]): number {
    if (asset === "BTC") return 0;
    if (asset === "ETH") return 1;
    return 2;
  }

  private toBytes32(value: string): number[] {
    const bytes = new TextEncoder().encode(value);
    const output = new Array<number>(32).fill(0);
    const len = Math.min(bytes.length, 32);
    for (let i = 0; i < len; i += 1) {
      output[i] = bytes[i];
    }
    return output;
  }
}

