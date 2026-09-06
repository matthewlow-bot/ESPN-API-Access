// ---------------------------------------------------------------------------
// EspnFantasyClient (spec section 2.4).
//
// A thin orchestration layer: each method builds the right view(s)/filter,
// routes through the single Transport choke point, and maps the raw JSON with
// a pure parser. No app opinions (no $1 floor, no budget scaling, no id
// prefixing) — ESPN's own ids and values are returned.
// ---------------------------------------------------------------------------

import { Transport } from "./transport.js";
import {
  currentMatchupPeriod,
  mapDraft,
  mapLeagueIdentity,
  mapMatchups,
  mapPlayers,
  mapPlayerStats,
  mapRosters,
  mapSettings,
  mapStandings,
  mapTeams,
  mapTransactions,
} from "./parsers.js";
import type {
  DraftSnapshot,
  EspnClientOptions,
  EspnCreds,
  LeagueIdentity,
  LeagueSettings,
  Matchup,
  Player,
  PlayerQuery,
  PlayerStats,
  PlayerStatsQuery,
  Position,
  ReadOptions,
  Team,
  TeamRoster,
  TeamStanding,
  Transaction,
  TransactionQuery,
} from "./types.js";

/**
 * ESPN lineup-slot ids used by the kona_player_info `filterSlotIds` filter.
 * These are lineup slots (not defaultPositionId); DST is 16, K is 17.
 */
const POSITION_TO_FILTER_SLOT: Record<Position, number> = {
  QB: 0,
  RB: 2,
  WR: 4,
  TE: 6,
  DST: 16,
  K: 17,
};

const DEFAULT_PLAYER_LIMIT = 500;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 1000;

export class EspnFantasyClient {
  private readonly transport: Transport;
  private readonly creds: EspnCreds;

  constructor(options: EspnClientOptions) {
    this.transport = new Transport(options);
    this.creds = options.creds;
  }

  /** mSettings — cheap auth + connectivity probe. Returns league identity. */
  async checkConnection(opts?: ReadOptions): Promise<LeagueIdentity> {
    const data = await this.transport.fetchJson({ views: ["mSettings"] }, opts);
    return mapLeagueIdentity(data, this.creds);
  }

  /** mSettings — full league settings. */
  async getSettings(opts?: ReadOptions): Promise<LeagueSettings> {
    const data = await this.transport.fetchJson({ views: ["mSettings"] }, opts);
    return mapSettings(data);
  }

  /** mTeam — teams with resolved names. */
  async getTeams(opts?: ReadOptions): Promise<Team[]> {
    const data = await this.transport.fetchJson({ views: ["mTeam"] }, opts);
    return mapTeams(data);
  }

  /** mDraftDetail — draft board / picks (keeper/invalid excluded, sorted). */
  async getDraft(opts?: ReadOptions): Promise<DraftSnapshot> {
    const data = await this.transport.fetchJson(
      { views: ["mDraftDetail"] },
      opts,
    );
    return mapDraft(data);
  }

