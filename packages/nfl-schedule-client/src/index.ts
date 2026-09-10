// ---------------------------------------------------------------------------
// Public API surface for nfl-schedule-client.
// ---------------------------------------------------------------------------

export { NflScheduleClient } from "./client.js";

// Errors
export {
  NflScheduleError,
  NflScheduleNetworkError,
  NflScheduleParseError,
} from "./errors.js";
export type { NflScheduleErrorInit } from "./errors.js";

// Transport internals (advanced use / custom transports)
export { Transport, ESPN_SCOREBOARD_URL, DEFAULT_RETRY } from "./transport.js";
export type { QueryParams } from "./transport.js";

// Parsers (pure mappers — exported for consumers that hold their own raw JSON)
export { mapGame, mapScoreboard } from "./parsers.js";

// Schedule helpers (pure — the first-kickoff-per-day grouping for reminders)
export {
  firstKickoffPerGameDay,
  firstKickoffOfWeek,
  calendarDayInTz,
  DEFAULT_SCHEDULE_TZ,
} from "./schedule.js";
export type { KickoffLike } from "./schedule.js";

// All public types
export type {
  RetryOptions,
  NflScheduleClientOptions,
  ReadOptions,
  SeasonType,
  GetWeekQuery,
  NflGame,
  GameDayKickoff,
} from "./types.js";
