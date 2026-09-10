# pregame-regenerator

Weekly host script that (re)creates the **Pre-Game Post** OpenClaw jobs — one
one-shot job **1 hour before the first game of each game day**, delivered to
`#reminders`. Each post is a lineup-lock reminder + a little pre-game hype
(Events 1+7 in `docs/002-Specs.md`; mechanism in `docs/003-Automations.md`).

Reads kickoffs via [`nfl-schedule-client`](../nfl-schedule-client); the per-day
grouping is `firstKickoffPerGameDay`, so it adapts to whatever days a week has
(Wed/Thu/Sat/Sun/Mon) with no hardcoded days.

## Run (on the OpenClaw host)

```bash
# Dry-run (default): prints the plan, changes nothing.
node dist/index.js

# Actually create the jobs:
node dist/index.js --apply
```

Options: `--week <n>` / `--year <yyyy>` (default: ESPN "current" week),
`--tz <IANA>` (default `America/New_York`), `--lead-minutes <n>` (default `60`),
`--channel <discord-channel-id>` (default `#reminders`).

Intended to be triggered by one fixed weekly cron (e.g. Tuesday). The jobs it
creates are one-shots that fire once and self-clean; each run clears and rebuilds
the week's set.

## Before trusting `--apply` — confirm on the host

- **Which week** ESPN returns for "current" on a Tuesday (may lag just after a
  week ends; pass `--week`/`--year` explicitly if so).
- **The `openclaw automations list`/`remove` interface** used for idempotency in
  `clearExisting()` — it assumes `automations list --json` returns objects with
  `name` + `id`. If the real shape differs, dedupe fails open (logs + skips);
  adjust `clearExisting()` to match.
- That `openclaw automations add --at ...` creates jobs as expected.

Live ESPN fetch is blocked from non-host IPs (Akamai edge 403 — not auth), so
verify field assumptions and behavior on the host.
