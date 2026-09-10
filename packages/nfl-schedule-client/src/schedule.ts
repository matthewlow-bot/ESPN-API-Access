// ---------------------------------------------------------------------------
// Pure schedule helpers.
//
// `firstKickoffPerGameDay` is what game reminders need: given a set of games,
// group them by calendar DAY in a configurable IANA timezone (default
// "America/New_York", since NFL scheduling is ET-centric), take each day's
// earliest kickoff, and return them sorted by that kickoff.
//
// Day-bucketing uses Intl.DateTimeFormat with a `timeZone` — no date libraries.
// A UTC instant maps to a wall-clock calendar day in the target zone, which is
// exactly how "Thursday game / Sunday games / Monday game" should be split.
// ---------------------------------------------------------------------------

import type { GameDayKickoff, NflGame } from "./types.js";

/** The subset of NflGame this helper needs — lets callers pass their own shape. */
export interface KickoffLike {
  /** ISO-8601 UTC kickoff string. */
  kickoff: string;
}

/** Default IANA timezone for day-bucketing. NFL scheduling is ET-centric. */
export const DEFAULT_SCHEDULE_TZ = "America/New_York";

/**
 * Return the calendar day ("YYYY-MM-DD") a UTC instant falls on in `timeZone`.
 * Uses Intl.DateTimeFormat with the en-CA locale, which formats as ISO-like
 * "YYYY-MM-DD", so no manual month/day zero-padding is needed.
 */
export function calendarDayInTz(instant: Date, timeZone: string): string {
  // "en-CA" yields YYYY-MM-DD; formatToParts avoids locale ordering surprises.
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * Group games by calendar day in `timeZone` and return each day's earliest
 * kickoff, sorted by kickoff ascending.
 *
 * @param games  Games to group (anything with an ISO `kickoff` string).
 * @param timeZone  IANA zone for day-bucketing. Default "America/New_York".
 */
export function firstKickoffPerGameDay<T extends KickoffLike>(
  games: readonly T[],
  timeZone: string = DEFAULT_SCHEDULE_TZ,
): GameDayKickoff[] {
  const byDay = new Map<string, { firstDate: Date; count: number }>();

  for (const game of games) {
    const date = new Date(game.kickoff);
    if (Number.isNaN(date.getTime())) continue; // skip unparseable kickoffs
    const day = calendarDayInTz(date, timeZone);
    const existing = byDay.get(day);
    if (!existing) {
      byDay.set(day, { firstDate: date, count: 1 });
    } else {
      existing.count += 1;
      if (date.getTime() < existing.firstDate.getTime()) {
        existing.firstDate = date;
      }
    }
  }

  const result: GameDayKickoff[] = [];
  for (const [gameDay, { firstDate, count }] of byDay) {
    result.push({
      gameDay,
      firstKickoff: firstDate.toISOString(),
      firstKickoffDate: firstDate,
      gameCount: count,
    });
  }
  result.sort(
    (a, b) => a.firstKickoffDate.getTime() - b.firstKickoffDate.getTime(),
  );
  return result;
}

/** Convenience: the single earliest kickoff across all games, or null. */
export function firstKickoffOfWeek(
  games: readonly NflGame[],
): NflGame | null {
  let earliest: NflGame | null = null;
  for (const game of games) {
    if (!earliest || game.kickoffDate.getTime() < earliest.kickoffDate.getTime()) {
      earliest = game;
    }
  }
  return earliest;
}
