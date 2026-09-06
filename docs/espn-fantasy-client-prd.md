# PRD: Shared ESPN Fantasy Football API Client Library

**Status:** Draft
**Source:** Extracted/extended from `server/espn.ts` in the existing FFL Draft Tool
**Consumers:** (1) Season-long Discord bot on **OpenClaw**, reached via a small MCP server that wraps the library; (2) Personal team-manager app, built in **Claude Code**, importing the library directly
**Author:** Matthew

---

## 1. Purpose

The draft tool already contains a clean, isolated ESPN Fantasy API adapter
(`server/espn.ts`) that talks to ESPN's undocumented v3 API. Two new consumers
(a Discord bot and a personal team-manager tool) need the same kind of access,
plus season-long data the draft tool never needed (rosters, matchups,
standings, transactions, projections).

Rather than duplicate or copy-paste the adapter into each new project, this
PRD scopes a standalone library — `espn-fantasy-client` — that both projects
import. It extracts what already works, strips out draft-tool-specific
opinions, and adds the resilience and data coverage a long-running bot and an
on-demand analysis tool will both need.

## 2. Goals

- Extract the existing, working ESPN adapter into a standalone, dependency-light package.
- Return **raw-but-typed** ESPN data — no app-specific formatting or scaling baked in.
- Extend coverage to the `view=` params the draft tool never used: rosters, matchups/scoreboard, standings, transactions/waivers, and player stats/projections.
- Add cross-cutting concerns neither existing project has needed yet but a long-running bot will: retry/backoff, rate-limiting, optional response caching, and full pagination for large result sets (player pool).
- Keep auth flexible — creds passed in by the caller, not tied to any one app's `.env` loading.

## 3. Non-Goals

- **Not** building any UI, Discord-specific logic, or CLI logic — this library is transport + data only.
- **Not** carrying over the draft tool's `reconcile.ts`, auction-budget scaling, or `Player` projection shape — those are consumer-specific and stay behind in the draft tool.
- **Not** solving ESPN write operations (submitting waiver claims, setting lineups) in v1 — scope as read-only first; writes are a later, separate PRD once the team-manager actually needs them, given the higher-stakes nature of automated writes.
- **Not** implementing a token refresh/re-auth flow — `espn_s2`/`SWID` remain manually-pasted, long-lived cookies as today; the library should just surface auth failures clearly.

## 4. Background: what already exists (from the draft tool inventory)

- Written in TypeScript, single-file adapter (~275 lines), zero third-party deps — raw `fetch` against `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/{season}/segments/0/leagues/{leagueId}`.
- Auth via `espn_s2` + `SWID` cookies, spoofed desktop-Chrome `User-Agent`, and an `X-Fantasy-Filter` header for pagination/sorting/id-filtering.
- Already implements: `checkConnection`, `pullDraftSettings`, `pullTeams`, `pullPlayerPool` (single-window, non-paginated), `pullPlayersByIds`, `pullDraft`.
- Already handles real ESPN quirks worth preserving: the `$200`-calibrated auction value baseline (leave the *scaling* out of the lib, but the *knowledge* that raw values assume a $200 budget should be documented), the requirement to use `kona_player_info` for auction/rank data, hardcoded position-id and NFL-team-id maps, defensive optional-chaining against an unstable unofficial schema, and explicit 401-vs-other-error handling.
- Confirmed cleanly liftable: no Express/React/store coupling; only couples to `EspnCreds` (env-loading) and `Player`/`Position` (app types), both trivial to sever.

## 5. Functional Requirements

### 5.1 Client shape
A single entry point, e.g.:

```ts
const client = new EspnFantasyClient({ leagueId, season, espnS2, swid });
```

Creds are always caller-supplied — the library has no knowledge of `.env` files, config files, or any particular app's secret storage.

### 5.2 Methods to carry over (return raw ESPN-shaped data, not app-shaped)
- `checkConnection()`
- `getSettings()` — draft/league settings
- `getTeams()`
- `getDraft()` — draft board / picks
- `getPlayers({ limit, offset, sort, filterIds })` — with **pagination looped internally** so callers can request "all players" without knowing about ESPN's window limits

### 5.3 New methods to add (season-long data the draft tool never used)
- `getRosters()` — current roster/lineup-slot assignments (`mRoster`)
- `getMatchups({ week })` / `getScoreboard({ week })` — head-to-head and weekly scores (`mMatchup`, `mScoreboard`, `mMatchupScore`)
- `getStandings()` — W/L, points for/against
- `getTransactions()` / `getPendingTransactions()` — waiver/free-agency activity (`mTransactions2`, `mPendingTransactions`)
- `getPlayerStats({ playerIds, scoringPeriod })` — actual + projected weekly points from the stats blocks already present in `kona_player_info` (currently only auction value/position are read from this payload — the projections are sitting there unused)

