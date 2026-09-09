# 003 — OpenClaw Automations (bot triggers)

Operational record of the cron jobs / triggers configured on the OpenClaw host.
These are **OpenClaw config, not code in this repo** (see `002-Specs.md` for the
ownership split). Recorded here so the finalized commands and their open checks
aren't lost.

## Discord channel registry

Delivery targets (channel IDs are identifiers, not secrets — safe to record):

| Channel        | ID                    | Used for                |
|----------------|-----------------------|-------------------------|
| `#reminders`   | `1546282433098547280` | Waiver reminder (below) |
| `#2026-season` | `1546281412640899084` | TBD                     |
| `#stickers`    | `1546285952606011433` | TBD                     |

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
