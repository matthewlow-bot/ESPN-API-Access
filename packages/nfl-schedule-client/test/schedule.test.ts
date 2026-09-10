import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  mapScoreboard,
  firstKickoffPerGameDay,
  firstKickoffOfWeek,
  calendarDayInTz,
} from "../dist/index.js";

function fixture(name: string): unknown {
  const url = new URL(`./fixtures/${name}`, import.meta.url);
  return JSON.parse(readFileSync(fileURLToPath(url), "utf8"));
}

test("firstKickoffPerGameDay: buckets Thu/Sun/Mon in ET, earliest kickoff each", () => {
  const games = mapScoreboard(fixture("scoreboard.json"));
  const days = firstKickoffPerGameDay(games); // default tz America/New_York

  // Three ET game days: Thursday, Sunday, Monday. The Sunday-night (BAL @ BUF,
  // 00:20Z Monday in UTC) collapses into Sunday ET, proving tz bucketing works.
  assert.equal(days.length, 3);

  const [thu, sun, mon] = days;

  assert.equal(thu!.gameDay, "2025-09-04");
  assert.equal(thu!.firstKickoff, "2025-09-05T00:20:00.000Z"); // DAL @ PHI TNF
  assert.equal(thu!.gameCount, 1);

  assert.equal(sun!.gameDay, "2025-09-07");
  assert.equal(sun!.firstKickoff, "2025-09-07T17:00:00.000Z"); // earliest 1pm ET
  assert.equal(sun!.gameCount, 4); // two 1pm, one 4pm, one SNF

  assert.equal(mon!.gameDay, "2025-09-08");
  assert.equal(mon!.firstKickoff, "2025-09-09T00:15:00.000Z"); // MIN @ CHI MNF
  assert.equal(mon!.gameCount, 1);

  // Returned sorted by kickoff.
  assert.deepEqual(
    days.map((d) => d.gameDay),
    ["2025-09-04", "2025-09-07", "2025-09-08"],
  );
});

test("firstKickoffPerGameDay: timezone is configurable — UTC splits SNF/MNF off", () => {
  const games = mapScoreboard(fixture("scoreboard.json"));
  const days = firstKickoffPerGameDay(games, "UTC");

  // In UTC the Sunday-night and Monday-night games fall on later calendar days,
  // so the same fixture yields four buckets instead of three.
  assert.deepEqual(
    days.map((d) => ({ day: d.gameDay, count: d.gameCount })),
    [
      { day: "2025-09-05", count: 1 }, // DAL @ PHI (Fri UTC)
      { day: "2025-09-07", count: 3 }, // KC, TB, DEN (Sun UTC)
      { day: "2025-09-08", count: 1 }, // BAL @ BUF (Mon UTC)
      { day: "2025-09-09", count: 1 }, // MIN @ CHI (Tue UTC)
    ],
  );
});

test("firstKickoffPerGameDay: empty input -> empty output; skips unparseable", () => {
  assert.deepEqual(firstKickoffPerGameDay([]), []);
  const days = firstKickoffPerGameDay([
    { kickoff: "2025-09-07T17:00Z" },
    { kickoff: "garbage" },
  ]);
  assert.equal(days.length, 1);
  assert.equal(days[0]!.gameCount, 1);
});

test("calendarDayInTz: same instant, different zone -> different calendar day", () => {
  const snf = new Date("2025-09-08T00:20Z"); // 8:20pm ET Sunday
  assert.equal(calendarDayInTz(snf, "America/New_York"), "2025-09-07");
  assert.equal(calendarDayInTz(snf, "UTC"), "2025-09-08");
  assert.equal(calendarDayInTz(snf, "America/Los_Angeles"), "2025-09-07");
});

test("firstKickoffOfWeek: returns the single earliest game", () => {
  const games = mapScoreboard(fixture("scoreboard.json"));
  const first = firstKickoffOfWeek(games);
  assert.ok(first);
  assert.equal(first!.shortName, "DAL @ PHI");
  assert.equal(firstKickoffOfWeek([]), null);
});