  /**
   * kona_player_info — the draftable player universe with auction values.
   * Pages internally: the caller sees one flat Player[] and never deals with
   * ESPN's windowing. `pageSize` is exposed only for tuning.
   */
  async getPlayers(query: PlayerQuery = {}, opts?: ReadOptions): Promise<Player[]> {
    const limit = query.limit ?? DEFAULT_PLAYER_LIMIT;
    const pageSize = Math.min(query.pageSize ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    let offset = query.offset ?? 0;
    const all: Player[] = [];

    while (all.length < limit) {
      const want = Math.min(pageSize, limit - all.length);
      const filter = { players: buildPlayersFilter(query, want, offset) };
      const data = await this.transport.fetchJson(
        { views: ["kona_player_info"], filter },
        opts,
      );
      const page = mapPlayers(data);
      all.push(...page);
      if (page.length < want) break; // short page => universe exhausted
      offset += page.length;
    }
    return all.slice(0, limit);
  }

  /** kona_player_info + filterIds — named info for specific player ids. */
  async getPlayersByIds(ids: number[], opts?: ReadOptions): Promise<Player[]> {
    if (ids.length === 0) return [];
    // ESPN rejects a filter `limit` unless a sort is present too
    // ("Limit request must be accompanied by a sort"), so reuse the shared
    // builder, which always sets one. (Verified live 2026-09-05.)
    const filter = { players: buildPlayersFilter({ filterIds: ids }, ids.length, 0) };
    const data = await this.transport.fetchJson(
      { views: ["kona_player_info"], filter },
      opts,
    );
    return mapPlayers(data);
  }

  /** mRoster — current roster/lineup-slot assignments. */
  async getRosters(
    o: { scoringPeriodId?: number } = {},
    opts?: ReadOptions,
  ): Promise<TeamRoster[]> {
    const data = await this.transport.fetchJson(
      { views: ["mRoster"], params: { scoringPeriodId: o.scoringPeriodId } },
      opts,
    );
    return mapRosters(data);
  }

  /** mMatchup — head-to-head schedule/results. */
  async getMatchups(
    o: { matchupPeriodId?: number } = {},
    opts?: ReadOptions,
  ): Promise<Matchup[]> {
    // matchupPeriodId filtering is applied client-side; ESPN returns the full
    // schedule for mMatchup, and each entry carries matchupPeriodId (verified
    // live 2026-09-05).
    const data = await this.transport.fetchJson({ views: ["mMatchup"] }, opts);
    const all = mapMatchups(data);
    return o.matchupPeriodId == null
      ? all
      : all.filter((m) => m.matchupPeriodId === o.matchupPeriodId);
  }

  /**
   * Live scores for a matchup period. `mScoreboard` entries carry NO
   * matchupPeriodId on their own, so we request `mMatchup` alongside it — the
   * combined payload gives each entry both its matchupPeriodId and the live
   * scoring fields (totalPointsLive / totalProjectedPointsLive). Defaults to the
   * league's current matchup period. (Verified live 2026-09-05.)
   *
   * NOTE: the argument is named scoringPeriodId for parity with ESPN's URL param,
   * but results are matched on matchupPeriodId (== week in the regular season; a
   * playoff matchup period can span multiple scoring periods).
   */
  async getScoreboard(
    o: { scoringPeriodId?: number } = {},
    opts?: ReadOptions,
  ): Promise<Matchup[]> {
    const data = await this.transport.fetchJson(
      {
        views: ["mMatchup", "mScoreboard"],
        params: { scoringPeriodId: o.scoringPeriodId },
      },
      opts,
    );
    const all = mapMatchups(data);
    const target = o.scoringPeriodId ?? currentMatchupPeriod(data);
    return target == null ? all : all.filter((m) => m.matchupPeriodId === target);
  }

  /** mTeam — standings (record block: W/L/T, points for/against). */
  async getStandings(opts?: ReadOptions): Promise<TeamStanding[]> {
    const data = await this.transport.fetchJson({ views: ["mTeam"] }, opts);
    return mapStandings(data);
  }

  /** mTransactions2 — waiver / free-agency / trade activity. */
  async getTransactions(
    o: TransactionQuery = {},
    opts?: ReadOptions,
  ): Promise<Transaction[]> {
    // types / teamId filters are applied client-side (mTransactions2 returns all).
    // items[] mapping verified against live waiver ADD/DROP payloads 2026-09-05;
    // trade payloads still to be confirmed against a live sample.
    const data = await this.transport.fetchJson(
      {
        views: ["mTransactions2"],
        params: { scoringPeriodId: o.scoringPeriodId },
      },
      opts,
    );
    let txns = mapTransactions(data);
    if (o.teamId != null) txns = txns.filter((t) => t.teamId === o.teamId);
    if (o.types && o.types.length > 0) {
      const set = new Set(o.types);
      txns = txns.filter((t) => set.has(t.type));
    }
    return txns;
  }

  /** mPendingTransactions — pending (not-yet-processed) transactions. */
  async getPendingTransactions(opts?: ReadOptions): Promise<Transaction[]> {
    const data = await this.transport.fetchJson(
      { views: ["mPendingTransactions"] },
      opts,
    );
    return mapTransactions(data);
  }

  /**
   * kona_player_info — actual + projected points from the `stats[]` blocks
   * embedded in each player payload (statSourceId 0 = actual, 1 = projected).
   *
   * Two ESPN requirements here, both verified live 2026-09-05:
   *  - a filter `limit` must be accompanied by a sort, else HTTP 400
   *    ("Limit request must be accompanied by a sort"); buildPlayersFilter adds one.
   *  - scoringPeriodId must NOT be sent as a URL query param on this view (400);
   *    the embedded splits already carry per-period data, so we scope client-side.
   */
  async getPlayerStats(
    o: PlayerStatsQuery,
    opts?: ReadOptions,
  ): Promise<PlayerStats[]> {
    const want =
      o.playerIds && o.playerIds.length > 0
        ? o.playerIds.length
        : DEFAULT_PLAYER_LIMIT;
    const filter = {
      players: buildPlayersFilter({ filterIds: o.playerIds }, want, 0),
    };
    const data = await this.transport.fetchJson(
      { views: ["kona_player_info"], filter },
      opts,
    );
    let stats = mapPlayerStats(data);
    if (o.scoringPeriodId != null) {
      stats = stats.map((s) => ({
        ...s,
        splits: s.splits.filter((sp) => sp.scoringPeriodId === o.scoringPeriodId),
      }));
    }
    return stats;
  }

  /**
   * Low-level escape hatch: pick views + optional X-Fantasy-Filter; returns
   * parsed JSON as-is. Not exposed by the MCP server.
   */
  async raw(views: string[], filter?: unknown, opts?: ReadOptions): Promise<unknown> {
    return this.transport.fetchJson({ views, filter }, opts);
  }
}

// --- helpers ---------------------------------------------------------------

export function buildPlayersFilter(
  query: PlayerQuery,
  limit: number,
  offset: number,
): Record<string, unknown> {
  const filter: Record<string, unknown> = { limit, offset };
  const asc = query.sortAsc;
  switch (query.sort ?? "draftRank") {
    case "percentOwned":
      filter["sortPercOwned"] = { sortPriority: 1, sortAsc: asc ?? false };
      break;
    case "auctionValue":
      // No dedicated auction-value sort in ESPN's filter; draft rank is the
      // closest proxy and auctionValueAverage tracks it closely.
      filter["sortDraftRanks"] = {
        sortPriority: 100,
        sortAsc: asc ?? true,
        value: "STANDARD",
      };
      break;
    case "draftRank":
    default:
      filter["sortDraftRanks"] = {
        sortPriority: 100,
        sortAsc: asc ?? true,
        value: "STANDARD",
      };
      break;
  }
  if (query.filterIds && query.filterIds.length > 0) {
    filter["filterIds"] = { value: query.filterIds };
  }
  if (query.positions && query.positions.length > 0) {
    filter["filterSlotIds"] = {
      value: query.positions.map((p) => POSITION_TO_FILTER_SLOT[p]),
    };
  }
  return filter;
}
