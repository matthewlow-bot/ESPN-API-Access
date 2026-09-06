# Decision Log — espn-fantasy-client

Running record of decisions from scoping discussion. Feeds the PRD
(`espn-fantasy-client-prd.md`) §8 Open Questions. Status as of 2026-09-05.

## Context

- Extracting the working ESPN adapter from the **FFL Draft Tool** (`server/espn.ts`)
  into a standalone shared library, `espn-fantasy-client`.
- Full inventory of the source integration: `ffl-draft-tool-inventory.md`.
- Consumers: a **Discord bot** and a **personal team-manager tool**.

## Q1 — Caching: in-memory vs. persistent (SQLite)? — DECIDED

**Decision: in-memory only in the library, behind a pluggable `CacheStore`
interface. No persistence in the library for v1.**

Reasoning:
- A **cache** is a disposable, TTL'd copy of a fetch result to avoid re-hitting
  ESPN; deleting it costs nothing (just more fetches). ESPN stays the source of truth.
- A **store** (SQLite) is durable, consumer-owned data ESPN won't remember for you
  (e.g. "which transactions has the bot already announced", historical snapshots).
  Losing it loses information.
- Storage is a **consumer** responsibility, not the library's. The library is
  stateless transport: given creds + a request, return raw ESPN data.
- In-memory fully serves the long-running bot; the CLI/one-shot consumer gets little
  from persistence and stale-across-runs data is a correctness footgun for a team manager.
- Ship an in-memory `CacheStore` implementation; if a consumer later wants a
  SQLite-backed cache, it injects one — swap, not rewrite.

## Q2 — Resilience config per-consumer at construction? — DECIDED

**Decision: yes. Constructor-time config with sane defaults. Cache AND rate
limiter are injectable collaborators.**

- `new EspnFantasyClient({ creds })` works out of the box with defaults.
- Each consumer overrides `{ retry, rateLimit, cache, timeout }`. Profiles are
  near-opposite: bot = continuous, aggressive rate-limit, patient retry, cache on;
  one-shot tool = fast-fail (few retries, tight timeout), cache off/short.
- Make the **rate limiter injectable** (like the cache) so multiple client
  instances could share one limiter later (protects ESPN in aggregate). Per-instance
  is fine for v1 (single league).

## Q3 — Distribution / repo topology — DECIDED (reshaped by OpenClaw)

**Key new fact:** the Discord bot's runtime/"gateway" is **OpenClaw**
(https://openclaw.ai) — an open-source, self-hosted personal AI agent.
- OpenClaw's **Gateway** routes chat **channels** (Discord is first-class), picks a
  **model provider** (Claude, OpenAI, …), and runs **plugins** (distributed via
  ClawHub). Source checkouts are **pnpm workspaces**; plugins are packages
  (`extensions/*` deps).
- Implication: the bot is **not** a standalone discord.js process. The fantasy logic
  becomes an **OpenClaw plugin** exposing tools/commands; OpenClaw owns the Discord
  connection, message delivery, scheduling, the LLM (smack talk / summaries), and memory.

**Decisions so far:**
- The **draft tool stays in its own separate repo** — already built and stable, not a
  driver of this decision. Could be re-pointed at the library later via a `file:`/git
  dependency, but not required.
- **Revised distribution decision (supersedes the earlier "monorepo" lean):**
  make `espn-fantasy-client` a **standalone, publishable package in its own repo**
  (this `ESPN-API-Access`), a clean ESM package with types. Consumers depend on it as
  an **external** dependency, not a workspace-internal sibling — because an OpenClaw
  plugin lives in OpenClaw's tree/registry, which we don't own the workspace of.
  - Dev: use `pnpm link` / `file:` locally to avoid publish churn.
  - Release: publish to npm (or a git dependency) so the OpenClaw plugin / ClawHub can install it.
  - Use **pnpm** for the library's own toolchain to match OpenClaw's ecosystem; the
    package stays standard so npm consumers (e.g. the old draft tool) still work.

**Resolved (2026-09-05):**
- **Two genuinely separate consumers**, built in different places:
  - **Discord bot** — developed *on OpenClaw*. Matthew has had success with OpenClaw
    consuming **MCP servers**, so ESPN access is delivered as a **tiny MCP server**
    (`espn-mcp-server`) that wraps the library. OpenClaw launches/connects to it as an
    MCP subprocess. OpenClaw itself supplies the Discord channel, delivery, scheduling,
    model (smack talk / summaries), and memory.
  - **Team-manager** — a **separate app**, developed *here in Claude Code*, that imports
    `espn-fantasy-client` **directly** via `workspace:*` (no MCP indirection for an
    in-workspace app).
- **Decision: hand OpenClaw a library (wrapped as an MCP server), NOT a PRD.** A
  library is the single source of truth for ESPN's undocumented API — patch once, both
  consumers benefit. A PRD would make OpenClaw re-derive logic that already exists and
  risk missing quirks ($200 scaling, `kona_player_info`, SWID braces, 401 handling).

## Final architecture

```
espn-fantasy-client   ← shared library: ESPN logic + resilience (in-memory cache,
        │                retry/backoff, rate limit), returns raw-but-typed data
        │ workspace:*
   ┌────┴───────────────┐
espn-mcp-server      team-manager
(thin MCP wrapper)   (personal app, Claude Code)
        │                 │
   OpenClaw           (its own logic /
   (Discord bot)       Claude Code UX)
```

Repo layout (single local **pnpm workspace**):
```
ESPN-API-Access/
  packages/
    espn-fantasy-client/   ← library (publishable later if ever needed elsewhere)
    espn-mcp-server/        ← MCP server, deps on the client, for OpenClaw
    team-manager/           ← personal app, deps on the client via workspace:*
```
**Publishing deferred:** OpenClaw consumes the MCP *server* subprocess (not the
library), and both consumers live in this workspace, so the library needs no
npm/git publish for now.

## Next steps
- Verify OpenClaw's MCP-server config model in its docs (docs.openclaw.ai) — how it
  launches/connects to a stdio (or HTTP) MCP server — before wiring the bot.
- Scaffold the pnpm workspace + three packages per the layout above.
- Build `espn-fantasy-client` first (migration plan, PRD §7): lift `server/espn.ts`,
  strip app-specific shaping, add pagination + resilience, then add the season-long
  endpoints (`getRosters/getMatchups/getScoreboard/getStandings/getTransactions/getPlayerStats`).
- Then the MCP server (thin), then the team-manager app.
