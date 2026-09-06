# Running this MCP server under OpenClaw

Field notes for wiring `espn-mcp-server` into an [OpenClaw](https://openclaw.ai)
gateway as a stdio MCP server. Verified against OpenClaw on 2026-09-05 (gateway
running as an unprivileged Docker container).

## Install & register (on the OpenClaw host)

```bash
git clone https://github.com/matthewlow-bot/ESPN-API-Access.git
cd ESPN-API-Access
corepack pnpm install
corepack pnpm -r build

openclaw mcp add espn \
  --command "$(command -v node)" \
  --arg dist/index.js \
  --cwd "$PWD/packages/espn-mcp-server"

openclaw mcp probe espn      # should list the 12 espn_* tools
```

Use the **absolute** `node` path (`$(command -v node)`) and an absolute `--cwd` so
the gateway spawns the server reliably regardless of `PATH`.

If `corepack enable` fails because its cache dir isn't writable (common in an
unprivileged container), point it at a writable dir first:
`export COREPACK_HOME="$HOME/.cache/corepack"`.

## Credentials — the part that bites

The server reads `ESPN_LEAGUE_ID`, `ESPN_SEASON`, `ESPN_S2`, `ESPN_SWID` from its
**own process environment** (`process.env`). Getting those into the spawned
subprocess under OpenClaw is the tricky bit:

- **`${VAR}` templates in `mcp.servers[].env` resolve against the gateway's
  `process.env`** — and OpenClaw's **env-kind secret store does NOT populate
  `process.env`**, so such a template silently resolves to empty.
- **Top-level `mcp.servers[].env` rejects `SecretRef` objects** ("Invalid input")
  in the version tested; secret-kind entries are not injected into MCP
  subprocess env either.
- **What worked:** put the values in **`~/.openclaw/.env`** (the gateway reads it
  at startup → they land in `process.env` → the spawned child inherits them),
  then do a **full gateway restart** — not `openclaw mcp reload`. Subprocess env
  is fixed at launch, so a reload alone will not pick up new creds.

`ESPN_SEASON` and `ESPN_LEAGUE_ID` are non-secret; only `ESPN_S2` and `ESPN_SWID`
are sensitive. **Paste only the cookie VALUE** — not `NAME=value`. (The server now
strips an accidental `ESPN_S2=`/`ESPN_SWID=` prefix and validates the SWID shape,
returning an actionable error instead of an opaque ESPN 401, but entering them
cleanly avoids the whole problem.)

## Verify

Ask the agent to run `espn_check_connection`. Success returns the league name
(e.g. "Cool People League"). A clear "not configured" / "malformed" message means
the creds never reached the process env or were pasted wrong; an
`EspnAuthError (401)` means the cookies are expired or for a different league.

## Updating

Patch the library here → push to `main` → on the host:

```bash
cd ESPN-API-Access && git pull && corepack pnpm -r build
```

then **restart the gateway** so the server relaunches with the new build.
