# Technical Spec: `espn-fantasy-client` + `espn-mcp-server`

**Status:** Draft for review
**Scope:** the shared library and its MCP wrapper. The `team-manager` app is out of
scope (spec'd separately when built).
**Companion docs:** `espn-fantasy-client-prd.md` (requirements/why),
`decisions.md` (Q1–Q3 rationale), `ffl-draft-tool-inventory.md` (source integration).
**Date:** 2026-09-05

Read-only, v1. No write operations, no cookie refresh (see PRD §3).

---

## 1. Design principles

1. **Thin typing with raw passthrough.** ESPN's v3 API is undocumented and unstable, so
   we type only the fields we actively extract into clean shapes. Every returned object
   carries a `raw` property holding the original ESPN node, so a consumer can reach an
   un-modeled field without a library change. This preserves the "one place to patch"
   promise.
2. **Raw-but-typed data, no consumer opinions.** No `$1` floor, no budget scaling, no
   `"espn-"` id prefixing (all of that was draft-tool-specific — it stays in consumers).
   The library returns ESPN's own ids and values.
3. **Creds are always caller-supplied.** No `.env` reading, no config files. The library
   is pure transport + shaping.
4. **Collaborators are injectable.** Cache and rate limiter are interfaces with default
   implementations; a consumer can replace either.
5. **Stateless per call.** The only in-memory state is the optional cache and the rate
   limiter's queue.

---

## 2. Package: `espn-fantasy-client`

### 2.1 Construction

```ts
export interface EspnCreds {
  leagueId: string;
  season: number;
  espnS2: string;
  /** Accepted with or without braces; normalized to `{...}` internally. */
  swid: string;
}

export interface RetryOptions {
  maxRetries: number;        // default 3
  baseDelayMs: number;       // default 300  (exponential: base * 2^attempt + jitter)
  maxDelayMs: number;        // default 5_000
  /** Decide whether a failed attempt is retriable. Default: network/timeout, 5xx, 429. */
  retryOn: (info: { status?: number; error?: Error }) => boolean;
}

export interface RateLimitOptions {
  maxConcurrent: number;     // default 2
  minIntervalMs: number;     // default 250  (min gap between request starts)
}

export interface EspnClientOptions {
  creds: EspnCreds;
  /** Per-request timeout. Default 15_000ms. */
  timeoutMs?: number;
  /** false disables retries. Partial merges over defaults. */
  retry?: Partial<RetryOptions> | false;
  /** Pass options to use the built-in limiter, a RateLimiter to inject your own,
   *  or false to disable limiting. Default: built-in with RateLimitOptions defaults. */
  rateLimit?: RateLimitOptions | RateLimiter | false;
  /** Pass {ttlMs} to use the built-in in-memory cache, a CacheStore to inject your own,
   *  or false to disable caching (default). Caching is OPT-IN. */
  cache?: CacheStore | { ttlMs?: number } | false;
  /** Override the spoofed desktop-Chrome UA if needed. */
  userAgent?: string;
  /** Injectable for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

export class EspnFantasyClient {
  constructor(options: EspnClientOptions);
  // ...methods in §2.4
}
```

**Two documented profiles** (consumers construct with these; they are not baked in):

```ts
// Discord bot on OpenClaw — long-running, polite to ESPN, cache on
new EspnFantasyClient({
  creds,
  retry: { maxRetries: 4, baseDelayMs: 500 },
  rateLimit: { maxConcurrent: 1, minIntervalMs: 750 },
  cache: { ttlMs: 120_000 },
});

// Team-manager — interactive, fast-fail, fresh data
new EspnFantasyClient({
  creds,
  retry: { maxRetries: 1, baseDelayMs: 200 },
  timeoutMs: 8_000,
  cache: false,
});
```

### 2.2 Injectable collaborators

```ts
export interface CacheEntry { value: unknown; expiresAt: number; }

export interface CacheStore {
  get(key: string): CacheEntry | undefined | Promise<CacheEntry | undefined>;
  set(key: string, value: unknown, ttlMs: number): void | Promise<void>;
  delete?(key: string): void | Promise<void>;
  clear?(): void | Promise<void>;
}

export interface RateLimiter {
  /** Run fn subject to the limiter's concurrency/interval policy. */
  schedule<T>(fn: () => Promise<T>): Promise<T>;
}
```

Built-ins shipped: `InMemoryCacheStore` (Map + TTL, lazy eviction) and
`DefaultRateLimiter` (concurrency + min-interval queue). Cache key =
`METHOD + normalized URL + X-Fantasy-Filter JSON`. Per-call `forceRefresh` bypasses a
hit and overwrites it.

### 2.3 Error taxonomy

```ts
export class EspnApiError extends Error {
  readonly status?: number;     // HTTP status when there was a response
  readonly url?: string;
  readonly body?: string;       // truncated response body for diagnostics
  readonly retriable: boolean;
}
export class EspnAuthError extends EspnApiError {}    // 401 — expired/wrong-league cookies
export class EspnParseError extends EspnApiError {}   // 2xx but body not JSON (auth redirect, HTML)
export class EspnNetworkError extends EspnApiError {} // fetch threw, or timeout/abort
```

The 401 message preserves the draft tool's wording:
`"ESPN returned 401 — espn_s2 / SWID are missing, expired, or not for this league."`
Non-2xx other than 401 → `EspnApiError` (no Express-502 remapping; that was consumer-specific).

### 2.4 Methods

All reads accept a trailing `opts?: ReadOptions`:

```ts
export interface ReadOptions {
  signal?: AbortSignal;
  /** Override the client's cache TTL for this call. */
  cacheTtlMs?: number;
  /** Skip a cache hit and refresh. */
  forceRefresh?: boolean;
}
```

**Carried over from the draft tool** (renamed to `get*`, shapes cleaned):

```ts
checkConnection(opts?): Promise<LeagueIdentity>;   // mSettings; cheap auth+connectivity probe
getSettings(opts?): Promise<LeagueSettings>;       // mSettings
getTeams(opts?): Promise<Team[]>;                  // mTeam
getDraft(opts?): Promise<DraftSnapshot>;           // mDraftDetail
getPlayers(query?: PlayerQuery, opts?): Promise<Player[]>;      // kona_player_info, paginated
getPlayersByIds(ids: number[], opts?): Promise<Player[]>;      // kona_player_info + filterIds
```

**New season-long methods:**

```ts
getRosters(o?: { scoringPeriodId?: number }, opts?): Promise<TeamRoster[]>;      // mRoster
getMatchups(o?: { matchupPeriodId?: number }, opts?): Promise<Matchup[]>;        // mMatchup
getScoreboard(o?: { scoringPeriodId?: number }, opts?): Promise<Matchup[]>;      // mScoreboard
getStandings(opts?): Promise<TeamStanding[]>;                                    // mTeam (record block)
getTransactions(o?: TransactionQuery, opts?): Promise<Transaction[]>;            // mTransactions2
getPendingTransactions(opts?): Promise<Transaction[]>;                           // mPendingTransactions
getPlayerStats(o: PlayerStatsQuery, opts?): Promise<PlayerStats[]>;             // kona_player_info + stat filter
```

**Low-level escape hatch** (for anything un-modeled):

```ts
/** Raw league fetch: pick views + optional X-Fantasy-Filter; returns parsed JSON as-is. */
raw(views: string[], filter?: unknown, opts?): Promise<unknown>;
```

### 2.5 Query shapes

```ts
export interface PlayerQuery {
  limit?: number;            // total wanted across pages; default 500. Internally paged.
  pageSize?: number;         // ESPN window per request; default 50, max 1000
  offset?: number;           // starting offset; default 0
  positions?: Position[];    // convenience → slotIds filter
  filterIds?: number[];
  sort?: 'draftRank' | 'percentOwned' | 'auctionValue'; // default 'draftRank'
  sortAsc?: boolean;
}

export interface TransactionQuery {
  types?: TransactionType[];  // e.g. WAIVER, FREEAGENT, TRADE_ACCEPTED
  teamId?: number;
  scoringPeriodId?: number;
}

export interface PlayerStatsQuery {
  playerIds?: number[];
  scoringPeriodId?: number;   // a week; omit for season totals
  /** actual + projected are both returned when present. */
}
```

**Pagination (`getPlayers`):** loops internally, issuing `X-Fantasy-Filter` requests of
`pageSize` until `limit` is reached or ESPN returns a short page. The caller sees one flat
`Player[]` and never deals with ESPN's windowing. `pageSize` is exposed only for tuning.

### 2.6 Return types (thin, with `raw`)

```ts
export type Position = 'QB' | 'RB' | 'WR' | 'TE' | 'K' | 'DST';

export interface LeagueIdentity { leagueId: string; season: number; name: string; }

export interface LeagueSettings {
  name: string;
  size: number;                 // number of teams
  scoringType?: string;         // e.g. 'PPR', 'STANDARD' when derivable
  draft: {
    type: string;               // 'AUCTION' | 'SNAKE' | ...
    auctionBudget: number;
    pickOrder: number[];        // espn team ids
  };
  roster?: { lineupSlotCounts?: Record<number, number> }; // raw-ish slot map when present
  raw: unknown;
}

export interface Team {
  id: number;                   // espn team id
  name: string;                 // resolved (name || location+nickname || abbrev || `Team N`)
  abbrev: string;
  logo?: string;
  owners?: string[];            // member ids, when present
  raw: unknown;
}

export interface Player {
  id: number;                   // espn player id (NOT prefixed)
  name: string;
  position: Position | null;    // null when defaultPositionId isn't one we map
  proTeam: string;              // NFL abbr, or 'FA'
  /** ESPN average auction value, calibrated to ESPN's $200 default. NOT scaled. */
  auctionValueAverage: number | null;
  percentOwned?: number | null;
  raw: unknown;
}

export interface DraftPick {
  overallPickNumber: number;
  playerId: number;
  teamId: number;
  bidAmount: number;
  nominatingTeamId?: number;
  autoDrafted: boolean;
  keeper: boolean;
  raw: unknown;
}
export interface DraftSnapshot {
  drafted: boolean;
  inProgress: boolean;
  picks: DraftPick[];           // sorted by overallPickNumber; keeper/invalid picks excluded by default
  raw: unknown;
}

export interface RosterEntry {
  playerId: number;
  name: string;
  position: Position | null;
  lineupSlotId: number;         // ESPN lineup slot; not remapped
  proTeam: string;
  raw: unknown;
}
export interface TeamRoster { teamId: number; entries: RosterEntry[]; raw: unknown; }

export interface MatchupSide {
  teamId: number;
  points: number;
  projectedPoints?: number;
}
export interface Matchup {
  matchupPeriodId: number;
  home: MatchupSide;
  away: MatchupSide | null;     // null for a bye
  winner?: 'HOME' | 'AWAY' | 'TIE' | 'UNDECIDED';
  raw: unknown;
}

export interface TeamStanding {
  teamId: number;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
  rank?: number;
  raw: unknown;
}

export type TransactionType = string;   // pass through ESPN's own type strings
export interface Transaction {
  id: string;
  type: TransactionType;
  teamId?: number;
  status?: string;
  scoringPeriodId?: number;
  items: Array<{ playerId: number; fromTeamId?: number; toTeamId?: number; type: string }>;
  raw: unknown;
}

export interface StatSplit { scoringPeriodId: number | null; applied: number | null; projected?: number | null; }
export interface PlayerStats { playerId: number; name: string; splits: StatSplit[]; raw: unknown; }
```

### 2.7 Constants exported (documented, not applied)

```ts
export const ESPN_READ_HOST = 'https://lm-api-reads.fantasy.espn.com';
export const ESPN_DEFAULT_AUCTION_BUDGET = 200; // consumers scale; the lib does not
export const POSITION_BY_ID: Record<number, Position>;  // 1=QB,2=RB,3=WR,4=TE,5=K,16=DST
export const PRO_TEAM_ABBR: Record<number, string>;     // NFL team-id → abbr
```

### 2.8 Transport internals (single choke point)

One private `espnFetch(views, filter, opts)` handles: URL build, cookie header
(SWID brace-normalized), UA, `Accept: application/json`, optional
`X-Fantasy-Filter` JSON header, timeout via `AbortController`, then the wrapper order:
**cache → rate limiter → retry/backoff → fetch → parse/classify errors**. Every public
method routes through it. This is the only place to patch when ESPN changes.

---

## 3. Package: `espn-mcp-server`

A thin MCP server (stdio; HTTP mode TBD pending OpenClaw's config model) that imports
`espn-fantasy-client` and exposes each read method as a tool. It holds **no ESPN logic** —
it constructs one `EspnFantasyClient` from env creds and forwards calls.

### 3.1 Credentials

Read once at startup from env: `ESPN_LEAGUE_ID`, `ESPN_SEASON`, `ESPN_S2`, `ESPN_SWID`.
Missing creds → the server starts but every tool returns a clear "not configured" error.
(Cred loading lives here, not in the library — §1.3.)

### 3.2 Tools (1:1 with library methods)

| Tool name | Input | Returns |
|---|---|---|
| `espn_check_connection` | — | league identity |
| `espn_get_settings` | — | league settings |
| `espn_get_teams` | — | teams |
| `espn_get_draft` | — | draft snapshot |
| `espn_get_players` | `{ limit?, positions?, sort?, sortAsc? }` | players |
| `espn_get_players_by_ids` | `{ ids: number[] }` | players |
| `espn_get_rosters` | `{ scoringPeriodId? }` | rosters |
| `espn_get_matchups` | `{ matchupPeriodId? }` | matchups |
| `espn_get_scoreboard` | `{ scoringPeriodId? }` | matchups |
| `espn_get_standings` | — | standings |
| `espn_get_transactions` | `{ types?, teamId?, scoringPeriodId? }` | transactions |
| `espn_get_player_stats` | `{ playerIds?, scoringPeriodId? }` | player stats |

- Output: JSON (the typed shapes above). The bulky `raw` field is **omitted by default**
  in MCP output to keep tool responses small; a `{ includeRaw: true }` input flag re-adds it.
- Resilience profile: the bot profile from §2.1, cache on (~120s), so OpenClaw polling
  doesn't hammer ESPN.
- Errors surface as MCP tool errors carrying the `EspnApiError` message/status.

### 3.3 Tools explicitly NOT exposed

`raw()` (the escape hatch) — kept library-only to avoid handing an agent an unbounded
ESPN fetch. Revisit if a real need appears.

### 3.4 Wiring into OpenClaw (verified against docs.openclaw.ai, 2026-09-05)

OpenClaw natively connects to MCP servers (`mcp.servers` in `~/.openclaw/openclaw.json`,
JSON5). Transports: Streamable HTTP, SSE, or **Stdio** — our server is stdio, which is the
simplest and needs no HTTP surface. The stdout stream must stay protocol-only (status/logs
to stderr — already the case). Host runs **Node 26** (min 22.22.3+).

**Get the code onto the OpenClaw host** (git clone or NAS copy), then build the whole
workspace so the stdio entry and its `espn-fantasy-client` workspace dep both resolve:
```
corepack pnpm install      # at repo root — creates the workspace symlinks
corepack pnpm -r build     # builds espn-fantasy-client AND espn-mcp-server
```

**Register the server** (CLI form):
```
openclaw mcp add espn \
  --command node \
  --arg dist/index.js \
  --cwd <repo>/packages/espn-mcp-server
openclaw mcp doctor espn --probe    # proves reachability + lists the 12 tools
```
Or directly in config:
```json5
{ mcp: { servers: { espn: {
  command: "node",
  args: ["<repo>/packages/espn-mcp-server/dist/index.js"],
  transport: "stdio",
  enabled: true,
} } } }
```

**Credentials:** the server reads `ESPN_LEAGUE_ID` / `ESPN_SEASON` / `ESPN_S2` / `ESPN_SWID`
from env. OpenClaw's docs are explicit: **keep credentials out of config literals — use the
supported secret mechanism** for the env values, never hardcode the cookies in
`openclaw.json` (and never in git).

**Update flow when ESPN breaks something:** patch the library here → push → on the host
`git pull && corepack pnpm -r build` → OpenClaw hot-reload picks up the change (or
`openclaw mcp reload`). Single source of truth, patched once.

---

## 4. Workspace & tooling

```
ESPN-API-Access/
  package.json                 # { "private": true, workspaces via pnpm }
  pnpm-workspace.yaml          # packages: ["packages/*"]
  tsconfig.base.json
  packages/
    espn-fantasy-client/
      package.json             # name, type:module, exports, no runtime deps
      tsconfig.json
      src/{index.ts, client.ts, transport.ts, cache.ts, rateLimiter.ts,
           errors.ts, types.ts, maps.ts, views/*.ts}
      test/*
    espn-mcp-server/
      package.json             # deps: espn-fantasy-client (workspace:*), MCP SDK
      src/{index.ts, tools.ts}
    team-manager/              # separate spec; deps espn-fantasy-client (workspace:*)
```

- **Module system:** ESM (`"type": "module"`), matching the draft tool and OpenClaw.
- **Build:** `tsc` per package (or `tsup` for the library to emit d.ts + ESM cleanly).
- **Runtime deps:** library = **zero** (raw `fetch`, Node 18+). MCP server = the MCP SDK only.
- **Node:** 18+ (global `fetch`, `AbortController`).
- **Tests:** unit-test parsers/mappers against captured ESPN JSON fixtures (no live calls);
  a small opt-in live smoke test gated on env creds.
- **Publishing:** deferred (decisions.md Q3). Consumed via `workspace:*`; OpenClaw runs the
  MCP server as a subprocess.

---

## 5. Open items

### Resolved by live validation (2026-09-05, league 503578)
All 11 read methods were exercised against the live league. Three bugs were found and fixed
(regression tests in `test/client.test.ts`):

- **`getPlayerStats` — was HTTP 400.** Root cause: (a) `scoringPeriodId` was sent as a URL
  query param on `kona_player_info`, which ESPN rejects; (b) a filter `limit` must be
  accompanied by a sort ("Limit request must be accompanied by a sort"). Fix: sort via
  `buildPlayersFilter`, no URL param, and scope splits to the requested `scoringPeriodId`
  **client-side** (stats are embedded per player as `stats[]`, `statSourceId` 0 = actual /
  1 = projected, keyed by `scoringPeriodId`).
- **`getPlayersByIds` — was also HTTP 400** for the same "limit needs a sort" reason (it
  wasn't exercised in the first capture). Fixed via `buildPlayersFilter`.
- **`getScoreboard` — period was always 0.** `mScoreboard` entries carry **no**
  `matchupPeriodId`; the period lives in top-level `status.currentMatchupPeriod`. Fix:
  request `mMatchup` + `mScoreboard` together (the combined payload gives each entry its
  `matchupPeriodId` plus the live `totalPointsLive` / `totalProjectedPointsLive` fields),
  default to the current matchup period, and match on `matchupPeriodId`.

Also confirmed: **`scoringPeriodId` vs `matchupPeriodId`** — `mMatchup` entries are keyed by
`matchupPeriodId`; the scoreboard is the current matchup period. In the regular season they
coincide (week N); a playoff matchup period can span multiple scoring periods.
**Transaction shape** — `items[]` mapping verified against live waiver ADD/DROP payloads.

### Still open
1. **OpenClaw MCP transport — RESOLVED.** OpenClaw natively connects MCP servers via
   `mcp.servers` config; our stdio transport is directly supported. Full wiring recipe in
   §3.4. No code change needed to `espn-mcp-server/src/index.ts`.
2. **In-season data** — standings/matchup results were all-zero at validation time
   (preseason, 2026-09-05). Re-verify record/rank/points parsing once Week 1 completes.
3. **Trade transactions** — waiver adds/drops confirmed live; a `TRADE_ACCEPTED` payload
   still to be checked against a real sample.
4. **`getPlayerStats` period coverage** — the embedded `stats[]` returns a default set of
   splits; a requested `scoringPeriodId` outside that set yields empty splits. Add an
   explicit `filterStatsForTopScoringPeriodIds` filter if a specific historical week must
   be guaranteed.
```
