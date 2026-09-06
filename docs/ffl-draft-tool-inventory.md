# ESPN Fantasy API Integration — Inventory

**Source project:** `FFL Draft Tool` (the "Cool People League Vampire Edition" draft assistant)
**Purpose of this doc:** inventory the existing, working ESPN integration so it can be scoped into a shared library reused by two new projects — a **Discord bot** and a **personal team-manager CLI**.
**Date:** 2026-09-05

---

## 1. Language / Framework

- **Language:** TypeScript throughout (ESM, `"type": "module"`).
- **Backend:** Node + **Express 4** (`server/`), run via `tsx`. All ESPN calls happen here.
- **Frontend:** **React 18 + Vite** (`src/`). The browser never talks to ESPN directly.
- **Shared:** `shared/` holds the domain model and pure logic imported by both sides.

**Structure (relevant parts):**

| Path | Role |
|---|---|
| `server/espn.ts` | **The entire ESPN adapter** — endpoints, auth, parsing, id maps |
| `server/env.ts` | `.env` loader + `getEspnCreds()` |
| `server/index.ts` | Express routes that expose ESPN data to the UI |
| `server/reconcile.ts` | Pure merge of ESPN picks into app state (no network) |
| `server/store.ts` | JSON file persistence of draft state |
| `shared/types.ts` | Domain types (`Player`, `Team`, `Pick`, etc.) |
| `src/lib/api.ts` | Client fetch wrappers hitting `/api/espn/*` |
| `src/components/EspnPanel.tsx` | UI + the polling loop |

---

## 2. ESPN API access code

- **Location:** essentially **one file — `server/espn.ts`** (~275 lines). Deliberate design goal (PRD §6:
  "isolate the ESPN-specific fetching/parsing behind a clean interface"). The file header states it is
  meant to be the only file to patch when ESPN changes their internal API.
- **Single module, not scattered.** ESPN-adjacent code outside it:
  - `env.ts` supplies the `EspnCreds` type + credential loading.
  - `reconcile.ts` consumes `EspnDraftSnapshot` but does no network I/O.
  - `index.ts` wires the functions to HTTP routes.
- **No third-party wrapper library.** Raw `fetch` against ESPN's undocumented v3 endpoints. Zero runtime
  deps beyond Express — no `espn-fantasy-football-api`, no axios. All requests go through one internal
  helper, `espnFetch()`, which sets cookies + a spoofed desktop-Chrome `User-Agent` and optionally an
  `X-Fantasy-Filter` header.

---

## 3. Authentication

- **Cookies:** `espn_s2` and `SWID`, plus `ESPN_LEAGUE_ID` and `ESPN_SEASON`, are stored in a **`.env`
  file** (server-side only) and read by a hand-rolled minimal `.env` parser in `env.ts` (no `dotenv`
  dependency). `getEspnCreds()` returns `null` unless leagueId + s2 + swid are all present.
- **Secrets never reach the browser** — the client only sees a boolean `hasCookies`/`configured` flag
  (`/api/espn/status`). The React app calls the local Express server, which holds the cookies.
