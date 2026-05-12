"use client";

import {
  TORQUE_GUARDIAN_STEPS,
  type TorqueEventName,
  type TorqueEventRecord,
} from "@/lib/torque-events";

const STORAGE_PREFIX = "lendguard:torque-events:";

export interface EmitTorqueEventInput {
  eventName: TorqueEventName;
  userPubkey: string;
  data?: Record<string, string | number | boolean | null | undefined>;
}

export interface GuardianSnapshot {
  completed: number;
  total: number;
  completionPct: number;
  completedStepIds: Set<string>;
  events: TorqueEventRecord[];
  gates: {
    canBorrow: boolean;
    canUseBtcFlow: boolean;
    readyForLiquidatorBeta: boolean;
  };
}

function storageKey(userPubkey: string): string {
  return `${STORAGE_PREFIX}${userPubkey}`;
}

function sanitizeData(
  data: EmitTorqueEventInput["data"] = {},
): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;
    out[key] = value;
  }
  return out;
}

export function readLocalTorqueEvents(userPubkey?: string | null): TorqueEventRecord[] {
  if (!userPubkey || typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey(userPubkey));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persistLocalTorqueEvent(record: TorqueEventRecord) {
  if (typeof window === "undefined") return;
  const current = readLocalTorqueEvents(record.userPubkey);
  const next = [record, ...current].slice(0, 100);
  window.localStorage.setItem(storageKey(record.userPubkey), JSON.stringify(next));
  window.dispatchEvent(new CustomEvent("lendguard:torque-event"));
}

export async function emitTorqueEvent(input: EmitTorqueEventInput): Promise<{
  forwarded: boolean;
  reason?: string;
}> {
  const record: TorqueEventRecord = {
    eventName: input.eventName,
    userPubkey: input.userPubkey,
    timestamp: Date.now(),
    data: sanitizeData(input.data),
  };

  persistLocalTorqueEvent(record);

  try {
    const res = await fetch("/api/torque/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(record),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { forwarded: false, reason: json?.error ?? "Torque proxy rejected event" };
    }
    return { forwarded: Boolean(json.forwarded), reason: json.reason };
  } catch (err) {
    return {
      forwarded: false,
      reason: err instanceof Error ? err.message : "Failed to call Torque proxy",
    };
  }
}

export function getGuardianSnapshot(userPubkey?: string | null): GuardianSnapshot {
  const events = readLocalTorqueEvents(userPubkey);
  const eventNames = new Set(events.map((event) => event.eventName));
  const completedStepIds = new Set(
    TORQUE_GUARDIAN_STEPS.filter((step) => eventNames.has(step.eventName)).map(
      (step) => step.id,
    ),
  );
  const completed = completedStepIds.size;
  const total = TORQUE_GUARDIAN_STEPS.length;

  return {
    completed,
    total,
    completionPct: total === 0 ? 0 : Math.round((completed / total) * 100),
    completedStepIds,
    events,
    gates: {
      canBorrow: eventNames.has("lendguard_custody_proof_verified"),
      canUseBtcFlow: eventNames.has("lendguard_wallet_connected"),
      readyForLiquidatorBeta:
        eventNames.has("lendguard_custody_proof_verified") &&
        eventNames.has("lendguard_attack_demo_completed"),
    },
  };
}
