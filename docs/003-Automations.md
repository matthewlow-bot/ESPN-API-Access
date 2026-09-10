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

## Persona

**One bot agent, swappable persona** — not one agent per persona. A persona is a
`SOUL.md` file (tone, humor, boundaries) loaded at session start; OpenClaw's
**`agent:bootstrap` hook** can swap which persona file is injected, so the single
agent can change voices.

- **Current persona: Guillermo De La Cruz** (WWDITS familiar — anxious, deferential,
  loyal). Its `SOUL.md` is the active one.
- Persona is a property of the **agent**, applied globally — **not set per
  automation.** So the commands below carry **no persona flag**; whatever `SOUL.md`
  is active is the voice. (They target the bot agent via `--session`; add `--agent
  <bot>` only if the bot isn't the default agent on the gateway.)
- **Switching personas** = the `agent:bootstrap` hook selecting a different `SOUL.md`.
  The *swap mechanism* is OpenClaw-native; what *drives* the pick (manual / scheduled
  / league vote) is still unspecified — see `002-Specs.md` open items.
- **Tone lives here, not in prompts.** Attitude decisions — e.g. **roasting** the
  week's losers — belong in the active `SOUL.md`, so every post carries them
  consistently. Automation prompts supply only *content / targets* (what data to
  surface, whom to single out); the *voice* is the persona. For Guillermo, write the
  roast in-character — anxious, backhanded, passive-aggressive — not a generic savage
  takedown.

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

## Pre-Game Post — lineup-lock reminder + hype (schedule-driven / Option C)

*(Merges Events 1 + 7 — same trigger time, one post.)* Delivered to `#reminders`.
Unlike the waiver reminder (a fixed weekly cron), this one is **derived from the
real NFL schedule**, because game times move.

- **What:** a **single** post — lineup-lock nudge **first** ("games lock in ~1 hour,
  set your lineups"), **then a little pre-game hype** previewing this week's
  matchups. The persona (active `SOUL.md`, currently Guillermo) writes it.
- **When:** **1 hour before the first kickoff of each game day** that week — one
  post per day for **whatever days actually have games** (not a fixed set: a typical
  week is Thu/Sun/Mon, but e.g. this week was Wed/Sun/Mon; count varies ~2–4). The
  `firstKickoffPerGameDay` helper is day-agnostic — it buckets whatever days appear.
  (ESPN locks each player at their own game's kickoff, so per-game-day is the useful
  granularity.)
- **Content data:** matchup previews come from ESPN via `espn_get_matchups`
  (already available in `espn-mcp-server`) — the agent fetches it **at fire time**;
  the regenerator doesn't need to embed matchup data, just schedule the prompt.
- **Delivery:** `#reminders` (`1546282433098547280`).

### Mechanism — weekly regenerator + one-shot posts
Because kickoff times change weekly, we regenerate the posts each week rather than
run a fixed cron. Implemented as `packages/pregame-regenerator` (a small host
script; see below). The pipeline:

1. **Fire weekly.** A single fixed cron kicks the regenerator off early in the week
   (e.g. **Tuesday** — schedule firm after MNF, before the next games). This is the
   only fixed-time cron; everything it creates is dynamic.
2. **Resolve the week.** Default to ESPN's "current" week (`getWeek()` with no args);
   overridable via `--week`/`--year`. ⚠️ *Confirm host-side which week ESPN returns
   on a Tuesday — "current" can lag just after a week ends.*
3. **Fetch kickoffs.** `nfl-schedule-client` → `getWeek()` → `NflGame[]`.
4. **Compute targets.** `firstKickoffPerGameDay(games, "America/New_York")` → earliest
   kickoff per game day (day-agnostic — Wed/Thu/Sat/Sun/Mon, whatever the week has);
   subtract 1 hour → post time (ISO-UTC). ET→UTC conversion handles DST.
5. **Drop past targets.** Skip any target ≤ now (guards reruns / edge cases).
6. **Idempotency — clear the old set first.** Jobs are named deterministically
   (`Pre-Game Post <YYYY-MM-DD>`). Before creating, remove any existing job with that
   name so a re-run before firing doesn't double-post. ⚠️ *Depends on the exact
   `openclaw automations list`/`remove` interface — confirm host-side.*
7. **Create one-shot jobs.** For each target:
   ```bash
   openclaw automations add --at "<ISO-8601-UTC>" \
     "First games kick off in ~1 hour. Post to the league: (1) a lineup-lock reminder to set lineups now, then (2) a little pre-game hype previewing this week's matchups — pull the matchups with espn_get_matchups." \
     --name "Pre-Game Post <YYYY-MM-DD>" \
     --announce --channel discord --to "channel:1546282433098547280"
   ```
8. **Log the plan.** Print what was (or would be) scheduled — the debugging lifeline.

One-shots fire once and self-clean; next week's run creates the new set. Kickoffs
are UTC and `--at` takes ISO-UTC, so no timezone math on the job itself.

**Regenerator = our-logic + OpenClaw-calls.** Steps 2–5 are ours (pure, in the
package); steps 6–7 shell out to `openclaw automations`. So it's a host script, not
a pure OpenClaw automation — unless the gateway lets an agent create other
automations (unconfirmed). The script **defaults to a dry-run** (prints the plan);
`--apply` actually creates the jobs.

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

### Post target (clue for the regenerator)
Game-reminder posts go to **`#reminders` = `1546282433098547280`**. The regenerator
must set `--announce --channel discord --to "channel:1546282433098547280"` on every
`--at` job it creates (as in the command above). This is the destination — don't
lose it when the posting code is written.

### Status / to confirm
- ✅ **Regenerator built** — `packages/pregame-regenerator` (dry-run by default,
  `--apply` to create jobs). Its dry-run ran against **live ESPN** (2026-09-09) and
  produced a correct plan: 16 games → 3 future posts (Thu/Sun/Mon), 1h-before-first
  fire times, past game day correctly dropped.
- ✅ **Schedule parsing validated on live data** — team abbrevs 0/16 missing, kickoff
  dates and per-day grouping correct. `seasontype=2` / `competitions[0]` assumptions
  hold. (The client's `fetch` reaches ESPN even though `curl`/WebFetch were edge-403'd.)
- ⬜ **Idempotency (`clearExisting`)** — assumes `openclaw automations list --json`
  returns objects with `name`+`id`; unconfirmed. Fails open (logs + skips) if the
  shape differs. Confirm the real list/remove interface on the host.
- ⬜ **`--apply` on the host** — confirm `openclaw automations add --at ...` creates
  jobs as expected (can't run `openclaw` from this box).
- ⬜ **Which week** ESPN returns on the regenerator's run day — the live run returned
  upcoming games with the past day filtered, which is the desired shape; eyeball once
  on the real cron day to be sure it's the intended week (pass `--week`/`--year` if not).

## Weekly Summary v1 (Event 4 — clock-driven)

A once-a-week recap to `#2026-season`, written by the persona. **v1 = basic recap
from ESPN league data only** (no live-stats flavor yet — see `002-Specs.md`). Like
the waiver reminder, this is a **plain fixed cron** — no repo code, no schedule
source. Content comes from the already-built `espn-mcp-server` tools; the agent
calls them at fire time.

- **When:** Tuesday **9:00 AM PT** (`0 9 * * 2`, `--tz America/Los_Angeles`) — after
  Monday Night Football is done, before Wednesday's waivers.
- **Delivery:** `#2026-season` (`1546281412640899084`).

```bash
openclaw automations add "0 9 * * 2" \
  "Post the weekly fantasy recap for the league. Use the espn_* tools to get real data for the week that just finished: final scores and head-to-head results (espn_get_scoreboard / espn_get_matchups), the updated standings (espn_get_standings), and notable roster moves — waiver adds/drops and trades (espn_get_transactions). Write a recap covering: who won and lost and by how much, any blowouts or nail-biters, standings shake-ups (who climbed/fell), and the week's notable transactions. Single out roast-worthy targets from the data: the week's lowest-scoring team, the biggest blowout (name who got blown out), and the narrowest escape. Use only the league's actual data — do not invent players, scores, or stats." \
  --name "Weekly Summary" \
  --tz America/Los_Angeles \
  --session main \
  --announce --channel discord --to "channel:1546281412640899084"
```

The prompt supplies roast *targets* (lowest scorer, biggest blowout, narrowest
win); the roasting *voice* is a Guillermo `SOUL.md` trait (see Persona) — not in
this prompt, so it stays consistent across every post.

### To confirm / later
- ⬜ **Which scoring period** the `espn_*` tools return on a Tuesday — the prompt says
  "the week that just finished," but if the tools default to the *upcoming* period,
  pass an explicit `scoringPeriodId` (the completed week) so it recaps the right one.
- The recap **prompt is a first draft** — tune tone/length once we see Guillermo's output.
- Rich recap (biggest blowout, worst benching, injuries) is deferred to the live
  NFL-stats source.

## Error handling — errors NEVER hit the league channels

Policy: failures are reported to **the admin via DM**, never posted to a public
league channel. Two layers:

- **Regenerator (our code):** never targets a league channel on failure. It reports
  to a configurable DM target — `--error-target <dm-target>` or env
  `REGEN_ERROR_TARGET` — via `openclaw message send`. Partial failures (some jobs
  didn't create) and fatal crashes both DM the admin and set a non-zero exit code;
  if no target is set it logs locally only. ⚠️ *Confirm the Discord **DM target**
  syntax on the host* (likely `user:<your-discord-user-id>`); the script is
  target-agnostic, so set the right value at deploy.
- **Agent at fire time (OpenClaw):** this is the real channel-leak risk — a cron
  wakes the agent, a tool errors, and the agent's `--announce` text could post an
  error into the channel. Two guards:
  1. **Persona boundary** in every `SOUL.md`: *if you can't get the data or something
     goes wrong, do NOT post an error to the channel — stay silent* (in `personas/`).
  2. ⚠️ **Confirm OpenClaw's failed-run behavior** on the host: does a run that errors
     still `--announce` to the channel? If so, find how to route run errors to the
     admin (or suppress the announce on failure) rather than the league channel.

## Delivery verification — test posts (run on the host)

Before trusting the schedule, confirm each channel id routes to the right place.
One test post per channel; verify each lands where the message says:

```bash
openclaw message send --channel discord --target channel:1546282433098547280 --message "test -> should be #reminders"
openclaw message send --channel discord --target channel:1546281412640899084 --message "test -> should be #2026-season"
openclaw message send --channel discord --target channel:1546285952606011433 --message "test -> should be #stickers"
```