- **SWID brace handling:** `cookieHeader()` auto-wraps SWID in `{...}` if missing.
- **No refresh / expiry logic.** These are treated as **long-lived, manually-pasted cookies** (copied
  from a logged-in browser's dev tools). Expiry is handled reactively: a `401` throws a specific
  `EspnError` telling the user the cookies are missing/expired/wrong-league. No proactive renewal, no
  token store, no re-auth flow.

---

## 4. Data currently fetched

All via the league base URL:
`https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/{season}/segments/0/leagues/{leagueId}`,
varying the `view` query param (note the read-only `lm-api-reads` host).

| Function | View / filter | Returns |
|---|---|---|
| `checkConnection` | `mSettings` | League name — used as an auth/connectivity probe |
| `pullDraftSettings` | `mSettings` | `auctionBudget`, draft `type`, `pickOrder` (team-id nomination order) |
| `pullTeams` | `mTeam` | Team id, name (with location/nickname/abbrev fallbacks), abbrev |
| `pullPlayerPool` → `queryPlayers` | `kona_player_info` + `X-Fantasy-Filter` (limit/offset, `sortDraftRanks`, `sortPercOwned`) | Draftable **player universe** with **average auction values** (`ownership.auctionValueAverage`, falling back to `draftRanksByRankType.PPR/STANDARD.auctionValue`), position, NFL team |
| `pullPlayersByIds` | `kona_player_info` + `filterIds` | Named info for specific player ids (to resolve picks not in the loaded pool) |
| `pullDraft` | `mDraftDetail` | **Draft board / picks**: overall pick #, playerId, teamId, `bidAmount`, `nominatingTeamId`, auto-draft flag; plus `drafted`/`inProgress` status. Filters out keeper-reserved slots. |

**Data ESPN exposes but this code does NOT use** (all reachable with additional `view=` params on the
same endpoint — relevant for the two new projects):

- **Rosters / lineups** (`mRoster`) — current player-to-team assignments with lineup slots.
- **Matchups & scoreboard** (`mMatchup`, `mScoreboard`, `mMatchupScore`) — head-to-head, weekly scores.
- **Standings / records** — team W/L, points for/against (partly in `mTeam` but unused here).
- **Transactions / waivers / free agency** (`mTransactions2`, `mPendingTransactions`).
- **Player stats & projections** — actual and projected weekly points (available in `kona_player_info`
  stats blocks; only auction value + position are read today).
- **Boxscores** (`mBoxscore`), **news**, **draft-recap detail** beyond picks.
- Member/owner identity data in `mTeam` (owners, `primaryOwner`).

---

## 5. Quirks & workarounds handled

- **Auction value budget scaling:** ESPN's crowd-sourced `auctionValueAverage` is calibrated to a
  **$200 default budget**. The code scales values by `leagueBudget / 200`
  (`ESPN_DEFAULT_AUCTION_BUDGET`), with a `$1` floor and whole-dollar rounding, and allows a manual
  `overrideScale`.
- **The `kona_player_info` view is required** for auction values — a code comment notes the bare season
  `players` endpoint doesn't carry `ownership.auctionValueAverage` or `draftRanksByRankType`.
- **`X-Fantasy-Filter` header** carries pagination/sorting/id-filtering as JSON (ESPN's undocumented
  filter mechanism), rather than query params.
- **Spoofed `User-Agent`** (desktop Chrome) is sent on every request — ESPN can behave differently for
  non-browser agents.
- **Id maps hardcoded:** `POSITION_BY_ID` (1=QB…16=DST) and a full `PRO_TEAM_ABBR` NFL-team-id →
  abbreviation table live in the file. These drift when the NFL/ESPN changes (e.g. relocations) and are
  a maintenance point.
- **Keeper picks filtered** (`reservedForKeeper`) and picks with `playerId <= 0` dropped; picks sorted
  by overall number.
- **Response shape defensiveness:** heavy optional chaining and `?? []` fallbacks because the unofficial
  API's shape isn't guaranteed; non-JSON responses (an auth redirect) throw a "not JSON — are cookies
  valid?" error.
- **401 = expired/wrong-league cookies**, surfaced explicitly; other non-2xx mapped to HTTP 502
  upstream.
- **Polling is client-driven, not in the adapter:** `EspnSyncButton` runs a `setInterval` (default 15s,
  min 5s) hitting `/api/espn/sync`. **There is no rate-limiting, retry, backoff, or response caching
  anywhere** — each poll is a fresh set of live calls. For a Discord bot polling continuously, you'd
  want to add these.
- **No pagination loop:** `pullPlayerPool` fetches a single window (`limit` 50–1000, default 500); it
  doesn't page through the full universe.

---

## 6. Reusability assessment

**`server/espn.ts` is already close to a standalone library.** It was written to the PRD's isolation
goal and shows it.

**Cleanly liftable:**

- `espn.ts` has **no imports from the app** except two things: `EspnCreds` (from `env.ts`) and
  `Player`/`Position` (from `shared/types.ts`). Both are trivial to sever.
- It has **zero UI/state/React coupling** and no dependency on Express or the file store.
- Its public surface is already a clean set of async functions returning plain typed objects
  (`EspnTeamInfo`, `EspnRawPick`, `EspnDraftSnapshot`, `PulledPool`, `EspnDraftSettings`).

**Entanglements to unwind (all minor):**

1. **`EspnCreds` coupling to `.env`:** the type is fine, but creds are sourced via `getEspnCreds()`
   reading `process.env`. A shared lib should take creds as an argument (it already does — every
   function receives `creds`), so move the `EspnCreds` interface into the lib and let each app decide
   how to load them.
2. **The `toPlayer` mapper bakes in app opinions:** it emits the app's `Player` shape with
   `id: "espn-${id}"`, the `$1` floor, and budget scaling. A library should return **raw ESPN-shaped
   data** (id, name, position, values) and let each consumer apply its own scaling/formatting. The
   auction-value scaling is arguably domain logic living in the adapter today.
3. **`reconcile.ts` is NOT part of the library** — it's draft-tool-specific (slots, budgets, position
   pools). Leave it behind; it's a *consumer* of `EspnDraftSnapshot`, cleanly separated already.
4. **Shared `Position` type** would move into the lib (it owns the id→position map anyway).

**Recommended shape for the shared library:**

- A small `EspnFantasyClient` (class or factory taking `{leagueId, season, espnS2, swid}`) exposing
  `getSettings/getTeams/getDraft/getPlayers/checkConnection`, returning **raw-but-typed** ESPN data.
- Add the missing cross-cutting concerns the current code lacks but both new projects will want:
  **retry/backoff, rate-limiting, and optional caching**, plus **pagination** for the player pool.
- Keep budget-scaling and the `Player` projection **out** of the lib (they're consumer concerns — the
  CLI and bot may want different formatting).
- Extend `view=` coverage (rosters, matchups, standings, transactions, stats/projections) — the CLI
  team-manager and Discord bot will need in-season data the draft tool never touched.

**Effort estimate:** the core extraction is low-effort (one well-isolated file, a handful of type
moves). The real scope of the PRD is the *additions* — new endpoints/views, and the resilience layer
(retries/rate-limits/caching) that a long-running bot needs but a one-evening draft tool didn't.

---

## Appendix — key constants to carry over

- **Read host:** `https://lm-api-reads.fantasy.espn.com`
- **Base path:** `/apis/v3/games/ffl/seasons/{season}/segments/0/leagues/{leagueId}`
- **ESPN default auction budget:** `200`
- **Position ids:** `1=QB, 2=RB, 3=WR, 4=TE, 5=K, 16=DST`
- **Auth header:** `Cookie: espn_s2=...; SWID={...}` + spoofed desktop-Chrome `User-Agent`
- **Filter header:** `X-Fantasy-Filter: <JSON>` for pagination/sort/id-filtering
