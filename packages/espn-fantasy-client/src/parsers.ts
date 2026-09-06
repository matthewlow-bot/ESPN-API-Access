// ---------------------------------------------------------------------------
// Pure parsers/mappers from ESPN's raw JSON nodes to the thin typed shapes.
//
// Kept pure and dependency-free so they can be unit-tested against synthetic
// fixtures with no network. Heavy optional chaining throughout, because the
// unofficial API's shape is not guaranteed.
// ---------------------------------------------------------------------------

import { POSITION_BY_ID, PRO_TEAM_ABBR } from "./maps.js";
import type {
  DraftPick,
  DraftSnapshot,
  EspnCreds,
  LeagueIdentity,
  LeagueSettings,
  Matchup,
  MatchupSide,
  Player,
  PlayerStats,
  Position,
  RosterEntry,
  StatSplit,
  Team,
  TeamRoster,
  TeamStanding,
  Transaction,
} from "./types.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

function positionFor(defaultPositionId: unknown): Position | null {
  return typeof defaultPositionId === "number"
    ? POSITION_BY_ID[defaultPositionId] ?? null
    : null;
}

function proTeamFor(proTeamId: unknown): string {
  return typeof proTeamId === "number" ? PRO_TEAM_ABBR[proTeamId] ?? "FA" : "FA";
}

function playerName(p: any): string {
  return (
    p?.fullName ??
    `${p?.firstName ?? ""} ${p?.lastName ?? ""}`.trim()
  );
}

// --- settings / identity ---------------------------------------------------

export function mapLeagueIdentity(data: any, creds: EspnCreds): LeagueIdentity {
  return {
    leagueId: creds.leagueId,
    season: creds.season,
    name: data?.settings?.name ?? `League ${creds.leagueId}`,
  };
}

export function mapSettings(data: any): LeagueSettings {
  const settings = data?.settings ?? {};
  const ds = settings.draftSettings ?? {};
  const rs = settings.rosterSettings ?? {};
  const scoringType: string | undefined =
    settings.scoringSettings?.scoringType ?? undefined;
  return {
    name: settings.name ?? "",
    size: settings.size ?? (Array.isArray(data?.teams) ? data.teams.length : 0),
    scoringType,
    draft: {
      type: ds.type ?? "AUCTION",
      auctionBudget: ds.auctionBudget ?? 0,
      pickOrder: Array.isArray(ds.pickOrder) ? ds.pickOrder : [],
    },
    roster: rs.lineupSlotCounts
      ? { lineupSlotCounts: rs.lineupSlotCounts }
      : undefined,
    raw: data,
  };
}

// --- teams -----------------------------------------------------------------

export function resolveTeamName(t: any): string {
  return (
    (t?.name && String(t.name).trim()) ||
    `${t?.location ?? ""} ${t?.nickname ?? ""}`.trim() ||
    t?.abbrev ||
    `Team ${t?.id}`
  );
}

export function mapTeams(data: any): Team[] {
  const teams: any[] = data?.teams ?? [];
  return teams.map((t) => {
    const owners: string[] | undefined = Array.isArray(t?.owners)
      ? t.owners
      : undefined;
    return {
      id: t?.id,
      name: resolveTeamName(t),
      abbrev: t?.abbrev ?? String(t?.id),
      logo: t?.logo ?? undefined,
      owners,
      raw: t,
    };
  });
}

// --- players ---------------------------------------------------------------

export function mapPlayer(entry: any): Player | null {
  const p = entry?.player ?? entry;
  if (!p) return null;
  const name = playerName(p);
  if (!name) return null;
  const auctionRaw =
    p?.ownership?.auctionValueAverage ??
    p?.draftRanksByRankType?.PPR?.auctionValue ??
    p?.draftRanksByRankType?.STANDARD?.auctionValue ??
    null;
  return {
    id: p.id,
    name,
    position: positionFor(p.defaultPositionId),
    proTeam: proTeamFor(p.proTeamId),
    auctionValueAverage: typeof auctionRaw === "number" ? auctionRaw : null,
    percentOwned:
      typeof p?.ownership?.percentOwned === "number"
        ? p.ownership.percentOwned
        : null,
    raw: p,
  };
}

export function mapPlayers(data: any): Player[] {
  const list: any[] = data?.players ?? (Array.isArray(data) ? data : []);
  const out: Player[] = [];
  for (const entry of list) {
    const player = mapPlayer(entry);
    if (player) out.push(player);
  }
  return out;
}

// --- draft -----------------------------------------------------------------

