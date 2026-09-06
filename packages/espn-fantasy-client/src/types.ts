// ---------------------------------------------------------------------------
// Public types (spec sections 2.1, 2.4, 2.5, 2.6).
//
// Thin typing: we model only the fields we actively extract. Every returned
// object carries a `raw` property holding ESPN's original node, so a consumer
// can reach an un-modeled field without a library change.
// ---------------------------------------------------------------------------

import type { CacheStore } from "./cache.js";
import type { RateLimiter, RateLimitOptions } from "./rateLimiter.js";

// --- construction ----------------------------------------------------------

export interface EspnCreds {
  leagueId: string;
  season: number;
  espnS2: string;
  /** Accepted with or without braces; normalized to `{...}` internally. */
  swid: string;
}

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

export interface EspnClientOptions {
  creds: EspnCreds;
  /** Per-request timeout. Default 15000ms. */
  timeoutMs?: number;
  /** false disables retries. Partial merges over defaults. */
  retry?: Partial<RetryOptions> | false;
  /** Pass options to use the built-in limiter, a RateLimiter to inject your own,
   *  or false to disable limiting. Default: built-in with RateLimitOptions defaults. */
  rateLimit?: RateLimitOptions | RateLimiter | false;
  /** Pass {ttlMs} to use the built-in in-memory cache, a CacheStore to inject your own,
   *  or false to disable caching (default). Caching is OPT-IN. */
  cache?: CacheStore | { ttlMs?: number } | false;
  /** Override the spoofed desktop-Chrome UA if needed. */
  userAgent?: string;
  /** Injectable for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

// --- read options ----------------------------------------------------------

export interface ReadOptions {
  signal?: AbortSignal;
  /** Override the client's cache TTL for this call. */
  cacheTtlMs?: number;
  /** Skip a cache hit and refresh. */
  forceRefresh?: boolean;
}

// --- domain enums ----------------------------------------------------------

export type Position = "QB" | "RB" | "WR" | "TE" | "K" | "DST";

// --- query shapes ----------------------------------------------------------

export interface PlayerQuery {
  /** Total wanted across pages; default 500. Internally paged. */
  limit?: number;
  /** ESPN window per request; default 50, max 1000. */
  pageSize?: number;
  /** Starting offset; default 0. */
  offset?: number;
  /** Convenience -> lineup slot filter. */
  positions?: Position[];
  filterIds?: number[];
  sort?: "draftRank" | "percentOwned" | "auctionValue";
  sortAsc?: boolean;
}

export type TransactionType = string; // pass through ESPN's own type strings

export interface TransactionQuery {
  types?: TransactionType[];
  teamId?: number;
  scoringPeriodId?: number;
}

export interface PlayerStatsQuery {
  playerIds?: number[];
  /** A week; omit for season totals. */
  scoringPeriodId?: number;
}

// --- return types (thin, each with `raw`) ----------------------------------

export interface LeagueIdentity {
  leagueId: string;
  season: number;
  name: string;
}

export interface LeagueSettings {
  name: string;
  /** Number of teams. */
  size: number;
  /** e.g. 'PPR', 'STANDARD' when derivable. */
  scoringType?: string;
  draft: {
    type: string; // 'AUCTION' | 'SNAKE' | ...
    auctionBudget: number;
    pickOrder: number[]; // espn team ids
  };
  /** raw-ish slot map when present. */
  roster?: { lineupSlotCounts?: Record<number, number> };
  raw: unknown;
}

export interface Team {
  id: number; // espn team id
  /** resolved (name || location+nickname || abbrev || `Team N`). */
  name: string;
  abbrev: string;
  logo?: string;
  /** member ids, when present. */
  owners?: string[];
  raw: unknown;
}

export interface Player {
  id: number; // espn player id (NOT prefixed)
  name: string;
  /** null when defaultPositionId isn't one we map. */
  position: Position | null;
  /** NFL abbr, or 'FA'. */
  proTeam: string;
  /** ESPN average auction value, calibrated to ESPN's $200 default. NOT scaled. */
  auctionValueAverage: number | null;
  percentOwned?: number | null;
  raw: unknown;
}

export interface DraftPick {
  overallPickNumber: number;
  playerId: number;
  teamId: number;
  bidAmount: number;
  nominatingTeamId?: number;
  autoDrafted: boolean;
  keeper: boolean;
  raw: unknown;
}

export interface DraftSnapshot {
  drafted: boolean;
  inProgress: boolean;
  /** sorted by overallPickNumber; keeper/invalid picks excluded by default. */
  picks: DraftPick[];
  raw: unknown;
}

export interface RosterEntry {
  playerId: number;
  name: string;
  position: Position | null;
  /** ESPN lineup slot; not remapped. */
  lineupSlotId: number;
  proTeam: string;
  raw: unknown;
}

export interface TeamRoster {
  teamId: number;
  entries: RosterEntry[];
  raw: unknown;
}

export interface MatchupSide {
  teamId: number;
  points: number;
  projectedPoints?: number;
}

export interface Matchup {
  matchupPeriodId: number;
  home: MatchupSide;
  /** null for a bye. */
  away: MatchupSide | null;
  winner?: "HOME" | "AWAY" | "TIE" | "UNDECIDED";
  raw: unknown;
}

export interface TeamStanding {
  teamId: number;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
  rank?: number;
  raw: unknown;
}

export interface Transaction {
  id: string;
  type: TransactionType;
  teamId?: number;
  status?: string;
  scoringPeriodId?: number;
  items: Array<{
    playerId: number;
    fromTeamId?: number;
    toTeamId?: number;
    type: string;
  }>;
  raw: unknown;
}

export interface StatSplit {
  scoringPeriodId: number | null;
  applied: number | null;
  projected?: number | null;
}

export interface PlayerStats {
  playerId: number;
  name: string;
  splits: StatSplit[];
  raw: unknown;
}
