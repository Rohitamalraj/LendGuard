import { NextResponse } from "next/server";

import { isTorqueEventName } from "@/lib/torque-events";

const INGESTER_URL =
  process.env.TORQUE_INGESTER_URL ?? "https://ingest.torque.so";
const API_KEY = process.env.TORQUE_API_KEY;

type EventData = Record<string, string | number | boolean | null>;

function isEventData(value: unknown): value is EventData {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value).every(
    (v) =>
      v === null ||
      typeof v === "string" ||
      typeof v === "number" ||
      typeof v === "boolean",
  );
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const eventName = String((body as { eventName?: unknown }).eventName ?? "");
  const userPubkey = String((body as { userPubkey?: unknown }).userPubkey ?? "");
  const timestamp = Number((body as { timestamp?: unknown }).timestamp ?? Date.now());
  const data = (body as { data?: unknown }).data ?? {};

  if (!isTorqueEventName(eventName)) {
    return NextResponse.json({ error: "Unknown Torque event" }, { status: 400 });
  }
  if (!userPubkey) {
    return NextResponse.json({ error: "Missing userPubkey" }, { status: 400 });
  }
  if (!Number.isFinite(timestamp)) {
    return NextResponse.json({ error: "Invalid timestamp" }, { status: 400 });
  }
  if (!isEventData(data)) {
    return NextResponse.json({ error: "Invalid event data" }, { status: 400 });
  }

  if (!API_KEY) {
    return NextResponse.json({
      forwarded: false,
      reason: "TORQUE_API_KEY is not configured; event recorded locally only.",
    });
  }

  const res = await fetch(`${INGESTER_URL}/events`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": API_KEY,
    },
    body: JSON.stringify({
      userPubkey,
      timestamp,
      eventName,
      data,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return NextResponse.json(
      {
        forwarded: false,
        error: `Torque ingestion failed: ${res.status}`,
        details: text.slice(0, 500),
      },
      { status: 502 },
    );
  }

  return NextResponse.json({ forwarded: true });
}