### 5.4 Resilience layer (net-new — the draft tool didn't need this for a one-evening, human-watched draft; a bot polling continuously will)
- **Retry/backoff** on transient failures (5xx, network errors) — small bounded retry with exponential backoff.
- **Rate limiting** — cap outbound request rate regardless of how eagerly a consumer polls.
- **Optional response caching** — short-TTL cache (e.g., standings/rosters don't change every 15 seconds) so the Discord bot's polling loop doesn't hammer ESPN for unchanged data. Should be opt-in/configurable per method, not global.
- **Clear, typed error surface** — preserve the existing 401 → "expired/wrong-league cookies" distinction; non-2xx → a typed `EspnApiError` rather than the draft tool's HTTP-502-passthrough (that was Express-specific).

### 5.5 Constants to preserve
- Read host: `https://lm-api-reads.fantasy.espn.com`
- Base path: `/apis/v3/games/ffl/seasons/{season}/segments/0/leagues/{leagueId}`
- Position id map: `1=QB, 2=RB, 3=WR, 4=TE, 5=K, 16=DST`
- ESPN default auction budget baseline: `200` (documented, not applied — scaling is a consumer concern)

### 5.6 Delivery surfaces (how consumers reach the library)
- **`espn-mcp-server`** — a thin MCP server that imports the library and exposes each method as an MCP tool (`getRosters`, `getMatchups`, `getStandings`, `getTransactions`, `getPlayers`, etc.). This is how the **OpenClaw Discord bot** consumes ESPN data (OpenClaw launches/connects to it as an MCP subprocess). Interactive Claude Code sessions can point at it too.
- **Direct import** — the **team-manager app** (built in Claude Code) imports `espn-fantasy-client` directly via `workspace:*` for its own logic; no MCP indirection needed for an in-workspace app.

## 6. Non-Functional Requirements
- **Zero required runtime dependencies** beyond what's already true today (no axios, no ESPN wrapper lib) — keep it as portable as the current adapter.
- **One repo, three packages** — a local **pnpm workspace** holding `espn-fantasy-client` (library), `espn-mcp-server` (thin MCP wrapper for OpenClaw), and `team-manager` (the personal app). Internal consumers depend on the library via `workspace:*`. Because both consumers live in this workspace and OpenClaw talks to the *MCP server* (a subprocess) rather than importing the library, **publishing the library to npm/git is deferred** — add it only if the library is ever reused outside this repo.
- Must run in a plain Node environment (no Express or React assumptions), since the CLI tool has no server.

## 7. Migration Plan
1. Create the new package (`espn-fantasy-client/`) with its own `package.json`, TS config, and no app dependencies.
2. Move `server/espn.ts` into it near-verbatim, then:
   - Strip out `toPlayer`'s app-shaped `Player` mapping and `$1`-floor/budget-scaling — return raw values instead.
   - Move `EspnCreds` type into the library; keep every method taking `creds` as an explicit argument (already true today).
   - Move the `Position`/id-map types into the library (it owns the source data anyway).
3. Add pagination looping to `getPlayers` (today's single-window fetch becomes an internal loop).
4. Add the new `getRosters/getMatchups/getScoreboard/getStandings/getTransactions/getPlayerStats` methods using the same `espnFetch()` pattern and `X-Fantasy-Filter` mechanics already established.
5. Add the retry/backoff/rate-limit/caching layer around the shared `espnFetch()` helper.
6. Point the draft tool's `server/index.ts` at the new library (replacing its local `espn.ts`) to confirm no regression, keeping `reconcile.ts` and the `Player`-shaping/budget-scaling logic in the draft tool itself, now operating on the library's raw output.
7. Wire the Discord bot and CLI team-manager projects to import the same package.

## 8. Resolved Decisions (2026-09-05)
Full reasoning in `decisions.md`.
- **Q1 — Caching:** in-memory only in the library, behind a pluggable `CacheStore` interface. Durable storage is a **consumer** concern, not the library's (a cache is disposable; a store like SQLite is durable, consumer-owned data ESPN won't remember for you).
- **Q2 — Resilience config:** constructor-time with sane defaults; the **cache and rate limiter are injectable collaborators** so instances can share a limiter later.
- **Q3 — Distribution:** single local **pnpm workspace**; library consumed internally via `workspace:*`; **OpenClaw consumes the `espn-mcp-server` subprocess**, not the library; publishing the library is **deferred**.
- **Consumer split:** the Discord bot (on OpenClaw) reaches ESPN through the MCP server; the team-manager is a **separate app** built in Claude Code that imports the library directly. Both were confirmed as genuinely distinct consumers.

## 9. Out of Scope (deferred to later PRDs)
- Any ESPN **write** operations (waiver claims, lineup submissions) — needed eventually by the team-manager, but scoped separately given the higher stakes of an automated write path.
- Discord-specific logic (bot commands, message formatting, scheduling).
- Team-manager analysis logic (waiver recommendations, lineup optimization, matchup planning).
