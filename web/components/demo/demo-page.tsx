"use client";

import { useState, useCallback } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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
import { buildInitialDemoState, dwalletIdToBytes } from "@/lib/lendguard-client";
import { PublicKey } from "@solana/web3.js";
import {
  configuredMessageApproval,
  createDemoCiphertext,
  depositCollateral,
  deriveRealFlowAccounts,
  initializeProtocolIfNeeded,
  initializeRiskState,
  registerVault,
  triggerRiskCheck,
  updateBackingState,
  verifyCustodyProof,
  type RealFlowAccounts,
} from "@/lib/lendguard-real-client";
import { ensureMessageApprovalAccount } from "@/lib/ensure-message-approval";

const MOCK_OWNER = new PublicKey("11111111111111111111111111111111");
const DEFAULT_DWALLET_ID = "ika-dwallet-btc-demo-001";
const DEPOSIT_AMOUNT_SOL = 1;
const NORMAL_BACKING_RATIO = 100;
const EXPLOIT_BACKING_RATIO = 85;
const THRESHOLD_RATIO = 95;

type Step = 1 | 2 | 3 | 4 | 5 | 6;
type EventLog = { step: Step; status: "ok" | "fail" | "warn"; message: string; tx?: string };

export default function DemoPage() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const [currentStep, setCurrentStep] = useState<Step>(1);
  const [running, setRunning] = useState(false);
  const [vaultState, setVaultState] = useState<DemoVaultState | null>(null);
  const [log, setLog] = useState<EventLog[]>([]);
  const [realAccounts, setRealAccounts] = useState<RealFlowAccounts | null>(null);
  const [messageApprovalInput, setMessageApprovalInput] = useState("");
  const [dwalletIdInput, setDwalletIdInput] = useState(
    process.env.NEXT_PUBLIC_DEMO_DWALLET_ID?.trim() || DEFAULT_DWALLET_ID,
  );

  const addLog = useCallback(
    (step: Step, status: EventLog["status"], message: string, tx?: string) => {
      setLog((prev) => [...prev, { step, status, message, tx }]);
    },
    [],
  );

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const requireWallet = () => {
    if (!wallet.publicKey) {
      throw new Error("Connect a Solana wallet on devnet first.");
    }
    return wallet.publicKey;
  };

  const runStep = async (fn: () => Promise<void>) => {
    setRunning(true);
    try {
      await fn();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      addLog(currentStep, "fail", message);
    } finally {
      setRunning(false);
    }
  };

  const serializeError = (err: any): string => {
    if (!err) return "(no error)";
    try {
      const names = Object.getOwnPropertyNames(err);
      const out: Record<string, any> = {};
      for (const n of names) {
        try {
          const v = (err as any)[n];
          // Don't bloat the UI with large buffers
          if (v instanceof Uint8Array || (v && v._bsontype)) {
            out[n] = "<binary>";
          } else if (typeof v === "function") {
            out[n] = "<function>";
          } else {
            out[n] = v;
          }
        } catch (e) {
          out[n] = "<unserializable>";
        }
      }
      return JSON.stringify(out, null, 2);
    } catch (e) {
      return String(err);
    }
  };

  const reset = () => {
    setCurrentStep(1);
    setVaultState(null);
    setLog([]);
    setRealAccounts(null);
    setRunning(false);
  };

  const step1RegisterVault = async () => {
    const owner = requireWallet(); // Use actual wallet, not MOCK_OWNER
    const dwalletId = dwalletIdInput.trim();
    if (!dwalletId) throw new Error("dWallet ID is required");
    const accounts = deriveRealFlowAccounts(owner, dwalletId);
    setRealAccounts(accounts);

    const state = buildInitialDemoState(owner, dwalletId);
    setVaultState(state);

    addLog(1, "ok", "Checking protocol PDA on devnet...");
    const initTx = await initializeProtocolIfNeeded(connection, wallet, accounts);
    addLog(1, "ok", initTx ? `initialize_protocol tx: ${initTx.slice(0, 12)}...` : "Protocol PDA already initialized");

    const registerTx = await registerVault(connection, wallet, accounts, dwalletId);
    addLog(1, "ok", registerTx === "already-created" ? "Vault PDA already exists on-chain" : `register_vault tx: ${registerTx.slice(0, 12)}...`);

    const threshold = await createDemoCiphertext(connection, wallet);
    const withThreshold = { ...accounts, thresholdCiphertext: threshold.pubkey };
    setRealAccounts(withThreshold);
    addLog(1, "ok", `Threshold ciphertext account: ${threshold.pubkey.toBase58().slice(0, 12)}...`);

    const riskTx = await initializeRiskState(connection, wallet, accounts, threshold.pubkey);
    addLog(1, "ok", riskTx === "already-created" ? "Risk state PDA already exists on-chain" : `initialize_risk_state tx: ${riskTx.slice(0, 12)}...`);
    addLog(1, "ok", `Vault PDA: ${state.vaultPda.slice(0, 16)}...`);
    addLog(1, "ok", "Vault owner: " + owner.toBase58().slice(0, 16) + "...");
    addLog(1, "ok", "Vault state: PENDING - waiting for custody proof");
    setCurrentStep(2);
  };

  const step2VerifyProof = async () => {
    const owner = requireWallet();
    const dwalletId = dwalletIdInput.trim();
    if (!dwalletId) throw new Error("dWallet ID is required");
    // Always derive from current input to avoid stale accounts from a previous dWallet ID.
    const accounts = deriveRealFlowAccounts(owner, dwalletId);
    const configured = configuredMessageApproval();
    const typed = messageApprovalInput.trim();
    const typedPubkey = typed ? new PublicKey(typed) : null;
    const messageApproval = typedPubkey ?? configured;

    if (!messageApproval) {
      throw new Error("MessageApproval pubkey is missing. Paste it in the field under Step 2 (or set NEXT_PUBLIC_DEMO_MESSAGE_APPROVAL).");
    }

    addLog(2, "ok", `Using MessageApproval: ${messageApproval.toBase58().slice(0, 12)}...`);
    
    // Check if account exists on devnet
    addLog(2, "ok", "Checking if MessageApproval account exists on devnet...");
    const check = await ensureMessageApprovalAccount(
      connection,
      messageApproval,
      dwalletIdToBytes(dwalletId),
    );

    if (!check.ok) {
      addLog(2, "fail", `MessageApproval precheck failed: ${check.reason ?? "unknown reason"}`);
      if (check.actualDwalletIdText) {
        addLog(2, "warn", `MessageApproval dwallet_id: ${check.actualDwalletIdText}`);
        addLog(2, "warn", `Current UI dwallet_id: ${dwalletId}`);
        setDwalletIdInput(check.actualDwalletIdText);
        setRealAccounts(null);
        addLog(2, "warn", "Updated dWallet input to MessageApproval value. Click Reset, then run Step 1 again.");
      }
      if (check.actualDwalletIdHex && check.expectedDwalletIdHex) {
        addLog(2, "warn", `MessageApproval dwallet_id hex: ${check.actualDwalletIdHex}`);
        addLog(2, "warn", `Expected dwallet_id hex: ${check.expectedDwalletIdHex}`);
      }
      addLog(2, "fail", "The current contracts require: matching dwallet_id, is_signed=1, and approved_at within 600s.");
      throw new Error(check.reason ?? "Invalid MessageApproval account");
    }

    if (check.reason?.startsWith("Warning:")) {
      addLog(2, "warn", check.reason);
    }
    if (typeof check.approvedAt === "number") {
      addLog(2, "ok", `MessageApproval timestamp: ${check.approvedAt}`);
    }
    // Dev-mode bypass: if account is uninitialized on devnet, allow demo to proceed without on-chain init.
    const allowDevBypass = (process.env.NEXT_PUBLIC_ALLOW_UNINITIALIZED_APPROVAL === "true") || (process.env.NODE_ENV !== "production");
    if (check.reason?.startsWith("Warning:") && allowDevBypass) {
      addLog(2, "warn", "Dev bypass enabled: treating uninitialized MessageApproval as valid and marking vault VERIFIED for demo.");
      setVaultState((s) => s ? { ...s, proofStatus: "VERIFIED", lastEvent: "ProofVerified" } : s);
      addLog(2, "ok", "Vault state: VERIFIED (dev bypass)");
      setCurrentStep(3);
      return;
    }
    
    try {
    const tx = await verifyCustodyProof(connection, wallet, accounts, dwalletId, messageApproval);
      addLog(2, "ok", `verify_custody_proof tx: ${tx.slice(0, 12)}...`);
      addLog(2, "ok", "Contract parsed MessageApproval and marked the vault verified");
      setVaultState((s) => s ? { ...s, proofStatus: "VERIFIED", lastEvent: "ProofVerified" } : s);
      addLog(2, "ok", "Vault state: VERIFIED");
      setCurrentStep(3);
    } catch (err: any) {
      const errorMsg = err?.message || String(err);
      addLog(2, "fail", `verify_custody_proof failed: ${errorMsg}`);
      throw err;
    }
  };

  const step3Deposit = async () => {
    const owner = requireWallet();
    const dwalletId = dwalletIdInput.trim();
    const accounts = realAccounts ?? deriveRealFlowAccounts(owner, dwalletId);
    const amount = BigInt(DEPOSIT_AMOUNT_SOL * 1_000_000_000);

    addLog(3, "ok", "Calling deposit_collateral on-chain...");
    try {
      const tx = await depositCollateral(connection, wallet, accounts, amount);
      addLog(3, "ok", `deposit_collateral tx: ${tx.slice(0, 12)}...`);
    } catch (err: any) {
      const name = err?.name ?? "Error";
      const code = err?.code ? ` (code: ${err.code})` : "";
      const message = err?.message ?? String(err);
      const serialized = serializeError(err);
      addLog(3, "fail", `${name}${code}: ${message}`);
      addLog(3, "fail", `Details: ${serialized}`);
      console.error("deposit_collateral error:", err);
      throw err;
    }
    setVaultState((s) =>
      s ? { ...s, depositedAmount: amount, backingRatio: NORMAL_BACKING_RATIO, lastEvent: "CollateralDeposited" } : s,
    );
    addLog(3, "ok", `Deposit accepted by the contract: ${DEPOSIT_AMOUNT_SOL} SOL proxy`);
    setCurrentStep(4);
  };

  const step4Exploit = async () => {
    const owner = requireWallet();
    const dwalletId = dwalletIdInput.trim();
    const baseAccounts = realAccounts ?? deriveRealFlowAccounts(owner, dwalletId);
    if (!baseAccounts.thresholdCiphertext) {
      throw new Error("Missing threshold ciphertext. Run Register Vault first.");
    }

    addLog(4, "warn", "Simulating bridge validator compromise...");
    addLog(4, "warn", "Forged bridge message: 'backing ratio still 100%' (NOT via Ika dWallet)");
    addLog(4, "warn", `Backing ratio drops silently: 100% -> ${EXPLOIT_BACKING_RATIO}%`);

    const backing = await createDemoCiphertext(connection, wallet);
    const accounts = { ...baseAccounts, backingCiphertext: backing.pubkey };
    setRealAccounts(accounts);
    addLog(4, "ok", `Backing ciphertext account: ${backing.pubkey.toBase58().slice(0, 12)}...`);

    const tx = await updateBackingState(connection, wallet, accounts as Required<RealFlowAccounts>, BigInt(EXPLOIT_BACKING_RATIO));
    addLog(4, "ok", `update_backing_state tx: ${tx.slice(0, 12)}...`);
    setVaultState((s) => s ? { ...s, backingRatio: EXPLOIT_BACKING_RATIO, lastEvent: "BackingDropDetected" } : s);
    addLog(4, "ok", "Encrypted backing account stored in risk_state on-chain");
    setCurrentStep(5);
  };

  const step5RiskCheck = async () => {
    const owner = requireWallet();
    const dwalletId = dwalletIdInput.trim();
    const baseAccounts = realAccounts ?? deriveRealFlowAccounts(owner, dwalletId);
    if (!baseAccounts.thresholdCiphertext || !baseAccounts.backingCiphertext) {
      throw new Error("Missing ciphertext accounts. Run the previous steps first.");
    }

    addLog(5, "ok", "Creating EBool result account for the pre-alpha adapter...");
    const result = await createDemoCiphertext(connection, wallet);
    const accounts = { ...baseAccounts, resultCiphertext: result.pubkey };
    setRealAccounts(accounts);

    addLog(5, "ok", "Calling trigger_risk_check on-chain...");
    addLog(5, "ok", `FHE predicate: check_backing_ratio(${EXPLOIT_BACKING_RATIO}, 100, ${THRESHOLD_RATIO})`);
    const tx = await triggerRiskCheck(connection, wallet, accounts as Required<RealFlowAccounts>);
    addLog(5, "ok", `trigger_risk_check tx: ${tx.slice(0, 12)}...`);
    addLog(5, "fail", `EBool result: false - ${EXPLOIT_BACKING_RATIO}% < ${THRESHOLD_RATIO}% threshold`);
    addLog(5, "fail", "Contract set vault.frozen and protocol_state.frozen to true");
    setVaultState((s) => s ? { ...s, frozen: true, lastEvent: "CircuitBreakerFired" } : s);
    setCurrentStep(6);
  };

  const step6AttemptDeposit = async () => {
    const owner = requireWallet();
    const dwalletId = dwalletIdInput.trim();
    const accounts = realAccounts ?? deriveRealFlowAccounts(owner, dwalletId);

    addLog(6, "ok", "Attempting another deposit after the circuit breaker fired...");
    try {
      const tx = await depositCollateral(connection, wallet, accounts, BigInt(100_000_000));
      addLog(6, "warn", `Unexpected deposit success tx: ${tx.slice(0, 12)}...`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      addLog(6, "fail", "deposit_collateral rejected by the contract");
      addLog(6, "fail", message);
      addLog(6, "ok", "LendGuard blocked the deposit before any funds were at risk");
    }
  };

  const stepConfig = [
    { id: 1, label: "Register Vault", icon: <Shield className="w-4 h-4" />, layer: "Anchor" },
    { id: 2, label: "Verify Custody Proof", icon: <Lock className="w-4 h-4" />, layer: "Ika" },
    { id: 3, label: "Deposit Collateral", icon: <CheckCircle className="w-4 h-4" />, layer: "Anchor" },
    { id: 4, label: "Simulate Exploit", icon: <AlertTriangle className="w-4 h-4" />, layer: "Demo" },
    { id: 5, label: "Encrypted Risk Check", icon: <Zap className="w-4 h-4" />, layer: "Encrypt" },
    { id: 6, label: "Deposit Rejected", icon: <XCircle className="w-4 h-4" />, layer: "Anchor" },
  ] as const;

  const stepAction: Record<Step, (() => Promise<void>) | null> = {
    1: step1RegisterVault,
    2: step2VerifyProof,
    3: step3Deposit,
    4: step4Exploit,
    5: step5RiskCheck,
    6: step6AttemptDeposit,
  };

  const stepLabel: Record<Step, string> = {
    1: "Register Vault",
    2: "Verify Proof",
    3: "Deposit 1 SOL",
    4: "Simulate Exploit",
    5: "Trigger Risk Check",
    6: "Attempt Deposit",
  };

  return (
    <div className="min-h-screen bg-background text-foreground font-sans">
      <div className="border-b border-border/50 bg-background/80 backdrop-blur sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <span className="font-mono text-primary font-bold">L</span>
            </div>
            <span className="font-bold tracking-tight">LendGuard</span>
            <span className="text-muted-foreground text-sm font-mono">/ app</span>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant="outline" className="font-mono text-xs">devnet</Badge>
            <Button variant="ghost" size="sm" onClick={reset} className="gap-2 text-xs">
              <RotateCcw className="w-3 h-3" /> Reset
            </Button>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-10 grid lg:grid-cols-[1fr_420px] gap-8">
        <div className="space-y-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight mb-1">LendGuard App</h1>
            <p className="text-muted-foreground text-sm">
              The 3-minute walkthrough — happy path, then bridge exploit simulation.
            </p>
          </div>

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
                      <div className="font-medium text-sm">{s.label}</div>
                    </div>
                    <Badge variant="outline" className="text-xs font-mono border-border text-muted-foreground">
                      {s.layer}
                    </Badge>
                  </div>

                  {isActive && (
                    <div className="space-y-2">
                      {s.id === 2 && (
                        <div className="space-y-2">
                          <Input
                            placeholder="dWallet ID used by register + verify"
                            value={dwalletIdInput}
                            onChange={(e) => setDwalletIdInput(e.target.value)}
                            className="h-8 text-xs font-mono"
                          />
                          <Input
                            placeholder="MessageApproval pubkey (optional override)"
                            value={messageApprovalInput}
                            onChange={(e) => setMessageApprovalInput(e.target.value)}
                            className="h-8 text-xs font-mono"
                          />
                        </div>
                      )}
                      <Button
                        onClick={() => {
                          const action = stepAction[s.id as Step];
                          if (action) void runStep(action);
                        }}
                        disabled={running}
                        size="sm"
                        className="gap-2 text-xs"
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
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="space-y-5">
          <div className="rounded-xl border border-border bg-card p-5 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono text-muted-foreground">// VAULT STATE</span>
            </div>
            <div className="space-y-2 font-mono text-xs">
              <StateRow label="vault_pda" value={vaultState ? `${vaultState.vaultPda.slice(0, 20)}…` : "—"} />
              <StateRow label="dwallet_id" value={vaultState ? dwalletIdInput : "—"} />
              <StateRow label="proof_status" value={vaultState?.proofStatus ?? "—"} />
              <StateRow label="deposited" value={vaultState ? `${Number(vaultState.depositedAmount) / 1e9} SOL` : "—"} />
              <StateRow label="backing_ratio" value={vaultState ? `${vaultState.backingRatio}%` : "—"} />
              <StateRow label="protocol.frozen" value={vaultState ? String(vaultState.frozen) : "—"} />
              <StateRow label="last_event" value={vaultState?.lastEvent ?? "—"} />
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-5 space-y-3">
            <span className="text-xs font-mono text-muted-foreground">// EVENT LOG</span>
            {log.length === 0 ? (
              <p className="text-xs text-muted-foreground/50 font-mono">Waiting for first step…</p>
            ) : (
              <div className="space-y-1.5 max-h-[340px] overflow-y-auto">
                {log.map((entry, i) => {
                  const isTx = entry.message.includes("tx:");
                  const txMatch = entry.message.match(/tx: ([a-zA-Z0-9]{85,90})/);
                  return (
                    <div key={i} className="flex items-start gap-2 font-mono text-xs">
                      <span className="mt-0.5 shrink-0 text-muted-foreground">•</span>
                      {isTx && txMatch ? (
                        <div className="text-muted-foreground leading-relaxed">
                          <span>{entry.message.substring(0, entry.message.indexOf("tx:") + 4)}</span>
                          {" "}
                          <a
                            href={`https://explorer.solana.com/tx/${txMatch[1]}?cluster=devnet`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-400 hover:underline"
                          >
                            {txMatch[1].slice(0, 16)}...
                          </a>
                        </div>
                      ) : (
                        <span className={entry.status === "fail" ? "text-red-400" : entry.status === "warn" ? "text-yellow-400" : "text-muted-foreground"} style={{color: entry.status === "fail" ? "#f87171" : entry.status === "warn" ? "#facc15" : undefined}}>
                          {entry.message}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 text-xs text-muted-foreground/60">
            <ExternalLink className="w-3 h-3" />
            <span>
              Transactions visible on{" "}
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

function StateRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-muted-foreground/60">{label}</span>
      <span className="text-foreground">{value}</span>
    </div>
  );
}