export function mapDraft(data: any): DraftSnapshot {
  const dd = data?.draftDetail ?? {};
  const rawPicks: any[] = dd?.picks ?? [];
  const picks: DraftPick[] = rawPicks
    .filter((p) => p && p.playerId > 0 && !p.reservedForKeeper)
    .map((p) => ({
      overallPickNumber: p.overallPickNumber ?? 0,
      playerId: p.playerId,
      teamId: p.teamId,
      bidAmount: p.bidAmount ?? 0,
      nominatingTeamId: p.nominatingTeamId,
      autoDrafted: p.autoDraftTypeId != null && p.autoDraftTypeId !== 0,
      keeper: Boolean(p.reservedForKeeper ?? p.keeper),
      raw: p,
    }))
    .sort((a, b) => a.overallPickNumber - b.overallPickNumber);
  return {
    drafted: Boolean(dd.drafted),
    inProgress: Boolean(dd.inProgress),
    picks,
    raw: data,
  };
}

// --- rosters ---------------------------------------------------------------

export function mapRosters(data: any): TeamRoster[] {
  const teams: any[] = data?.teams ?? [];
  return teams.map((t) => {
    const entries: any[] = t?.roster?.entries ?? [];
    const mapped: RosterEntry[] = entries.map((e) => {
      const p = e?.playerPoolEntry?.player ?? e?.player ?? {};
      return {
        playerId: e?.playerId ?? p?.id,
        name: playerName(p),
        position: positionFor(p?.defaultPositionId),
        lineupSlotId: e?.lineupSlotId,
        proTeam: proTeamFor(p?.proTeamId),
        raw: e,
      };
    });
    return { teamId: t?.id, entries: mapped, raw: t };
  });
}

// --- matchups / scoreboard -------------------------------------------------

function matchupSide(side: any): MatchupSide | null {
  if (!side || side.teamId == null) return null;
  const projected =
    side.totalProjectedPointsLive ?? side.totalProjectedPoints ?? undefined;
  const result: MatchupSide = {
    teamId: side.teamId,
    points: side.totalPoints ?? side.totalPointsLive ?? 0,
  };
  if (typeof projected === "number") result.projectedPoints = projected;
  return result;
}

export function mapMatchups(data: any): Matchup[] {
  const schedule: any[] = data?.schedule ?? [];
  const out: Matchup[] = [];
  for (const m of schedule) {
    const home = matchupSide(m?.home);
    if (!home) continue;
    out.push({
      matchupPeriodId: m?.matchupPeriodId ?? 0,
      home,
      away: matchupSide(m?.away),
      winner: m?.winner,
      raw: m,
    });
  }
  return out;
}

// --- standings -------------------------------------------------------------

export function mapStandings(data: any): TeamStanding[] {
  const teams: any[] = data?.teams ?? [];
  return teams.map((t) => {
    const overall = t?.record?.overall ?? {};
    return {
      teamId: t?.id,
      wins: overall.wins ?? 0,
      losses: overall.losses ?? 0,
      ties: overall.ties ?? 0,
      pointsFor: overall.pointsFor ?? 0,
      pointsAgainst: overall.pointsAgainst ?? 0,
      rank: t?.rankCalculatedFinal ?? t?.playoffSeed ?? undefined,
      raw: t,
    };
  });
}

// --- transactions ----------------------------------------------------------

export function mapTransactions(data: any): Transaction[] {
  const list: any[] = data?.transactions ?? [];
  return list.map((tx) => {
    const items: any[] = tx?.items ?? [];
    return {
      id: String(tx?.id ?? ""),
      type: tx?.type ?? "UNKNOWN",
      teamId: tx?.teamId,
      status: tx?.status,
      scoringPeriodId: tx?.scoringPeriodId,
      items: items.map((it) => ({
        playerId: it?.playerId,
        fromTeamId: it?.fromTeamId,
        toTeamId: it?.toTeamId,
        type: it?.type ?? "",
      })),
      raw: tx,
    };
  });
}

// --- player stats ----------------------------------------------------------

export function mapPlayerStats(data: any): PlayerStats[] {
  const list: any[] = data?.players ?? (Array.isArray(data) ? data : []);
  const out: PlayerStats[] = [];
  for (const entry of list) {
    const p = entry?.player ?? entry;
    if (!p) continue;
    const stats: any[] = p?.stats ?? [];
    // Group actual (statSourceId 0) and projected (statSourceId 1) by period.
    const byPeriod = new Map<number | null, StatSplit>();
    for (const s of stats) {
      const period: number | null =
        typeof s?.scoringPeriodId === "number" ? s.scoringPeriodId : null;
      const existing: StatSplit =
        byPeriod.get(period) ??
        ({ scoringPeriodId: period, applied: null } as StatSplit);
      const applied =
        typeof s?.appliedTotal === "number" ? s.appliedTotal : null;
      if (s?.statSourceId === 1) {
        existing.projected = applied;
      } else {
        existing.applied = applied;
      }
      byPeriod.set(period, existing);
    }
    out.push({
      playerId: p.id,
      name: playerName(p),
      splits: [...byPeriod.values()],
      raw: p,
    });
  }
  return out;
}
