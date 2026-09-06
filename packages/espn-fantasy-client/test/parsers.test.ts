import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  mapPlayers,
  mapPlayer,
  mapDraft,
  mapTeams,
  resolveTeamName,
  mapSettings,
  mapRosters,
  mapMatchups,
  mapStandings,
  mapTransactions,
  mapPlayerStats,
} from "../dist/index.js";

function fixture(name: string): unknown {
  const url = new URL(`./fixtures/${name}`, import.meta.url);
  return JSON.parse(readFileSync(fileURLToPath(url), "utf8"));
}

test("mapPlayers: ownership auction value, PPR fallback, unmapped position, no-name drop", () => {
  const players = mapPlayers(fixture("players.json"));
  // The no-name player (id 111111) is dropped; 3 remain.
  assert.equal(players.length, 3);

  const mahomes = players[0]!;
  assert.equal(mahomes.id, 3139477);
  assert.equal(mahomes.name, "Patrick Mahomes");
  assert.equal(mahomes.position, "QB");
  assert.equal(mahomes.proTeam, "KC");
  assert.equal(mahomes.auctionValueAverage, 42.5); // ownership wins over draftRanks
  assert.equal(mahomes.percentOwned, 99.8);

  const bijan = players[1]!;
  assert.equal(bijan.name, "Bijan Robinson"); // first+last fallback
  assert.equal(bijan.position, "RB");
  assert.equal(bijan.auctionValueAverage, 55); // draftRanksByRankType.PPR fallback

  const unmapped = players[2]!;
  assert.equal(unmapped.position, null); // defaultPositionId 99 not mapped
  assert.equal(unmapped.proTeam, "FA"); // proTeamId 500 not mapped -> FA
  assert.equal(unmapped.auctionValueAverage, null);
});

test("mapPlayer: raw passthrough is the ESPN player node", () => {
  const node = { player: { id: 7, fullName: "X", defaultPositionId: 2, proTeamId: 1 } };
  const p = mapPlayer(node);
  assert.ok(p);
  assert.equal((p!.raw as { id: number }).id, 7);
});

test("mapDraft: excludes keeper + playerId<=0, sorts by overall pick, flags auto-draft", () => {
  const snap = mapDraft(fixture("draft.json"));
  assert.equal(snap.drafted, true);
  assert.equal(snap.inProgress, false);
  // 2 of 4 picks survive (keeper and playerId 0 removed).
  assert.equal(snap.picks.length, 2);
  assert.deepEqual(
    snap.picks.map((p) => p.overallPickNumber),
    [1, 3],
  );
  const first = snap.picks[0]!;
  assert.equal(first.playerId, 3139477);
  assert.equal(first.autoDrafted, true); // autoDraftTypeId 2
  assert.equal(snap.picks[1]!.autoDrafted, false); // autoDraftTypeId 0
});

test("mapTeams / resolveTeamName: name -> location+nickname -> abbrev -> Team N", () => {
  const teams = mapTeams(fixture("teams.json"));
  assert.equal(teams[0]!.name, "The Vampires");
  assert.equal(teams[1]!.name, "Night Crawlers");
  assert.equal(teams[2]!.name, "ABC"); // only abbrev
  assert.equal(teams[3]!.name, "Team 4"); // nothing -> Team N
  assert.deepEqual(teams[0]!.owners, ["{OWNER-1}"]);
  assert.equal(teams[2]!.abbrev, "ABC");

  assert.equal(resolveTeamName({ id: 9 }), "Team 9");
});

test("mapSettings: name/size/scoringType/draft/roster slot counts", () => {
  const s = mapSettings(fixture("settings.json"));
  assert.equal(s.name, "Cool People League");
  assert.equal(s.size, 12);
  assert.equal(s.scoringType, "PPR");
  assert.equal(s.draft.type, "AUCTION");
  assert.equal(s.draft.auctionBudget, 300); // NOT scaled to 200
  assert.deepEqual(s.draft.pickOrder, [1, 2, 3, 4]);
  assert.equal(s.roster?.lineupSlotCounts?.[2], 2);
});

test("mapRosters: entries carry playerId, name, position, lineupSlotId", () => {
  const rosters = mapRosters(fixture("rosters.json"));
  assert.equal(rosters.length, 1);
  const entries = rosters[0]!.entries;
  assert.equal(entries.length, 2);
  assert.equal(entries[0]!.playerId, 3139477);
  assert.equal(entries[0]!.position, "QB");
  assert.equal(entries[0]!.lineupSlotId, 0);
  assert.equal(entries[1]!.proTeam, "ATL");
});

test("mapMatchups: bye => away null, side points/projected, winner passthrough", () => {
  const matchups = mapMatchups(fixture("matchups.json"));
  assert.equal(matchups.length, 3);
  assert.equal(matchups[0]!.home.points, 120.5);
  assert.equal(matchups[0]!.home.projectedPoints, 118.0);
  assert.equal(matchups[0]!.away?.points, 99.2);
  assert.equal(matchups[0]!.winner, "HOME");
  assert.equal(matchups[1]!.away, null); // bye
});

test("mapStandings: record block + rank fallbacks", () => {
  const standings = mapStandings(fixture("standings.json"));
  assert.equal(standings[0]!.wins, 10);
  assert.equal(standings[0]!.pointsFor, 1500.5);
  assert.equal(standings[0]!.rank, 1); // rankCalculatedFinal
  assert.equal(standings[1]!.ties, 1);
  assert.equal(standings[1]!.rank, 2); // playoffSeed fallback
});

test("mapTransactions: items map add/drop/trade with from/to team ids", () => {
  const txns = mapTransactions(fixture("transactions.json"));
  assert.equal(txns.length, 3);
  const waiver = txns[0]!;
  assert.equal(waiver.type, "WAIVER");
  assert.equal(waiver.items.length, 2);
  assert.equal(waiver.items[0]!.type, "ADD");
  assert.equal(waiver.items[0]!.toTeamId, 1);
  assert.equal(waiver.items[1]!.fromTeamId, 1);
  const trade = txns[1]!;
  assert.equal(trade.items[0]!.fromTeamId, 2);
  assert.equal(trade.items[0]!.toTeamId, 3);
});

test("mapPlayerStats: groups actual (source 0) and projected (source 1) per period", () => {
  const stats = mapPlayerStats(fixture("playerstats.json"));
  assert.equal(stats.length, 1);
  const splits = stats[0]!.splits;
  const wk1 = splits.find((s) => s.scoringPeriodId === 1)!;
  assert.equal(wk1.applied, 24.3);
  assert.equal(wk1.projected, 21.0);
  const wk2 = splits.find((s) => s.scoringPeriodId === 2)!;
  assert.equal(wk2.applied, null); // only a projection present
  assert.equal(wk2.projected, 22.5);
});
