"use client";

import { useState, useCallback, useMemo } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConnectWalletButton } from "@/components/wallet/connect-wallet-button";
import {
  CheckCircle,
  XCircle,
  AlertTriangle,
  Lock,
  Shield,
  Zap,
  ArrowRight,
  RotateCcw,
  ExternalLink,
} from "lucide-react";
import type { DemoVaultState } from "@/lib/lendguard-client";
import { buildInitialDemoState } from "@/lib/lendguard-client";
import { PROGRAM_ID as LENDGUARD_PROGRAM_ID } from "@/lib/lendguard-client";
import { PublicKey } from "@solana/web3.js";
import {
  accountExists,
  buildDemoCreateCiphertextIx,
  buildDemoCreateMessageApprovalIx,
  buildDepositCollateralIx,
  buildInitializeProtocolIx,
  buildInitializeRiskStateIx,
  buildRegisterVaultIx,
  buildTriggerRiskCheckIx,
  buildUnfreezeProtocolStateIx,
  buildUpdateBackingStateIx,
  buildVerifyCustodyProofIx,
  deriveProtocolStatePda,
  deriveRiskStatePda,
  explorerAccountUrl,
  explorerTxUrl,
  generateDemoDwalletId,
  readProtocolFrozen,
  sendIx,
} from "@/lib/program-actions";
import {
  ENCRYPT_GRPC_URL,
  ENCRYPT_PROGRAM_ID,
  FHE_TYPES,
  createEncryptInputs,
} from "@/lib/encrypt-client";
import { IKA_GRPC_URL, IKA_PROGRAM_ID } from "@/lib/ika-client";
import { runRealIkaFlow } from "@/lib/ika-flow";

// ─── Demo constants ───────────────────────────────────────────────────────────
const DEPOSIT_AMOUNT_SOL = 0.05; // small enough to keep tx cheap; user can edit
const NORMAL_BACKING_RATIO = 100;
const EXPLOIT_BACKING_RATIO = 85;
const THRESHOLD_RATIO = 95;

type Step = 1 | 2 | 3 | 4 | 5 | 6;
type EventLog = {
  step: Step;
  status: "ok" | "fail" | "warn";
  message: string;
  tx?: string;
  account?: string;
};

interface VaultSession {
  vaultPda: PublicKey;
  dwalletIdBytes: Uint8Array;
  dwalletIdLabel: string;
  messageApprovalPda?: PublicKey;
  riskStatePda?: PublicKey;
  thresholdCiphertextPda?: PublicKey;
  backingCiphertextPda?: PublicKey;
  resultCiphertextPda?: PublicKey;
}

