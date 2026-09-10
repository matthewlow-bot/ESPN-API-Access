import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { mapScoreboard, mapGame } from "../dist/index.js";

function fixture(name: string): unknown {
  const url = new URL(`./fixtures/${name}`, import.meta.url);
  return JSON.parse(readFileSync(fileURLToPath(url), "utf8"));
}

test("mapScoreboard: maps every event, sorts by kickoff ascending", () => {
  const games = mapScoreboard(fixture("scoreboard.json"));
  assert.equal(games.length, 6);

  // Sorted by kickoff regardless of the fixture's event order.
  assert.deepEqual(
    games.map((g) => g.shortName),
    ["DAL @ PHI", "KC @ LAC", "TB @ ATL", "DEN @ SEA", "BAL @ BUF", "MIN @ CHI"],
  );
});

test("mapGame: home/away abbreviations, kickoff normalized to ISO UTC, week/season", () => {
  const games = mapScoreboard(fixture("scoreboard.json"));

  const thu = games[0]!; // DAL @ PHI (Thursday night)
  assert.equal(thu.id, "401700001");
  assert.equal(thu.homeTeam, "PHI");
  assert.equal(thu.awayTeam, "DAL");
  assert.equal(thu.name, "Dallas Cowboys at Philadelphia Eagles");
  assert.equal(thu.kickoff, "2025-09-05T00:20:00.000Z");
  assert.ok(thu.kickoffDate instanceof Date);
  assert.equal(thu.kickoffDate.getTime(), Date.parse("2025-09-05T00:20Z"));
  assert.equal(thu.week, 1);
  assert.equal(thu.season, 2025);
});

test("mapGame: raw passthrough is the ESPN event node", () => {
  const g = mapGame({
    id: 42,
    date: "2025-09-07T17:00Z",
    competitions: [{ competitors: [] }],
  });
  assert.ok(g);
  assert.equal(g!.id, "42"); // id stringified
  assert.equal((g!.raw as { id: number }).id, 42);
  assert.equal(g!.homeTeam, null); // no competitors -> null, not a throw
  assert.equal(g!.awayTeam, null);
});

test("mapGame: drops events missing an id or a valid kickoff date", () => {
  assert.equal(mapGame({ date: "2025-09-07T17:00Z" }), null); // no id
  assert.equal(mapGame({ id: "1" }), null); // no date
  assert.equal(mapGame({ id: "1", date: "not-a-date" }), null); // unparseable
});

test("mapScoreboard: tolerates a missing/empty events array", () => {
  assert.deepEqual(mapScoreboard({}), []);
  assert.deepEqual(mapScoreboard({ events: null }), []);
  assert.deepEqual(mapScoreboard(undefined), []);
});
