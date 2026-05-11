/**
 * A retrying `fetch` wrapper used as the transport for every Solana
 * `Connection` in this app.
 *
 * Why: the public devnet RPC (`api.devnet.solana.com`) is rate-limited and
 * occasionally returns network-level errors (`TypeError: Failed to fetch`,
 * 429, 503) on bursts. Without retries the demo's account reads fail with
 * a stack trace and the user has to refresh.
 *
 * Strategy: exponential backoff (200ms → 400ms → 800ms → 1600ms, capped at
 * 4 tries, +jitter) on network errors and HTTP 429/502/503/504. Any other
 * response (including 4xx errors from the program itself) returns
 * immediately so legitimate program failures aren't masked.
 *
 * Override the RPC endpoint with `NEXT_PUBLIC_SOLANA_RPC_URL` in
 * `.env.local` for production (Helius, Triton, QuickNode, etc.).
 */

const MAX_ATTEMPTS = 4;
const BASE_DELAY_MS = 200;
const RETRY_STATUSES = new Set([429, 502, 503, 504]);

function shouldRetryStatus(status: number): boolean {
  return RETRY_STATUSES.has(status);
}

function jitter(ms: number): number {
  return ms + Math.floor(Math.random() * 200);
}

export const retryingFetch: typeof fetch = async (input, init) => {
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(input as RequestInfo, init);
      if (shouldRetryStatus(response.status) && attempt < MAX_ATTEMPTS - 1) {
        const delay = jitter(BASE_DELAY_MS * 2 ** attempt);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      return response;
    } catch (err) {
      lastError = err;
      if (attempt < MAX_ATTEMPTS - 1) {
        const delay = jitter(BASE_DELAY_MS * 2 ** attempt);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
    }
  }
  throw (
    lastError ??
    new Error(
      `RPC unreachable after ${MAX_ATTEMPTS} attempts. Set NEXT_PUBLIC_SOLANA_RPC_URL to a private endpoint (Helius/Triton/QuickNode) in web/.env.local if this persists.`,
    )
  );
};
