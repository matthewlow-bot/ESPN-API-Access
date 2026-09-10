// ---------------------------------------------------------------------------
// Public types.
//
// Thin typing: we model only the fields we actively extract from ESPN's public
// scoreboard payload. Every returned game carries a `raw` property holding
// ESPN's original event node, so a consumer can reach an un-modeled field
// (venue, odds, broadcast, live status, ...) without a library change.
// ---------------------------------------------------------------------------

// --- construction ----------------------------------------------------------

export interface RetryOptions {
  /** Max retry attempts after the first try. Default 3. */
  maxRetries: number;
  /** Exponential base: baseDelayMs * 2^attempt + jitter. Default 300. */
  baseDelayMs: number;
  /** Cap on any single backoff delay. Default 5000. */
  maxDelayMs: number;
  /** Decide whether a failed attempt is retriable. Default: network/timeout, 5xx, 429. */
  retryOn: (info: { status?: number; error?: Error }) => boolean;
}

export interface NflScheduleClientOptions {
  /** Per-request timeout. Default 15000ms. */
  timeoutMs?: number;
  /** false disables retries. Partial merges over defaults. */
  retry?: Partial<RetryOptions> | false;
  /** Override the spoofed desktop-Chrome UA if needed. */
  userAgent?: string;
  /** Override the scoreboard host/path base if ESPN moves it. */
  baseUrl?: string;
  /** Injectable for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

// --- read options ----------------------------------------------------------

export interface ReadOptions {
  signal?: AbortSignal;
}

/** ESPN season types. 1 = preseason, 2 = regular season, 3 = postseason. */
export type SeasonType = 1 | 2 | 3;

export interface GetWeekQuery {
  /** Week number. Omit to let ESPN return the current week. */
  week?: number;
  /** Season year (e.g. 2025). Omit to let ESPN return the current season. */
  year?: number;
  /** Default 2 (regular season). */
  seasonType?: SeasonType;
}

// --- return types (thin, with `raw`) ---------------------------------------

export interface NflGame {
  /** ESPN event id. */
  id: string;
  /** Kickoff time as an ISO-8601 UTC string (ESPN's event `date`). */
  kickoff: string;
  /** Kickoff as a Date, parsed from `kickoff`. */
  kickoffDate: Date;
  /** e.g. "PHI" — the home team abbreviation, when resolvable. */
  homeTeam: string | null;
  /** e.g. "DAL" — the away team abbreviation, when resolvable. */
  awayTeam: string | null;
  /** ESPN's short name, e.g. "DAL @ PHI". */
  shortName: string | null;
  /** ESPN's full event name, e.g. "Dallas Cowboys at Philadelphia Eagles". */
  name: string | null;
  /** Week number for this game. */
  week: number | null;
  /** Season year for this game. */
  season: number | null;
  /** ESPN's original event node — escape hatch for un-modeled fields. */
  raw: unknown;
}

// --- schedule grouping (first-kickoff-per-day helper) ----------------------

export interface GameDayKickoff {
  /** Calendar day in the configured timezone, as an ISO date "YYYY-MM-DD". */
  gameDay: string;
  /** The earliest kickoff on that day, as an ISO-8601 UTC string. */
  firstKickoff: string;
  /** The earliest kickoff on that day, as a Date. */
  firstKickoffDate: Date;
  /** Number of games scheduled on that day. */
  gameCount: number;
}
