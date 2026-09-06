// ---------------------------------------------------------------------------
// Public API surface for espn-fantasy-client.
// ---------------------------------------------------------------------------

export { EspnFantasyClient, buildPlayersFilter } from "./client.js";

// Collaborators (injectable) + their defaults
export { InMemoryCacheStore } from "./cache.js";
export type { CacheEntry, CacheStore } from "./cache.js";
export {
  DefaultRateLimiter,
  DEFAULT_RATE_LIMIT_OPTIONS,
} from "./rateLimiter.js";
export type { RateLimiter, RateLimitOptions } from "./rateLimiter.js";

// Errors
export {
  EspnApiError,
  EspnAuthError,
  EspnNetworkError,
  EspnParseError,
} from "./errors.js";
export type { EspnApiErrorInit } from "./errors.js";

// Constants (spec section 2.7 — documented, not applied)
export {
  ESPN_READ_HOST,
  ESPN_DEFAULT_AUCTION_BUDGET,
  POSITION_BY_ID,
  ID_BY_POSITION,
  PRO_TEAM_ABBR,
} from "./maps.js";

// Transport internals (advanced use / custom transports)
export { normalizeSwid, DEFAULT_RETRY } from "./transport.js";
export type { EspnRequest, EspnQueryParams } from "./transport.js";

// Parsers (pure mappers — exported for consumers that hold their own raw JSON)
export {
  mapLeagueIdentity,
  mapSettings,
  mapTeams,
  resolveTeamName,
  mapPlayer,
  mapPlayers,
  mapDraft,
  mapRosters,
  mapMatchups,
  mapStandings,
  mapTransactions,
  mapPlayerStats,
} from "./parsers.js";

// All public types
export type {
  EspnCreds,
  RetryOptions,
  EspnClientOptions,
  ReadOptions,
  Position,
  PlayerQuery,
  TransactionType,
  TransactionQuery,
  PlayerStatsQuery,
  LeagueIdentity,
  LeagueSettings,
  Team,
  Player,
  DraftPick,
  DraftSnapshot,
  RosterEntry,
  TeamRoster,
  MatchupSide,
  Matchup,
  TeamStanding,
  Transaction,
  StatSplit,
  PlayerStats,
} from "./types.js";
