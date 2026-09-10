# nfl-schedule-client

Read-only, dependency-free client for the NFL game schedule, sourced from
ESPN's **public** (no-auth) scoreboard API. Built once so several fantasy-bot
features (game reminders, pre-game hype, weekly summary) can share one NFL
kickoff-time source.

This is a separate data source from `espn-fantasy-client`: that package uses the
**authed** v3 fantasy API (cookies); this one hits the **public** scoreboard
endpoint and sends no credentials.

## Public API

```ts
import {
  NflScheduleClient,
  firstKickoffPerGameDay,
} from "nfl-schedule-client";

const client = new NflScheduleClient();

// Fetch a week's games (all args optional; omit week/year for "current").
const games = await client.getWeek({ week: 1, year: 2025, seasonType: 2 });
//    NflGame[]  — sorted by kickoff ascending
//    each: { id, kickoff (ISO UTC), kickoffDate (Date), homeTeam, awayTeam,
//            shortName, name, week, season, raw }

// Pure helper for game reminders: first kickoff of each game day, grouped by
// calendar day in an IANA timezone (default "America/New_York").
const days = firstKickoffPerGameDay(games);
//    GameDayKickoff[] — [{ gameDay: "YYYY-MM-DD", firstKickoff (ISO UTC),
//                          firstKickoffDate (Date), gameCount }]
//    sorted by kickoff. Pass a second arg (e.g. "UTC") to change the zone.
```

Signatures:

- `NflScheduleClient(options?)` — `options`: `{ timeoutMs?, retry?, userAgent?, baseUrl?, fetchImpl? }`
- `client.getWeek(query?, opts?) => Promise<NflGame[]>` — `query`: `{ week?, year?, seasonType? }` (`seasonType` default `2` = regular season)
- `client.raw(params?, opts?) => Promise<unknown>` — escape hatch, parsed JSON as-is
- `firstKickoffPerGameDay(games, timeZone = "America/New_York") => GameDayKickoff[]` — pure
- `firstKickoffOfWeek(games) => NflGame | null` — pure
- `calendarDayInTz(instant, timeZone) => "YYYY-MM-DD"` — pure
- `mapScoreboard(rawJson) / mapGame(rawEvent)` — pure parsers for consumers holding their own JSON

Every `NflGame` keeps a `raw` escape hatch (ESPN's original event node) for
un-modeled fields (venue, broadcast, odds, live status, ...).

## NETWORK CAVEAT — live verification must happen on the OpenClaw host

The dev sandbox this package was built in is **edge-blocked** from ESPN:
`https://site.api.espn.com/...` returns **HTTP 403 "Access Denied"** with an
Akamai `errors.edgesuite.net` reference. This is an IP/edge block, **not** an
auth problem (the endpoint takes no credentials). A test `curl` with a browser
User-Agent confirmed the 403.

So this package was built against ESPN's **documented** scoreboard shape and a
**committed fixture** (`test/fixtures/scoreboard.json`), not live data. The
OpenClaw host reaches ESPN fine, so **live verification (a real `getWeek` call)
must be run there** to confirm the JSON shape below still holds.

## Assumptions about ESPN's JSON to verify against live data

The parser (`src/parsers.ts`) assumes, per event in the top-level `events[]`:

- `id` — event id (coerced to string)
- `date` — ISO-8601 UTC kickoff time (the field we treat as kickoff)
- `shortName` (e.g. `"DAL @ PHI"`), `name` (full)
- `week.number`, `season.year`
- `competitions[0].competitors[]`, each with `homeAway: "home" | "away"` and
  `team.abbreviation`

Anything missing degrades gracefully (`null`), and events lacking an `id` or a
parseable `date` are dropped rather than throwing.
