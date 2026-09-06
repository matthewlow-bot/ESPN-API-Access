// ---------------------------------------------------------------------------
// Transport: the single espnFetch choke point (spec section 2.8).
//
// Handles URL build, cookie header (SWID brace-normalized), spoofed UA,
// Accept: application/json, optional X-Fantasy-Filter header, and an
// AbortController timeout. Wrapper order:
//   cache -> rate limiter -> retry/backoff -> fetch -> parse/classify errors
// Every public client method routes through here. This is the only place to
// patch when ESPN changes.
// ---------------------------------------------------------------------------

import {
  EspnApiError,
  EspnAuthError,
  EspnNetworkError,
  EspnParseError,
} from "./errors.js";
import type { CacheStore } from "./cache.js";
import { InMemoryCacheStore } from "./cache.js";
import type { RateLimiter, RateLimitOptions } from "./rateLimiter.js";
import { DefaultRateLimiter } from "./rateLimiter.js";
import { ESPN_READ_HOST } from "./maps.js";
import type {
  EspnClientOptions,
  EspnCreds,
  ReadOptions,
  RetryOptions,
} from "./types.js";

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36";

const DEFAULT_TIMEOUT_MS = 15_000;

/** Normalize a SWID to `{...}` form (ESPN accepts it braced). */
export function normalizeSwid(swid: string): string {
  return swid.startsWith("{") ? swid : `{${swid}}`;
}

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

export type EspnQueryParams = Record<string, string | number | undefined>;

export interface EspnRequest {
  views: string[];
  /** Optional X-Fantasy-Filter body (sent as a JSON header). */
  filter?: unknown;
  /** Extra query-string params, e.g. scoringPeriodId. */
  params?: EspnQueryParams;
}

interface ResolvedCache {
  store: CacheStore;
  ttlMs: number;
}

export class Transport {
  private readonly creds: EspnCreds;
  private readonly fetchImpl: typeof fetch;
  private readonly userAgent: string;
  private readonly timeoutMs: number;
  private readonly retry: RetryOptions | null;
  private readonly rateLimiter: RateLimiter | null;
  private readonly cache: ResolvedCache | null;

  constructor(options: EspnClientOptions) {
    this.creds = options.creds;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    if (typeof this.fetchImpl !== "function") {
      throw new Error(
        "No fetch implementation available. Provide fetchImpl or run on Node 18+.",
      );
    }
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    this.retry = resolveRetry(options.retry);
    this.rateLimiter = resolveRateLimiter(options.rateLimit);
    this.cache = resolveCache(options.cache);
  }

  get season(): number {
    return this.creds.season;
  }

  get leagueId(): string {
    return this.creds.leagueId;
  }

