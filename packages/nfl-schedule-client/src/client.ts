// ---------------------------------------------------------------------------
// NflScheduleClient.
//
// A thin orchestration layer over ESPN's PUBLIC (no-auth) scoreboard API: build
// query params, route through the single Transport choke point, and map the raw
// JSON with a pure parser. No app opinions — ESPN's own ids/values are returned,
// each game keeping a `raw` escape hatch.
// ---------------------------------------------------------------------------

import { Transport } from "./transport.js";
import { mapScoreboard } from "./parsers.js";
import type {
  GetWeekQuery,
  NflGame,
  NflScheduleClientOptions,
  ReadOptions,
} from "./types.js";

const DEFAULT_SEASON_TYPE = 2; // regular season

export class NflScheduleClient {
  private readonly transport: Transport;

  constructor(options: NflScheduleClientOptions = {}) {
    this.transport = new Transport(options);
  }

  /**
   * Fetch a week's games from the public scoreboard.
   *
   * All params are optional: omit `week`/`year` to let ESPN return the current
   * week/season. `seasonType` defaults to 2 (regular season).
   *
   * Returns typed NflGame[] sorted by kickoff ascending.
   */
  async getWeek(query: GetWeekQuery = {}, opts?: ReadOptions): Promise<NflGame[]> {
    const params = {
      week: query.week,
      year: query.year,
      seasontype: query.seasonType ?? DEFAULT_SEASON_TYPE,
    };
    const data = await this.transport.fetchJson(params, opts);
    return mapScoreboard(data);
  }

  /**
   * Low-level escape hatch: pass raw query params, get parsed JSON as-is.
   * Useful for fields the typed client doesn't model yet.
   */
  async raw(
    params?: Record<string, string | number | undefined>,
    opts?: ReadOptions,
  ): Promise<unknown> {
    return this.transport.fetchJson(params, opts);
  }
}