// ─── Demo page ────────────────────────────────────────────────────────────────
export default function DemoPage() {
  const { connection } = useConnection();
  const { publicKey, signTransaction, connected } = useWallet();

  const [currentStep, setCurrentStep] = useState<Step>(1);
  const [running, setRunning] = useState(false);
  const [vaultState, setVaultState] = useState<DemoVaultState | null>(null);
  const [session, setSession] = useState<VaultSession | null>(null);
  const [log, setLog] = useState<EventLog[]>([]);

  const owner = publicKey;

  const addLog = useCallback(
    (
      step: Step,
      status: EventLog["status"],
      message: string,
      extra?: { tx?: string; account?: string },
    ) => {
      setLog((prev) => [...prev, { step, status, message, ...extra }]);
    },
    [],
  );

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const reset = () => {
    setCurrentStep(1);
    setVaultState(null);
    setSession(null);
    setLog([]);
    setRunning(false);
  };

  // ── Helper: ensure protocol state PDA exists; init if not ────────────────
  const ensureProtocolInitialized = useCallback(async (): Promise<void> => {
    if (!owner || !signTransaction) return;
    const [protocolStatePda] = deriveProtocolStatePda();
    const exists = await accountExists(connection, protocolStatePda);
    if (!exists) {
      addLog(1, "warn", `protocol_state PDA not found — initializing now…`);
      const ix = await buildInitializeProtocolIx(owner);
      const sig = await sendIx(ix, {
        connection,
        payer: owner,
        signTransaction,
      });
      addLog(1, "ok", `initialize_protocol() confirmed`, { tx: sig });
      return;
    }

    addLog(1, "ok", `protocol_state PDA already initialized`, {
      account: protocolStatePda.toBase58(),
    });

    // The protocol_state PDA is a singleton — once a previous demo run fires
    // the circuit breaker, every subsequent deposit fails with ProtocolFrozen
    // until we unfreeze. Auto-unfreeze here so `npm run demo` is replayable.
    const frozen = await readProtocolFrozen(connection);
    if (frozen) {
      addLog(
        1,
        "warn",
        `protocol_state.frozen = true (carry-over from prior run) — calling unfreeze_protocol_state…`,
      );
      const ix = await buildUnfreezeProtocolStateIx(owner);
      const sig = await sendIx(ix, {
        connection,
        payer: owner,
        signTransaction,
      });
      addLog(1, "ok", `unfreeze_protocol_state() confirmed`, { tx: sig });
    }
  }, [owner, signTransaction, connection, addLog]);

  // ── Step 1: register_vault (REAL on-chain) ───────────────────────────────
  const step1RegisterVault = async () => {
    if (!owner || !signTransaction) return;
    setRunning(true);
    try {
      addLog(1, "ok", `Starting on-chain register_vault…`);
      await ensureProtocolInitialized();

      const dwId = await generateDemoDwalletId(owner, "btc-vault");
      const dwIdLabel = `ika:btc:${owner.toBase58().slice(0, 6)}:${Date.now()
        .toString()
        .slice(-4)}`;

      const { ix, vaultPda } = await buildRegisterVaultIx({
        owner,
        dwalletId: dwId,
        assetType: 0,
      });
      addLog(1, "ok", `Derived vault PDA`, { account: vaultPda.toBase58() });

      const sig = await sendIx(ix, {
        connection,
        payer: owner,
        signTransaction,
      });

      const newSession: VaultSession = {
        vaultPda,
        dwalletIdBytes: dwId,
        dwalletIdLabel: dwIdLabel,
      };
      setSession(newSession);

      const state = buildInitialDemoState(owner, dwIdLabel);
      state.vaultPda = vaultPda.toBase58();
      setVaultState(state);

      addLog(1, "ok", `register_vault() confirmed on devnet ✅`, { tx: sig });
      addLog(1, "ok", `Vault state: PENDING — no Ika custody proof yet`);
      setCurrentStep(2);
    } catch (e: unknown) {
      addLog(1, "fail", `Failed: ${friendlyError(e)}`);
    } finally {
      setRunning(false);
    }
  };

  // ── Step 2: verify_custody_proof (REAL on-chain) ─────────────────────────
  const step2VerifyProof = async () => {
    if (!owner || !signTransaction || !session) return;
    setRunning(true);
    try {
      addLog(
        2,
        "warn",
        `Production: Ika 2PC-MPC network produces MessageApproval. Demo: program-side mock helper writes the same byte layout.`,
      );

      // 1) Create the mock MessageApproval account via demo helper
      const { ix: createIx, messageApprovalPda } =
        await buildDemoCreateMessageApprovalIx({
          payer: owner,
          dwalletId: session.dwalletIdBytes,
          isSigned: true,
        });
      addLog(2, "ok", `Building demo_create_message_approval()`, {
        account: messageApprovalPda.toBase58(),
      });

      // 2) verify_custody_proof reads that account
      const verifyIx = await buildVerifyCustodyProofIx({
        owner,
        vaultPda: session.vaultPda,
        messageApprovalPda,
        expectedDwalletId: session.dwalletIdBytes,
      });

      const sig = await sendIx([createIx, verifyIx], {
        connection,
        payer: owner,
        signTransaction,
      });
      addLog(2, "ok", `verify_custody_proof() confirmed ✅`, { tx: sig });
      addLog(
        2,
        "ok",
        `parse_message_approval(): is_signed ✓, dWallet ID ✓, freshness ✓`,
      );

      setSession({ ...session, messageApprovalPda });
      setVaultState((s) =>
        s ? { ...s, proofStatus: "VERIFIED", lastEvent: "ProofVerified" } : s,
      );
      setCurrentStep(3);
    } catch (e: unknown) {
      addLog(2, "fail", `Failed: ${friendlyError(e)}`);
    } finally {
      setRunning(false);
    }
  };

  // ── Step 3: deposit_collateral happy path (REAL on-chain) ────────────────
  const step3Deposit = async () => {
    if (!owner || !signTransaction || !session) return;
    setRunning(true);
    try {
      const lamports = BigInt(Math.floor(DEPOSIT_AMOUNT_SOL * 1_000_000_000));
      const ix = await buildDepositCollateralIx({
        owner,
        vaultPda: session.vaultPda,
        amountLamports: lamports,
      });
      addLog(3, "ok", `deposit_collateral(${DEPOSIT_AMOUNT_SOL} SOL): submitting…`);
      const sig = await sendIx(ix, {
        connection,
        payer: owner,
        signTransaction,
      });
      addLog(3, "ok", `Deposit accepted on-chain ✅`, { tx: sig });
      addLog(3, "ok", `proof_status == VERIFIED ✓, frozen == false ✓`);

      const amount = BigInt(Math.floor(DEPOSIT_AMOUNT_SOL * 1_000_000_000));
      setVaultState((s) =>
        s
          ? {
              ...s,
              depositedAmount: amount,
              backingRatio: NORMAL_BACKING_RATIO,
              lastEvent: "CollateralDeposited",
            }
          : s,
      );
      setCurrentStep(4);
    } catch (e: unknown) {
      addLog(3, "fail", `Failed: ${friendlyError(e)}`);
    } finally {
      setRunning(false);
    }
  };

  // ── Step 4: simulate exploit + initialize_risk_state + update_backing ────
  // Real Encrypt path: backing & threshold ciphertexts are produced by the
  // pre-alpha Encrypt executor via gRPC-Web. The executor signs the on-chain
  // create_input_ciphertext tx and returns the resulting ciphertext PDAs,
  // which we then thread into our LendGuard `initialize_risk_state` and
  // `update_backing_state` instructions.
  const step4Exploit = async () => {
    if (!owner || !signTransaction || !session) return;
    setRunning(true);
    try {
      addLog(4, "warn", `⚠ Simulating bridge validator compromise…`);
      addLog(
        4,
        "warn",
        `Forged bridge message: 'backing ratio still 100%' (NOT via Ika dWallet)`,
      );
      addLog(
        4,
        "warn",
        `Backing ratio drops silently: 100% → ${EXPLOIT_BACKING_RATIO}%`,
      );

      // 1) Real Encrypt: ask the executor to encrypt threshold (95) and backing
      //    (85) and create on-chain ciphertext PDAs. The user's wallet does
      //    NOT sign these — the executor pays rent and creates the accounts.
      addLog(
        4,
        "ok",
        `Calling Encrypt gRPC ${new URL(ENCRYPT_GRPC_URL).host} → createInput`,
      );
      const [thresholdPda, backingPda] = await createEncryptInputs([
        {
          value: THRESHOLD_RATIO,
          fheType: FHE_TYPES.EUint64,
          authorizedProgram: LENDGUARD_PROGRAM_ID,
        },
        {
          value: EXPLOIT_BACKING_RATIO,
          fheType: FHE_TYPES.EUint64,
          authorizedProgram: LENDGUARD_PROGRAM_ID,
        },
      ]);
      addLog(4, "ok", `Encrypt threshold ciphertext (EUint64=${THRESHOLD_RATIO})`, {
        account: thresholdPda.toBase58(),
      });
      addLog(4, "ok", `Encrypt backing ciphertext (EUint64=${EXPLOIT_BACKING_RATIO})`, {
        account: backingPda.toBase58(),
      });

      // 2) LendGuard txs: initialize_risk_state(thresholdPda) and
      //    update_backing_state(backingPda). Our program just stores the
      //    pubkeys — no Encrypt CPI yet; that's the next milestone.
      const [riskStatePda] = deriveRiskStatePda(session.vaultPda);
      const initRiskIx = await buildInitializeRiskStateIx({
        owner,
        vaultPda: session.vaultPda,
        thresholdCiphertext: thresholdPda,
      });
      const updateIx = await buildUpdateBackingStateIx({
        owner,
        vaultPda: session.vaultPda,
        backingCiphertextPda: backingPda,
        newBackingAmount: BigInt(EXPLOIT_BACKING_RATIO),
      });

      const sig = await sendIx([initRiskIx, updateIx], {
        connection,
        payer: owner,
        signTransaction,
      });
      addLog(4, "ok", `risk_state PDA initialized`, {
        account: riskStatePda.toBase58(),
      });
      addLog(4, "ok", `update_backing_state() confirmed ✅`, { tx: sig });

      setSession({
        ...session,
        riskStatePda,
        thresholdCiphertextPda: thresholdPda,
        backingCiphertextPda: backingPda,
      });
      setVaultState((s) =>
        s
          ? {
              ...s,
              backingRatio: EXPLOIT_BACKING_RATIO,
              lastEvent: "BackingDropDetected",
            }
          : s,
      );
      setCurrentStep(5);
    } catch (e: unknown) {
      addLog(4, "fail", `Failed: ${friendlyError(e)}`);
    } finally {
      setRunning(false);
    }
  };

  // ── Step 5: trigger_risk_check (REAL on-chain) — freezes vault ───────────
  // Real Encrypt would run check_backing_ratio(backing, 100, threshold) via
  // execute_graph and commit an EBool result. That requires a CPI from
  // LendGuard into the Encrypt program — a contract change on top of the
  // already-real input ciphertexts in step 4. Until that lands, we drop a
  // demo-helper EBool=false next to the real ciphertexts so the on-chain
  // circuit breaker still fires deterministically.
  const step5RiskCheck = async () => {
    if (!owner || !signTransaction || !session) return;
    if (!session.thresholdCiphertextPda || !session.backingCiphertextPda) {
      addLog(5, "fail", `Missing risk-state setup from step 4`);
      return;
    }
    setRunning(true);
    try {
      addLog(
        5,
        "warn",
        `Production: Encrypt execute_graph(check_backing_ratio) → EBool. Demo: LendGuard helper writes EBool=false to a sibling account.`,
      );
      addLog(
        5,
        "ok",
        `Inputs are real Encrypt ciphertexts: backing=${session.backingCiphertextPda
          .toBase58()
          .slice(0, 12)}…, threshold=${session.thresholdCiphertextPda
          .toBase58()
          .slice(0, 12)}…`,
      );

      // Create the result ciphertext with value=0 (false → unsafe)
      const { ix: resultIx, ciphertextPda: resultPda } =
        await buildDemoCreateCiphertextIx({
          payer: owner,
          label: `res-${Math.random().toString(36).slice(2, 8)}`,
          value: 0, // 0 = unsafe → triggers freeze
        });
      const triggerIx = await buildTriggerRiskCheckIx({
        owner,
        vaultPda: session.vaultPda,
        backingCiphertextPda: session.backingCiphertextPda,
        thresholdCiphertextPda: session.thresholdCiphertextPda,
        resultCiphertextPda: resultPda,
      });

      addLog(
        5,
        "ok",
        `FHE predicate: check_backing_ratio(${EXPLOIT_BACKING_RATIO}, 100, ${THRESHOLD_RATIO})`,
      );
      const sig = await sendIx([resultIx, triggerIx], {
        connection,
        payer: owner,
        signTransaction,
      });
      addLog(
        5,
        "fail",
        `EBool result: false — ${EXPLOIT_BACKING_RATIO}% < ${THRESHOLD_RATIO}%`,
      );
      addLog(5, "fail", `circuit_breaker fired: protocol.frozen = true 🔒`, {
        tx: sig,
      });

      setSession({ ...session, resultCiphertextPda: resultPda });
      setVaultState((s) =>
        s ? { ...s, frozen: true, lastEvent: "CircuitBreakerFired" } : s,
      );
      setCurrentStep(6);
    } catch (e: unknown) {
      addLog(5, "fail", `Failed: ${friendlyError(e)}`);
    } finally {
      setRunning(false);
    }
  };

  // ── Step 6: attempt deposit while frozen — REAL on-chain rejection ───────
  const step6AttemptDeposit = async () => {
    if (!owner || !signTransaction || !session) return;
    setRunning(true);
    try {
      const lamports = BigInt(Math.floor(DEPOSIT_AMOUNT_SOL * 1_000_000_000));
      addLog(6, "ok", `Attacker attempts new deposit on the now-frozen protocol…`);
      const ix = await buildDepositCollateralIx({
        owner,
        vaultPda: session.vaultPda,
        amountLamports: lamports,
      });
      try {
        const sig = await sendIx(ix, {
          connection,
          payer: owner,
          signTransaction,
        });
        addLog(6, "warn", `Deposit unexpectedly succeeded: ${sig}`, { tx: sig });
      } catch (err: unknown) {
        const raw = friendlyError(err);
        const detected = parseAnchorError(raw);
        addLog(6, "fail", `Program rejected the deposit on-chain ❌`);
        addLog(6, "fail", `Error: ${detected ?? raw}`);
        addLog(6, "ok", `LendGuard blocked the deposit before any funds were at risk 🛡`);
      }
    } finally {
      setRunning(false);
    }
  };

  // Each step is a real on-chain tx. The `kind` field tells the user which
  // integrations are real-network vs program-side demo helpers.
  //   on-chain:        LendGuard tx only
  //   ika-mock:        LendGuard tx + LendGuard demo MessageApproval helper
  //   encrypt-real:    LendGuard tx + real Encrypt gRPC createInput
  //   encrypt-hybrid:  LendGuard tx + real Encrypt inputs + demo EBool result
  const stepConfig = [
    { id: 1, label: "Register Vault",        icon: <Shield className="w-4 h-4" />,        layer: "Anchor",  kind: "on-chain" as const },
    { id: 2, label: "Verify Custody Proof",  icon: <Lock className="w-4 h-4" />,          layer: "Ika",     kind: "ika-mock" as const },
    { id: 3, label: "Deposit Collateral",    icon: <CheckCircle className="w-4 h-4" />,   layer: "Anchor",  kind: "on-chain" as const },
    { id: 4, label: "Simulate Exploit",      icon: <AlertTriangle className="w-4 h-4" />, layer: "Encrypt", kind: "encrypt-real" as const },
    { id: 5, label: "Encrypted Risk Check",  icon: <Zap className="w-4 h-4" />,           layer: "Encrypt", kind: "encrypt-hybrid" as const },
    { id: 6, label: "Deposit Rejected",      icon: <XCircle className="w-4 h-4" />,       layer: "Anchor",  kind: "on-chain" as const },
  ] as const;

  const kindBadge: Record<(typeof stepConfig)[number]["kind"], { label: string; cls: string }> = {
    "on-chain":       { label: "ON-CHAIN",                cls: "bg-green-500/15 border-green-500/40 text-green-400" },
    "ika-mock":       { label: "ON-CHAIN · Ika demo helper", cls: "bg-yellow-500/15 border-yellow-500/40 text-yellow-300" },
    "encrypt-real":   { label: "ON-CHAIN · real Encrypt",  cls: "bg-purple-500/15 border-purple-500/40 text-purple-300" },
    "encrypt-hybrid": { label: "ON-CHAIN · Encrypt + demo EBool", cls: "bg-purple-500/15 border-purple-500/40 text-purple-300" },
  };

  const stepAction: Record<Step, (() => Promise<void>) | null> = {
    1: step1RegisterVault,
    2: step2VerifyProof,
    3: step3Deposit,
    4: step4Exploit,
    5: step5RiskCheck,
    6: step6AttemptDeposit,
  };

  // ── Real Ika: standalone DKG → approve_message → sign experiment ─────────
  // Decoupled from the 6-step demo because the existing vault was registered
  // with a generated dwallet_id; pairing real Ika needs a fresh registration.
  // This panel proves the LendGuard ↔ Ika CPI works end-to-end on devnet.
  const runRealIkaExperiment = async () => {
    if (!owner || !signTransaction || !session) return;
    setRunning(true);
    try {
      addLog(2, "warn", `Real Ika experiment — separate from demo flow`);
      addLog(2, "ok", `Ika gRPC ${new URL(IKA_GRPC_URL).host}`);
      addLog(2, "ok", `Ika dWallet program ${IKA_PROGRAM_ID.toBase58()}`);

      const messageDigest = await crypto.subtle
        .digest(
          "SHA-256",
          new TextEncoder().encode(`lendguard:${session.vaultPda.toBase58()}`),
        )
        .then((b) => new Uint8Array(b));

      const result = await runRealIkaFlow({
        connection,
        owner,
        vaultPda: session.vaultPda,
        messageDigest,
        signTransaction,
        log: (msg, payload) =>
          addLog(2, "ok", msg, {
            tx: typeof payload?.tx === "string" ? payload.tx : undefined,
            account:
              typeof payload?.messageApproval === "string"
                ? payload.messageApproval
                : typeof payload?.cpiAuthority === "string"
                  ? payload.cpiAuthority
                  : undefined,
          }),
      });

      addLog(2, "ok", `Real Ika flow complete — MessageApproval on devnet`, {
        account: result.messageApproval.toBase58(),
        tx: result.approveTxSig,
      });
      if (result.signature) {
        addLog(
          2,
          "ok",
          `Ika network signature received (${result.signature.length} bytes)`,
        );
      }
    } catch (e: unknown) {
      addLog(
        2,
        "fail",
        `Real Ika experiment failed: ${friendlyError(e)} — pre-alpha networks may be unavailable; demo helper still works.`,
      );
    } finally {
      setRunning(false);
    }
  };

  const stepLabel: Record<Step, string> = {
    1: "Register Vault",
    2: "Verify Proof",
    3: `Deposit ${DEPOSIT_AMOUNT_SOL} SOL`,
    4: "Simulate Exploit",
    5: "Trigger Risk Check",
    6: "Attempt Deposit",
  };

  const requiresWallet = useMemo(() => [1, 2, 3, 4, 5, 6] as const, []);
  const isWalletNeededNow = (requiresWallet as readonly number[]).includes(currentStep);

  return (
    <div className="min-h-screen bg-background text-foreground font-sans">
      {/* Header */}
      <div className="border-b border-border/50 bg-background/80 backdrop-blur sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <span className="font-mono text-primary font-bold">L</span>
            </div>
            <span className="font-bold tracking-tight">LendGuard</span>
            <span className="text-muted-foreground text-sm font-mono">/ demo</span>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant="outline" className="font-mono text-xs">
              devnet
            </Badge>
            <ConnectWalletButton />
            <Button variant="ghost" size="sm" onClick={reset} className="gap-2 text-xs">
              <RotateCcw className="w-3 h-3" /> Reset
            </Button>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-10 grid lg:grid-cols-[1fr_420px] gap-8">
        {/* Left: Steps */}
        <div className="space-y-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight mb-1">LendGuard Demo</h1>
            <p className="text-muted-foreground text-sm">
              Every step submits a real on-chain transaction to{" "}
              <span className="font-mono text-foreground">devnet</span>. Step 4 calls the live
              Encrypt pre-alpha executor over gRPC-Web — backing &amp; threshold ciphertexts are
              real accounts owned by the Encrypt program. Step 2 (Ika MessageApproval) and the
              EBool result in step 5 still use LendGuard&rsquo;s demo helpers that produce the
              same byte layouts the production integrations expect.
            </p>
            {!connected && isWalletNeededNow && (
              <div className="mt-4 rounded-lg border border-yellow-500/40 bg-yellow-500/5 p-3 text-xs text-yellow-300">
                Connect a Solana wallet (Phantom / Solflare) on{" "}
                <span className="font-mono">devnet</span> with a small amount of SOL to sign
                the transactions.
              </div>
            )}
          </div>

          {/* Step cards */}
          <div className="space-y-3">
            {stepConfig.map((s) => {
              const isActive = currentStep === s.id;
              const isDone = currentStep > s.id;
              return (
                <div
                  key={s.id}
                  className={`rounded-xl border p-5 transition-all duration-300 ${
                    isActive
                      ? "border-primary/60 bg-primary/5"
                      : isDone
                        ? "border-border/40 bg-muted/20 opacity-60"
                        : "border-border/30 opacity-40"
                  }`}
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <span
                        className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-mono font-bold border ${
                          isDone
                            ? "bg-green-500/20 border-green-500/50 text-green-400"
                            : isActive
                              ? "bg-primary/20 border-primary/50 text-primary"
                              : "bg-muted border-border text-muted-foreground"
                        }`}
                      >
                        {isDone ? "✓" : s.id}
                      </span>
                      <div>
                        <div className="font-medium text-sm flex items-center gap-2">
                          {s.label}
                          <Badge
                            className={`${kindBadge[s.kind].cls} text-[10px] font-mono`}
                          >
                            {kindBadge[s.kind].label}
                          </Badge>
                        </div>
                      </div>
                    </div>
                    <Badge
                      variant="outline"
                      className={`text-xs font-mono ${
                        s.layer === "Ika"
                          ? "border-blue-500/40 text-blue-400"
                          : s.layer === "Encrypt"
                            ? "border-purple-500/40 text-purple-400"
                            : "border-border text-muted-foreground"
                      }`}
                    >
                      {s.layer}
                    </Badge>
                  </div>

                  {isActive && (
                    <Button
                      onClick={() => stepAction[s.id as Step]?.()}
                      disabled={running || !connected}
                      size="sm"
                      className={`gap-2 text-xs ${
                        s.id === 4
                          ? "bg-orange-600 hover:bg-orange-700 text-white"
                          : s.id === 6
                            ? "bg-red-600 hover:bg-red-700 text-white"
                            : ""
                      }`}
                    >
                      {running ? (
                        <>
                          <span className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
                          Running…
                        </>
                      ) : (
                        <>
                          {stepLabel[s.id as Step]}
                          <ArrowRight className="w-3 h-3" />
                        </>
                      )}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>

          {/* Real Ika experiment — separate from the demo flow */}
          {session && (
            <div className="rounded-xl border border-blue-500/40 bg-blue-500/10 p-5 space-y-4">
              <div className="flex items-center gap-2 flex-wrap">
                <Lock className="w-4 h-4 text-blue-400" />
                <span className="font-semibold text-sm">Real Ika dWallet experiment</span>
                <Badge
                  variant="outline"
                  className="text-[10px] font-mono border-blue-500/40 text-blue-300 bg-blue-500/15"
                >
                  LIVE Ika devnet
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Calls Ika gRPC for distributed key generation (sender = LendGuard
                CPI authority PDA), derives the resulting dWallet, then submits
                LendGuard&rsquo;s <code className="font-mono text-foreground">approve_custody_signature</code>{" "}
                instruction which CPIs into Ika{" "}
                <code className="font-mono text-foreground">approve_message</code> via{" "}
                <code className="font-mono text-foreground">invoke_signed</code>. The resulting{" "}
                <code className="font-mono text-foreground">MessageApproval</code> PDA is owned by the
                Ika program and uses the real 287-byte layout — our parser autodetects it. Pre-alpha
                infra may rate-limit or be wiped; failures here don&rsquo;t affect the demo flow.
              </p>
              <Button
                onClick={runRealIkaExperiment}
                disabled={running || !connected}
                size="sm"
                className="w-full gap-2 text-xs bg-blue-600 hover:bg-blue-700 text-white"
              >
                {running ? (
                  <>
                    <span className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
                    Running real Ika flow…
                  </>
                ) : (
                  <>
                    Run real Ika DKG → Approve → Sign
                    <ArrowRight className="w-3 h-3" />
                  </>
                )}
              </Button>
            </div>
          )}

          {/* Done state */}
          {currentStep === 6 && !running && log.some((l) => l.step === 6) && (
            <div className="rounded-xl border border-green-500/30 bg-green-500/5 p-5">
              <div className="flex items-center gap-2 mb-2">
                <Shield className="w-5 h-5 text-green-400" />
                <span className="font-semibold text-green-400">Demo Complete</span>
              </div>
              <p className="text-sm text-muted-foreground">
                This is what would have saved KelpDAO{" "}
                <span className="text-foreground font-semibold">$292 million</span>. LendGuard
                blocked the attacker at the program level — before any funds were at risk.
              </p>
            </div>
          )}
        </div>

        {/* Right: State + Event log */}
        <div className="space-y-5">
          <div className="rounded-xl border border-border bg-card p-5 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono text-muted-foreground">// VAULT STATE</span>
              {vaultState?.frozen && (
                <Badge className="bg-red-500/20 text-red-400 border-red-500/40 text-xs">
                  🔒 FROZEN
                </Badge>
              )}
              {!vaultState?.frozen && vaultState?.proofStatus === "VERIFIED" && (
                <Badge className="bg-green-500/20 text-green-400 border-green-500/40 text-xs">
                  ✅ VERIFIED
                </Badge>
              )}
              {!vaultState && (
                <Badge variant="outline" className="text-xs text-muted-foreground">
                  NOT CREATED
                </Badge>
              )}
            </div>

            <div className="space-y-2 font-mono text-xs">
              <StateRow
                label="vault_pda"
                value={vaultState ? `${vaultState.vaultPda.slice(0, 18)}…` : "—"}
                href={
                  session?.vaultPda
                    ? explorerAccountUrl(session.vaultPda.toBase58())
                    : undefined
                }
              />
              <StateRow label="dwallet_id" value={session?.dwalletIdLabel || "—"} />
              <StateRow
                label="proof_status"
                value={vaultState?.proofStatus ?? "—"}
                accent={vaultState?.proofStatus === "VERIFIED"}
              />
              <StateRow
                label="deposited"
                value={
                  vaultState ? `${Number(vaultState.depositedAmount) / 1e9} SOL` : "—"
                }
              />
              <StateRow
                label="backing_ratio"
                value={vaultState ? `${vaultState.backingRatio}%` : "—"}
                warn={vaultState ? vaultState.backingRatio < THRESHOLD_RATIO : false}
              />
              <StateRow
                label="protocol.frozen"
                value={vaultState ? String(vaultState.frozen) : "—"}
                danger={vaultState?.frozen}
              />
              <StateRow label="last_event" value={vaultState?.lastEvent ?? "—"} />
            </div>
          </div>

          {vaultState && (
            <div className="rounded-xl border border-border bg-card p-5 space-y-3">
              <span className="text-xs font-mono text-muted-foreground">// BACKING RATIO</span>
              <div className="space-y-1">
                <div className="flex justify-between text-xs font-mono">
                  <span>current: {vaultState.backingRatio}%</span>
                  <span className="text-muted-foreground">threshold: {THRESHOLD_RATIO}%</span>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-700 ${
                      vaultState.backingRatio >= THRESHOLD_RATIO
                        ? "bg-green-500"
                        : "bg-red-500"
                    }`}
                    style={{ width: `${vaultState.backingRatio}%` }}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Event log */}
          <div className="rounded-xl border border-border bg-card p-5 space-y-3">
            <span className="text-xs font-mono text-muted-foreground">// EVENT LOG</span>
            {log.length === 0 ? (
              <p className="text-xs text-muted-foreground/50 font-mono">
                Waiting for first step…
              </p>
            ) : (
              <div className="space-y-1.5 max-h-[340px] overflow-y-auto">
                {log.map((entry, i) => (
                  <div key={i} className="flex items-start gap-2 font-mono text-xs">
                    <span
                      className={`mt-0.5 shrink-0 ${
                        entry.status === "ok"
                          ? "text-green-400"
                          : entry.status === "fail"
                            ? "text-red-400"
                            : "text-yellow-400"
                      }`}
                    >
                      {entry.status === "ok" ? "✓" : entry.status === "fail" ? "✗" : "⚠"}
                    </span>
                    <span className="text-muted-foreground leading-relaxed flex-1">
                      {entry.message}
                      {entry.tx && (
                        <>
                          {" "}
                          <a
                            href={explorerTxUrl(entry.tx)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-400 hover:underline"
                          >
                            (tx ↗)
                          </a>
                        </>
                      )}
                      {entry.account && (
                        <>
                          {" "}
                          <a
                            href={explorerAccountUrl(entry.account)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-400 hover:underline"
                          >
                            (account ↗)
                          </a>
                        </>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 text-xs text-muted-foreground/60">
            <ExternalLink className="w-3 h-3" />
            <span>
              All txs visible on{" "}
              <a
                href="https://explorer.solana.com/?cluster=devnet"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-foreground"
              >
                Solana Explorer (devnet)
              </a>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function friendlyError(e: unknown): string {
  if (e instanceof Error) {
    return e.message;
  }
  return String(e);
}

// Try to extract a human Anchor error name from a sendTransaction error message.
function parseAnchorError(msg: string): string | null {
  const errorCodeMap: Record<string, string> = {
    "0x1770": "VaultNotVerified",
    "0x1771": "VaultFrozen",
    "0x1772": "ProtocolFrozen",
    "0x1773": "ProofExpired",
    "0x1774": "InvalidProofAmount",
    "0x1775": "DWalletMismatch",
    "0x1776": "InvalidMessageApproval",
    "0x1777": "InsufficientCollateral",
    "0x1778": "InvalidAssetType",
    "0x1779": "UnauthorizedCaller",
    "0x177a": "RiskCheckFailed",
    "0x177b": "InvalidIkaProgram",
    "0x177c": "InvalidEncryptProgram",
    "0x177d": "InvalidCiphertextAccount",
    "0x177e": "ArithmeticOverflow",
    "0x177f": "InvalidTimestamp",
    "0x1780": "VaultAlreadyVerified",
    "0x1781": "VaultNotFound",
    "0x1782": "InvalidWithdrawalAmount",
    "0x1783": "InvalidDepositAmount",
  };
  const m = msg.match(/0x[0-9a-f]+/i);
  if (m) {
    const code = m[0].toLowerCase();
    if (errorCodeMap[code]) return `${errorCodeMap[code]} (${code})`;
  }
  const nameMatch = msg.match(/AnchorError [^"]*: ([A-Za-z]+)/);
  if (nameMatch) return nameMatch[1];
  return msg.split("\n")[0];
}

function StateRow({
  label,
  value,
  href,
  accent,
  warn,
  danger,
}: {
  label: string;
  value: string;
  href?: string;
  accent?: boolean;
  warn?: boolean;
  danger?: boolean;
}) {
  const colorClass = danger
    ? "text-red-400"
    : warn
      ? "text-yellow-400"
      : accent
        ? "text-green-400"
        : "text-foreground";
  return (
    <div className="flex justify-between gap-2">
      <span className="text-muted-foreground/60">{label}</span>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className={`${colorClass} hover:underline`}
        >
          {value}
        </a>
      ) : (
        <span className={colorClass}>{value}</span>
      )}
    </div>
  );
}
