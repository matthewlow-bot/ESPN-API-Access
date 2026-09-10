// ---------------------------------------------------------------------------
// Transport: the single espnFetch choke point.
//
// Mirrors espn-fantasy-client's transport, trimmed for the public scoreboard
// API: no cookies, no rate limiter, no cache. Handles URL build, a spoofed UA,
// Accept: application/json, an AbortController timeout, and retry/backoff.
// Wrapper order: retry/backoff -> fetch -> parse/classify errors.
// This is the only place to patch when ESPN changes.
// ---------------------------------------------------------------------------

import {
  NflScheduleError,
  NflScheduleNetworkError,
  NflScheduleParseError,
} from "./errors.js";
import type { NflScheduleClientOptions, ReadOptions, RetryOptions } from "./types.js";

/** ESPN's public (no-auth) scoreboard endpoint. */
export const ESPN_SCOREBOARD_URL =
  "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard";

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36";

const DEFAULT_TIMEOUT_MS = 15_000;

export const DEFAULT_RETRY: RetryOptions = {
  maxRetries: 3,
  baseDelayMs: 300,
  maxDelayMs: 5_000,
  retryOn: ({ status, error }) => {
    if (error) return true; // network / timeout / abort
    if (status === undefined) return false;
    return status === 429 || status >= 500;
  },
};

export type QueryParams = Record<string, string | number | undefined>;

export class Transport {
  private readonly fetchImpl: typeof fetch;
  private readonly userAgent: string;
  private readonly timeoutMs: number;
  private readonly retry: RetryOptions | null;
  private readonly baseUrl: string;

  constructor(options: NflScheduleClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    if (typeof this.fetchImpl !== "function") {
      throw new Error(
        "No fetch implementation available. Provide fetchImpl or run on Node 18+.",
      );
    }
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.baseUrl = options.baseUrl ?? ESPN_SCOREBOARD_URL;
    this.retry = resolveRetry(options.retry);
  }

  private buildUrl(params?: QueryParams): string {
    if (!params) return this.baseUrl;
    const parts: string[] = [];
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined) continue;
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
    }
    return parts.length ? `${this.baseUrl}?${parts.join("&")}` : this.baseUrl;
  }

  /** Fetch the scoreboard for the given query params and return parsed JSON. */
  async fetchJson(params?: QueryParams, opts: ReadOptions = {}): Promise<unknown> {
    const url = this.buildUrl(params);
    return this.withRetry(url, opts);
  }

  private async withRetry(url: string, opts: ReadOptions): Promise<unknown> {
    if (!this.retry) return this.fetchOnce(url, opts);
    const { maxRetries, baseDelayMs, maxDelayMs, retryOn } = this.retry;
    let attempt = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        return await this.fetchOnce(url, opts);
      } catch (err) {
        const apiErr = err as NflScheduleError;
        const status = apiErr instanceof NflScheduleError ? apiErr.status : undefined;
        const retriableByType =
          apiErr instanceof NflScheduleError ? apiErr.retriable : false;
        const shouldRetry =
          attempt < maxRetries &&
          retriableByType &&
          retryOn({
            status,
            error: err instanceof Error ? err : new Error(String(err)),
          });
        if (!shouldRetry) throw err;
        const delay = Math.min(
          maxDelayMs,
          baseDelayMs * 2 ** attempt + Math.random() * baseDelayMs,
        );
        await sleep(delay);
        attempt++;
      }
    }
  }

  /** A single fetch + classify. Never retries. */
  private async fetchOnce(url: string, opts: ReadOptions): Promise<unknown> {
    const headers: Record<string, string> = {
      Accept: "application/json",
      "User-Agent": this.userAgent,
    };

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);

    const onExternalAbort = () => controller.abort();
    if (opts.signal) {
      if (opts.signal.aborted) controller.abort();
      else opts.signal.addEventListener("abort", onExternalAbort, { once: true });
    }

    let res: Response;
    try {
      res = await this.fetchImpl(url, { headers, signal: controller.signal });
    } catch (err) {
      if (timedOut) {
        throw new NflScheduleNetworkError(
          `NFL scoreboard request timed out after ${this.timeoutMs}ms for ${url}`,
          { url, retriable: true, cause: err },
        );
      }
      if (opts.signal?.aborted) {
        throw new NflScheduleNetworkError(`NFL scoreboard request aborted for ${url}`, {
          url,
          retriable: false,
          cause: err,
        });
      }
      throw new NflScheduleNetworkError(
        `network error contacting ESPN: ${(err as Error).message}`,
        { url, retriable: true, cause: err },
      );
    } finally {
      clearTimeout(timer);
      if (opts.signal) opts.signal.removeEventListener("abort", onExternalAbort);
    }

    const text = await res.text();

    if (!res.ok) {
      // NOTE: an edge/CDN (Akamai) IP block shows up here as 403 with an HTML
      // "Access Denied" body — a transport block, not an auth failure.
      throw new NflScheduleError(
        `NFL scoreboard request failed (${res.status}) for ${url}`,
        {
          status: res.status,
          url,
          body: text.slice(0, 400),
          retriable: res.status === 429 || res.status >= 500,
        },
      );
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new NflScheduleParseError("ESPN scoreboard response was not JSON", {
        status: res.status,
        url,
        body: text.slice(0, 200),
        retriable: false,
      });
    }
  }
}

// --- option resolution -----------------------------------------------------

export function resolveRetry(
  retry: NflScheduleClientOptions["retry"],
): RetryOptions | null {
  if (retry === false) return null;
  if (!retry) return DEFAULT_RETRY;
  return { ...DEFAULT_RETRY, ...retry };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