  /** Build the league URL for the given views and any extra query params. */
  private leagueUrl(views: string[], params?: EspnQueryParams): string {
    const base = `${ESPN_READ_HOST}/apis/v3/games/ffl/seasons/${this.creds.season}/segments/0/leagues/${this.creds.leagueId}`;
    const parts: string[] = views.map((v) => `view=${encodeURIComponent(v)}`);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value === undefined) continue;
        parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
      }
    }
    return parts.length ? `${base}?${parts.join("&")}` : base;
  }

  private cookieHeader(): string {
    return `espn_s2=${this.creds.espnS2}; SWID=${normalizeSwid(this.creds.swid)}`;
  }

  /**
   * The public entry: fetch the given views (with an optional X-Fantasy-Filter
   * and extra query params) and return parsed JSON.
   * Applies cache -> rate limit -> retry -> fetch.
   */
  async fetchJson(req: EspnRequest, opts: ReadOptions = {}): Promise<unknown> {
    const { views, filter, params } = req;
    const url = this.leagueUrl(views, params);
    const cacheKey = `GET ${url} ${filter !== undefined ? JSON.stringify(filter) : ""}`;

    if (this.cache && !opts.forceRefresh) {
      const hit = await this.cache.store.get(cacheKey);
      if (hit && hit.expiresAt > Date.now()) {
        return hit.value;
      }
    }

    const run = () => this.withRetry(url, filter, opts);
    const value = this.rateLimiter
      ? await this.rateLimiter.schedule(run)
      : await run();

    if (this.cache) {
      const ttl = opts.cacheTtlMs ?? this.cache.ttlMs;
      await this.cache.store.set(cacheKey, value, ttl);
    }
    return value;
  }

  private async withRetry(
    url: string,
    filter: unknown | undefined,
    opts: ReadOptions,
  ): Promise<unknown> {
    if (!this.retry) {
      return this.fetchOnce(url, filter, opts);
    }
    const { maxRetries, baseDelayMs, maxDelayMs, retryOn } = this.retry;
    let attempt = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        return await this.fetchOnce(url, filter, opts);
      } catch (err) {
        const apiErr = err as EspnApiError;
        const status = apiErr instanceof EspnApiError ? apiErr.status : undefined;
        const retriableByType =
          apiErr instanceof EspnApiError ? apiErr.retriable : false;
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
  private async fetchOnce(
    url: string,
    filter: unknown | undefined,
    opts: ReadOptions,
  ): Promise<unknown> {
    const headers: Record<string, string> = {
      Cookie: this.cookieHeader(),
      Accept: "application/json",
      "User-Agent": this.userAgent,
    };
    if (filter !== undefined) {
      headers["X-Fantasy-Filter"] = JSON.stringify(filter);
    }

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
        throw new EspnNetworkError(
          `ESPN request timed out after ${this.timeoutMs}ms for ${url}`,
          { url, retriable: true, cause: err },
        );
      }
      if (opts.signal?.aborted) {
        throw new EspnNetworkError(`ESPN request aborted for ${url}`, {
          url,
          retriable: false,
          cause: err,
        });
      }
      throw new EspnNetworkError(
        `network error contacting ESPN: ${(err as Error).message}`,
        { url, retriable: true, cause: err },
      );
    } finally {
      clearTimeout(timer);
      if (opts.signal) opts.signal.removeEventListener("abort", onExternalAbort);
    }

    const text = await res.text();

    if (res.status === 401) {
      throw new EspnAuthError(
        "ESPN returned 401 — espn_s2 / SWID are missing, expired, or not for this league.",
        { status: 401, url, body: text.slice(0, 400), retriable: false },
      );
    }
    if (!res.ok) {
      throw new EspnApiError(`ESPN request failed (${res.status}) for ${url}`, {
        status: res.status,
        url,
        body: text.slice(0, 400),
        retriable: res.status === 429 || res.status >= 500,
      });
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new EspnParseError(
        "ESPN response was not JSON (are the cookies valid?)",
        { status: res.status, url, body: text.slice(0, 200), retriable: false },
      );
    }
  }
}

// --- option resolution -----------------------------------------------------

export function resolveRetry(
  retry: EspnClientOptions["retry"],
): RetryOptions | null {
  if (retry === false) return null;
  if (!retry) return DEFAULT_RETRY;
  return { ...DEFAULT_RETRY, ...retry };
}

function isRateLimiter(value: unknown): value is RateLimiter {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as RateLimiter).schedule === "function"
  );
}

export function resolveRateLimiter(
  rateLimit: EspnClientOptions["rateLimit"],
): RateLimiter | null {
  if (rateLimit === false) return null;
  if (rateLimit === undefined) return new DefaultRateLimiter();
  if (isRateLimiter(rateLimit)) return rateLimit;
  return new DefaultRateLimiter(rateLimit as Partial<RateLimitOptions>);
}

function isCacheStore(value: unknown): value is CacheStore {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as CacheStore).get === "function" &&
    typeof (value as CacheStore).set === "function"
  );
}

const DEFAULT_CACHE_TTL_MS = 60_000;

export function resolveCache(
  cache: EspnClientOptions["cache"],
): ResolvedCache | null {
  // Caching is opt-in: undefined/false => disabled.
  if (!cache) return null;
  if (isCacheStore(cache)) {
    return { store: cache, ttlMs: DEFAULT_CACHE_TTL_MS };
  }
  const ttlMs = cache.ttlMs ?? DEFAULT_CACHE_TTL_MS;
  return { store: new InMemoryCacheStore(), ttlMs };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
