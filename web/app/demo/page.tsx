"use client";

import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { PublicKey } from "@solana/web3.js";

// ─── Demo constants ───────────────────────────────────────────────────────────
const MOCK_OWNER = new PublicKey("11111111111111111111111111111111");
const MOCK_DWALLET_ID = "ika-dwallet-btc-demo-001";
const DEPOSIT_AMOUNT_SOL = 1;
const NORMAL_BACKING_RATIO = 100;
const EXPLOIT_BACKING_RATIO = 85;
const THRESHOLD_RATIO = 95;

type Step = 1 | 2 | 3 | 4 | 5 | 6;
type EventLog = { step: Step; status: "ok" | "fail" | "warn"; message: string; tx?: string };

// ─── Demo page ────────────────────────────────────────────────────────────────
export default function DemoPage() {
  const [currentStep, setCurrentStep] = useState<Step>(1);
  const [running, setRunning] = useState(false);
  const [vaultState, setVaultState] = useState<DemoVaultState | null>(null);
  const [log, setLog] = useState<EventLog[]>([]);

  const addLog = useCallback(
    (step: Step, status: EventLog["status"], message: string, tx?: string) => {
      setLog((prev) => [...prev, { step, status, message, tx }]);
    },
    [],
  );

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const reset = () => {
    setCurrentStep(1);
    setVaultState(null);
    setLog([]);
    setRunning(false);
  };

  // ── Step 1: Register vault ────────────────────────────────────────────────
  const step1RegisterVault = async () => {
    setRunning(true);
    await sleep(600);
    const state = buildInitialDemoState(MOCK_OWNER, MOCK_DWALLET_ID);
    setVaultState(state);
    addLog(1, "ok", `Vault PDA created: ${state.vaultPda.slice(0, 16)}…`);
    addLog(1, "ok", `dWallet linked: ${MOCK_DWALLET_ID}`);
    addLog(1, "ok", "Vault state: PENDING — no custody proof yet");
    setCurrentStep(2);
    setRunning(false);
  };

  // ── Step 2: Verify custody proof ─────────────────────────────────────────
  const step2VerifyProof = async () => {
    setRunning(true);
    await sleep(800);
    addLog(2, "ok", "Requesting MessageApproval from Ika network…");
    await sleep(600);
    addLog(2, "ok", `MessageApproval received — is_signed: 1, approved_at: ${Math.floor(Date.now() / 1000)}`);
    addLog(2, "ok", "parse_message_approval(): dWallet ID ✓, freshness ✓, signed ✓");
    setVaultState((s) => s ? { ...s, proofStatus: "VERIFIED", lastEvent: "ProofVerified" } : s);
    addLog(2, "ok", "Vault state: VERIFIED ✅");
    setCurrentStep(3);
    setRunning(false);
  };

  // ── Step 3: Deposit collateral ────────────────────────────────────────────
  const step3Deposit = async () => {
    setRunning(true);
    await sleep(600);
    addLog(3, "ok", "deposit_collateral(): checking proof status…");
    await sleep(400);
    addLog(3, "ok", `proof_status == VERIFIED ✓, protocol.frozen == false ✓`);
    await sleep(400);
    const amount = BigInt(DEPOSIT_AMOUNT_SOL * 1_000_000_000);
    setVaultState((s) =>
      s ? { ...s, depositedAmount: amount, backingRatio: NORMAL_BACKING_RATIO, lastEvent: "CollateralDeposited" } : s,
    );
    addLog(3, "ok", `Deposit accepted: ${DEPOSIT_AMOUNT_SOL} SOL (proxy for BTC) ✅`);
    addLog(3, "ok", `Event: CollateralDeposited { vault, amount: ${DEPOSIT_AMOUNT_SOL} SOL }`);
    setCurrentStep(4);
    setRunning(false);
  };

  // ── Step 4: Simulate bridge exploit ──────────────────────────────────────
  const step4Exploit = async () => {
    setRunning(true);
    await sleep(500);
    addLog(4, "warn", "⚠ Simulating bridge validator compromise…");
    await sleep(700);
    addLog(4, "warn", "Forged bridge message: 'backing ratio still 100%' (NOT via Ika dWallet)");
    await sleep(500);
    addLog(4, "warn", `Backing ratio drops silently: 100% → ${EXPLOIT_BACKING_RATIO}%`);
    setVaultState((s) => s ? { ...s, backingRatio: EXPLOIT_BACKING_RATIO, lastEvent: "BackingDropDetected" } : s);
    addLog(4, "warn", `LendGuard: no new MessageApproval from Ika — oracle updates backing_ciphertext`);
    await sleep(400);
    addLog(4, "ok", "update_backing_state() called — encrypted backing ratio stored on-chain");
    setCurrentStep(5);
    setRunning(false);
  };

  // ── Step 5: Encrypted risk check ─────────────────────────────────────────
  const step5RiskCheck = async () => {
    setRunning(true);
    await sleep(500);
    addLog(5, "ok", "trigger_risk_check(): calling Encrypt execute_graph…");
    await sleep(800);
    addLog(5, "ok", `FHE predicate: check_backing_ratio(${EXPLOIT_BACKING_RATIO}, 100, ${THRESHOLD_RATIO})`);
    await sleep(600);
    addLog(5, "ok", "Encrypt executor evaluates entirely on ciphertexts (invisible to bots)");
    await sleep(500);
    addLog(5, "fail", `EBool result: false — ${EXPLOIT_BACKING_RATIO}% < ${THRESHOLD_RATIO}% threshold`);
    await sleep(400);
    addLog(5, "fail", "circuit_breaker_freeze(): protocol.frozen = true 🔒");
    setVaultState((s) => s ? { ...s, frozen: true, lastEvent: "CircuitBreakerFired" } : s);
    setCurrentStep(6);
    setRunning(false);
  };

  // ── Step 6: Rejected deposit (attack path) ────────────────────────────────
  const step6AttemptDeposit = async () => {
    setRunning(true);
    await sleep(500);
    addLog(6, "ok", "Attacker attempts new deposit with forged collateral…");
    await sleep(600);
    addLog(6, "fail", "deposit_collateral(): protocol.frozen == true");
    addLog(6, "fail", "Program error: ProtocolFrozen ❌");
    addLog(6, "ok", "LendGuard blocked the deposit before any funds were at risk 🛡");
    setRunning(false);
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
            <Badge variant="outline" className="font-mono text-xs">devnet</Badge>
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
              The 3-minute walkthrough — happy path, then bridge exploit simulation.
            </p>
          </div>

          {/* Step cards */}
          <div className="space-y-3">
            {stepConfig.map((s) => {
              const isActive = currentStep === s.id;
              const isDone = currentStep > s.id;
              const isLocked = currentStep < s.id;
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
                        <div className="font-medium text-sm">{s.label}</div>
                      </div>
                    </div>
                    <Badge
                      variant="outline"
                      className={`text-xs font-mono ${
                        s.layer === "Ika"
                          ? "border-blue-500/40 text-blue-400"
                          : s.layer === "Encrypt"
                          ? "border-purple-500/40 text-purple-400"
                          : s.layer === "Demo"
                          ? "border-orange-500/40 text-orange-400"
                          : "border-border text-muted-foreground"
                      }`}
                    >
                      {s.layer}
                    </Badge>
                  </div>

                  {isActive && (
                    <Button
                      onClick={() => stepAction[s.id as Step]?.()}
                      disabled={running}
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
          {/* Vault state panel */}
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
              <StateRow label="vault_pda" value={vaultState ? `${vaultState.vaultPda.slice(0, 20)}…` : "—"} />
              <StateRow label="dwallet_id" value={vaultState ? MOCK_DWALLET_ID : "—"} />
              <StateRow label="proof_status" value={vaultState?.proofStatus ?? "—"} accent={vaultState?.proofStatus === "VERIFIED"} />
              <StateRow
                label="deposited"
                value={vaultState ? `${Number(vaultState.depositedAmount) / 1e9} SOL` : "—"}
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

          {/* Backing ratio bar */}
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
                      vaultState.backingRatio >= THRESHOLD_RATIO ? "bg-green-500" : "bg-red-500"
                    }`}
                    style={{ width: `${vaultState.backingRatio}%` }}
                  />
                </div>
                <div
                  className="h-full w-px bg-yellow-500/60 absolute"
                  style={{ left: `${THRESHOLD_RATIO}%` }}
                />
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
                    <span className="text-muted-foreground leading-relaxed">{entry.message}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Explorer link placeholder */}
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

function StateRow({
  label,
  value,
  accent,
  warn,
  danger,
}: {
  label: string;
  value: string;
  accent?: boolean;
  warn?: boolean;
  danger?: boolean;
}) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-muted-foreground/60">{label}</span>
      <span
        className={
          danger
            ? "text-red-400"
            : warn
            ? "text-yellow-400"
            : accent
            ? "text-green-400"
            : "text-foreground"
        }
      >
        {value}
      </span>
    </div>
  );
}
