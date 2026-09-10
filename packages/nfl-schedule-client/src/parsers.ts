// ---------------------------------------------------------------------------
// Pure parsers/mappers from ESPN's public scoreboard JSON to the thin typed
// shapes. Kept pure and dependency-free so they can be unit-tested against a
// committed fixture with no network. Heavy optional chaining throughout,
// because the public API's shape, while well-documented, is not guaranteed.
// ---------------------------------------------------------------------------

import type { NflGame } from "./types.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

function abbrevFor(competitors: any[], side: "home" | "away"): string | null {
  const c = competitors.find((x) => x?.homeAway === side);
  const abbrev = c?.team?.abbreviation;
  return typeof abbrev === "string" && abbrev.length > 0 ? abbrev : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Map a single ESPN event node -> NflGame. Returns null if the event lacks the
 * two things every downstream feature needs: an id and a valid kickoff date.
 */
export function mapGame(event: any): NflGame | null {
  const id = event?.id != null ? String(event.id) : null;
  const kickoff = str(event?.date);
  if (!id || !kickoff) return null;

  const kickoffDate = new Date(kickoff);
  if (Number.isNaN(kickoffDate.getTime())) return null;

  const competition = Array.isArray(event?.competitions)
    ? event.competitions[0]
    : undefined;
  const competitors: any[] = Array.isArray(competition?.competitors)
    ? competition.competitors
    : [];

  return {
    id,
    kickoff: kickoffDate.toISOString(),
    kickoffDate,
    homeTeam: abbrevFor(competitors, "home"),
    awayTeam: abbrevFor(competitors, "away"),
    shortName: str(event?.shortName),
    name: str(event?.name),
    week: num(event?.week?.number),
    season: num(event?.season?.year),
    raw: event,
  };
}

/**
 * Map the top-level scoreboard payload -> NflGame[]. Skips malformed events,
 * and sorts by kickoff ascending so the order is stable regardless of ESPN's.
 */
export function mapScoreboard(data: any): NflGame[] {
  const events: any[] = Array.isArray(data?.events) ? data.events : [];
  const games: NflGame[] = [];
  for (const event of events) {
    const game = mapGame(event);
    if (game) games.push(game);
  }
  games.sort((a, b) => a.kickoffDate.getTime() - b.kickoffDate.getTime());
  return games;
}
