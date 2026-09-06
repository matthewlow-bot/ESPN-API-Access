# Project Status

_Last updated: 2026-09-05_

Shared ESPN Fantasy Football API access, extracted from the FFL Draft Tool into a
reusable library, plus a thin MCP server for OpenClaw and (planned) a personal
team-manager app.

## Where things stand

| Piece | Status |
|---|---|
| Planning docs (inventory, PRD, decisions, spec) | ✅ complete — see `docs/` |
| `packages/espn-fantasy-client` (library) | ✅ built, zero runtime deps, **validated against the live league** |
| `packages/espn-mcp-server` (stdio MCP wrapper, 12 tools) | ✅ built, smoke-tested |
| Team-manager app | ⬜ not started (its own spec, TBD) |
| OpenClaw wiring | ⬜ not done — recipe ready in `docs/espn-fantasy-client-spec.md` §3.4 |
| Tests | ✅ 25/25 passing (offline, fixture-driven) |

## Architecture

```
espn-fantasy-client   ← shared library: ESPN logic + resilience, raw-but-typed data
        │ workspace:*
   ┌────┴───────────────┐
espn-mcp-server      team-manager (planned)
(stdio, for OpenClaw) (personal app, built in Claude Code)
```

- Read-only, v1. No write operations, no cookie refresh.
- **Thin typing with a `raw` passthrough** on every returned object.
- Consumers own scaling/formatting; the library returns ESPN's own ids/values.

## Develop / build / test

Requires Node 18+ and `corepack` (pnpm is auto-provisioned; prefix commands with
`corepack` in environments where pnpm isn't installed globally).

```bash
corepack pnpm install
corepack pnpm -r build
corepack pnpm --filter espn-fantasy-client test
corepack pnpm -r typecheck
```

## Credentials (never commit these)

The library takes creds as constructor args; the MCP server reads them from env:
`ESPN_LEAGUE_ID`, `ESPN_SEASON`, `ESPN_S2`, `ESPN_SWID`. The `espn_s2` / `SWID`
cookies are long-lived, copied from a logged-in ESPN browser session. `.env` is
gitignored — keep it that way.

## Wiring into OpenClaw (stdio MCP)

OpenClaw connects MCP servers natively (`mcp.servers` in `~/.openclaw/openclaw.json`).
On the OpenClaw host:

```bash
git clone https://github.com/matthewlow-bot/ESPN-API-Access.git
cd ESPN-API-Access && corepack pnpm install && corepack pnpm -r build
openclaw mcp add espn --command node --arg dist/index.js --cwd "$PWD/packages/espn-mcp-server"
openclaw mcp doctor espn --probe
```

Supply the four `ESPN_*` values via **OpenClaw's secret mechanism**, not config
literals. Update flow when ESPN changes something: patch the library → push →
on host `git pull && corepack pnpm -r build` → OpenClaw hot-reloads. Full detail
in `docs/espn-fantasy-client-spec.md` §3.4.

## Next steps

1. Wire the MCP server into OpenClaw (recipe above) and verify with `mcp doctor`.
2. Build the team-manager app (write its spec first).
3. Re-verify in-season parsers once Week 1 completes (standings/results were
   all-zero preseason); confirm a live `TRADE_ACCEPTED` transaction payload.

## Open items

Tracked in `docs/espn-fantasy-client-spec.md` §5. OpenClaw transport is resolved
(stdio). Remaining: in-season data re-check, trade payload confirmation, and
`getPlayerStats` coverage for arbitrary historical weeks.
