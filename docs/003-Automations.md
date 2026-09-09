# 003 — OpenClaw Automations (bot triggers)

Operational record of the cron jobs / triggers configured on the OpenClaw host.
These are **OpenClaw config, not code in this repo** (see `002-Specs.md` for the
ownership split). Recorded here so the finalized commands and their open checks
aren't lost.

## Discord channel registry

Delivery targets (channel IDs are identifiers, not secrets — safe to record):

| Channel        | ID                    | Used for                |
|----------------|-----------------------|-------------------------|
| `#reminders`   | `1546282433098547280` | Reminders hub — waiver reminder (below) + other scheduled reminders |
| `#2026-season` | `1546281412640899084` | Weekly updates (Weekly Summary; likely Pre-Game Hype too) |
| `#stickers`    | `1546285952606011433` | Sticker maker — users post pics, bot turns them into stickers |

## Waiver Reminder (Event 3 — clock-driven)

- **What:** weekly nag, the last call before Wednesday morning's waiver run.
- **When:** Tuesday **5:00 PM Pacific** (`--tz` handles the Nov PDT→PST switch).
- **Data:** none — pure time-based reminder; the agent's persona writes the voice.

Run on the OpenClaw host:

```bash
openclaw automations add "0 17 * * 2" \
  "Post a waiver-wire reminder to the league. Waivers process early Wednesday morning ET, so tonight (Tuesday) is the last chance to set this week's claims. Reminder/nag tone." \
  --name "Waiver Reminder" \
  --tz America/Los_Angeles \
  --session main \
  --announce --channel discord --to "channel:1546282433098547280"
```

Manage: `openclaw automations list` / `openclaw automations remove <job-id>`.

### Open checks (verify before trusting)
- ~~**Proactive firing**~~ ✅ **handled by the OpenClaw cron skill** — the skill
  drives autonomous firing, so the #14501 "only fires after a manual message" issue
  doesn't apply here. No separate poker needed.
- ~~**Discord delivery flag**~~ ✅ **confirmed (2026-09-08):** `--channel discord`
  is correct; the target accepts a bare numeric id or `channel:<id>`. Automations
  use `--to`; the standalone `openclaw message send` uses `--target` (same values).

To test delivery to the channel independently of the schedule:

```bash
openclaw message send --channel discord --target channel:1546282433098547280 --message "waiver reminder test"
```

### Reference — ESPN waiver settings for this league (as of 2026-09-07)
From `espn_get_settings` → `acquisitionSettings`: processes daily **except Tuesday**
at hour 11 (ESPN uses ET); `WAIVERS_TRADITIONAL`, 48-hour waiver period. The
Tuesday-5PM-PT reminder is a human choice (last call before Wednesday), not derived
from these fields.

## Game Reminders (lineup-lock — schedule-driven / Option C)

Also delivered to `#reminders`. Unlike the waiver reminder (a fixed weekly cron),
this one is **derived from the real NFL schedule**, because game times move.

- **What:** a lineup-lock nudge — "games lock in 1 hour, set your lineup."
- **When:** **1 hour before the first kickoff of each game day** that week
  (Thursday / Sunday / Monday, plus holiday game days). ~2–3 reminders/week — one
  "last call before today's games lock" per slate. (ESPN locks each player at their
  own game's kickoff, so per-game-day is the useful granularity.)
- **Delivery:** `#reminders` (`1546282433098547280`).

### Mechanism — weekly regenerator + one-shot reminders
Because kickoff times change weekly, we regenerate the reminders each week rather
than run a fixed cron:

1. A **weekly regenerator** runs early in the week (e.g. Tue, once the schedule is
   firm).
2. It fetches this week's kickoffs (NFL-schedule source below), groups games by
   local game day, takes each day's **earliest** kickoff, and subtracts 1 hour.
3. For each target time it creates an OpenClaw **one-shot** reminder:
   ```bash
   openclaw automations add --at "<ISO-8601-UTC>" \
     "Post a lineup-lock reminder: first games kick off in ~1 hour, set your lineups now." \
     --name "Game Reminder <day>" \
     --announce --channel discord --to "channel:1546282433098547280"
   ```
4. One-shots fire once and self-clean; next week's run creates the new set.

Kickoffs come back in UTC and `--at` takes an ISO-UTC timestamp, so no timezone
math is needed for the job itself.

### NFL-schedule source (reusable component — build once)
Kickoff times are needed by **Game Reminders**, and also by **Pre-Game Hype**
(fire relative to game start) and **Weekly Summary** (fire after games finish).
So build the schedule fetch **once** as a reusable tool.

- **Source:** ESPN's public scoreboard API —
  `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?week=<N>&year=<YYYY>&seasontype=2`.
  No auth. Each event's `date` (ISO-8601 UTC) is the kickoff; `shortName` gives the
  matchup. Separate from the authed fantasy API `espn-fantasy-client` uses.
- **Note:** this is the "NFL context" second source the spec (`002-Specs.md`)
  anticipated — the *schedule* slice of it (live in-game stats, for smack talk,
  is a later, larger piece).

### To build / confirm
- **Confirm the ESPN scoreboard API is reachable from the OpenClaw host** (403s
  from other IPs are edge-blocking, not auth — verify host-side).
- **Confirm one-shot `--at` jobs can be created programmatically** by the
  regenerator on this gateway.
- **Regenerator home:** a small host script on a weekly cron (fetch + create
  `--at` jobs) is the simplest, most reliable shape; the schedule fetch itself is
  the reusable tool above.
