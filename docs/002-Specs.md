# 002 — Bot Events & Trigger Specs

## Purpose
This spec defines the distinct post-worthy events for the fantasy football Discord bot, and — for each — separates out its **trigger mechanism**, **content**, and **delivery** so these can be built and modified independently.

## Architecture & Scope

**We are not building a Discord bot process.** The bot is operated by [OpenClaw](https://openclaw.ai) — a self-hosted gateway that connects to Discord as a bot (over Discord's official gateway) and runs an *agent layer* holding the personality, instructions, and LLM. Our deliverable is a set of **MCP tools** that OpenClaw's agent calls. `espn-mcp-server` is the first of these and is already built.

This splits every capability in the spec into one of two owners:

- **OpenClaw owns** (configuration + agent layer, not code we write):
  - **Delivery** — posting to Discord, which channel, formatting, ping behavior (channel config: allowlists, `requireMention`, thread isolation)
  - **Message-driven reaction** — listening to channel activity and deciding whether to respond (native chat-gateway behavior)
  - **Persona / voice** — the content's *tone* comes from the bot agent's persona. **Architecture: a single bot agent with a swappable persona** (not one agent per persona). A persona is a `SOUL.md` file (tone, humor, boundaries), and the active one is selected at startup via OpenClaw's `agent:bootstrap` hook, which can swap `SOUL.md` for an alternate persona file. **Current persona: Guillermo De La Cruz** (the anxious, deferential, loyal familiar from *What We Do in the Shadows*). See `003-Automations.md`.
- **We build** (MCP tools OpenClaw's agent invokes):
  - **Data access** — ESPN league data (`espn-mcp-server`, done); an **NFL-schedule source** (ESPN public scoreboard API — reusable across Game Reminders, Pre-Game Hype, Weekly Summary; specced in `003-Automations.md`); and later a live NFL in-game stats source (for smack talk)
  - **Event-object layer** — normalized events merged from those sources (see Data Layer below)
  - **Proactive triggers** — the clock-driven and live-event-driven mechanisms below. This is the true gap: a chat gateway reacts to incoming messages, so nothing in OpenClaw natively wakes the agent on the NFL schedule or on a live in-game signal and prompts it to post. Something we build has to invoke the agent proactively.
  - **Media tools** — e.g. a sticker-maker that turns a posted image into a Discord-format sticker (see Event 6). Not fantasy data; a separate capability.

**Endgame:** once the tools exist, they are registered with OpenClaw (see `OPENCLAW.md` for the wiring pattern) and the agent is told how to use them; OpenClaw handles everything else.

## Trigger Categories

Events fall into three fundamentally different trigger mechanisms. This distinction matters because each requires different infrastructure — and, per the scope above, a different owner:

- **Clock-driven** *(we build)* — fires based on the actual NFL schedule for the week (not a fixed weekday/time), since schedule shape varies (Thanksgiving Wed/Thu games, Christmas games, Thursday/Monday night games shifting lock times).
- **Live-event-driven** *(we build)* — fires in reaction to something happening in a game in progress (score change, big play). Requires a polling or webhook loop watching live data, not a cron.
- **Message-driven** *(OpenClaw owns)* — fires in reaction to human activity in the Discord channel itself. This is OpenClaw's native behavior; our role is at most a relevance/frequency filter, and only if its built-in controls (`requireMention`, allowlists) prove insufficient.

## Events

### 1. Pre-Game Post — lineup-lock reminder + hype  *(merged with Event 7)*
- **Trigger type:** Clock-driven, **1 hour before the first game of each game day** — *we build*. One post per game day, for **whatever days actually have games that week** (not a fixed set — e.g. this week was Wed/Sun/Mon; a typical week is Thu/Sun/Mon; count varies 2–4). The `firstKickoffPerGameDay` helper is day-agnostic. Schedule-driven, sharing the exact mechanism as the former Event 7 (Game Reminders).
- **Content:** A **single post** written by the persona — **lineup-lock reminder first** ("games lock in ~1 hour, set your lineups"), **then a little pre-game hype** previewing this week's matchups. Matchup data comes from ESPN (`espn_get_matchups`, already available); the agent fetches it at fire time.
- **Delivery:** OpenClaw, to **`#reminders`** (`1546282433098547280`).
- **Note:** Event 1 (Pre-Game Hype) and Event 7 (Game Reminders) were **merged (2026-09-08)** — same trigger time, so one post does both. Full mechanism in `003-Automations.md`.

### 2. In-Game Smack Talk
- **Trigger type:** Live-event-driven — needs a live signal (score change, big play) to react to — *we build*
- **Content:** Reactive tone, tied to whatever just happened in-game
- **Delivery:** OpenClaw

### 3. Weekly Waiver Reminder
- **Trigger type:** Clock-driven, tied to the actual waiver deadline (pull from league settings, don't hardcode) — *we build*
- **Content:** Reminder/nag tone
- **Delivery:** OpenClaw

### 4. Weekly Summary
- **Trigger type:** Clock-driven, anchored to "after that week's games finish" (not a fixed day) — *we build*. Timing comes from the NFL-schedule source (see `003-Automations.md`).
- **Content — scoped in two phases:**
  - **v1 (basic recap, buildable now):** final scores, matchup results, standings movement, notable transactions — all from ESPN league data via `espn-mcp-server` (already built). No live NFL context needed.
  - **Later (rich recap):** pulls from the merged event list (biggest blowout, worst benching, injuries, etc.). Blocked on the event-object layer + the live NFL-stats source (neither built).
- **Delivery:** OpenClaw
- **Note:** Trigger and v1 content are unblocked today; only the rich content waits on the live-stats source.

### 5. Conversational Join-In
- **Trigger type:** Message-driven — OpenClaw listens to channel activity and decides whether a given human message warrants a response — *OpenClaw owns*
- **Content:** Conversational tone; implies restraint (not every message), relevance (on-topic), and timing (not instant, not delayed)
- **Delivery:** OpenClaw
- **Note:** Largely native OpenClaw behavior. The only thing we might build is a "should I respond" filter, and only if OpenClaw's built-in mention/allowlist controls aren't enough. Needs its own follow-up spec before that call can be made.

### 6. Sticker Maker
- **Trigger type:** Message-driven, filtered to **image attachments** posted in `#stickers` — *OpenClaw owns the listening*
- **Content:** Not a persona message — a **media transform**: reproduce the **iOS sticker effect** on the posted image — subject cutout (background removal) + the signature white outline — output as a **transparent PNG**.
- **Delivery:** OpenClaw posts the PNG **as an image** into `#stickers` (`1546285952606011433`). **Decided:** not a registered Discord server sticker, so no Manage-Expressions permission and no server sticker-slot limits.
- **Note:** New feature, **outside the original fantasy-event set** and different in kind — media in → media out, not fantasy data and not text.
  - **Build owner — OpenClaw, NOT this repo (decided 2026-09-09):** built in OpenClaw using an **image model via OpenRouter** (Claude Code has no image-generation ability). No monorepo package/tool. The only shared infra is OpenClaw's native `{{AttachmentPath}}` plumbing (below).
  - **Watch out — "generate" ≠ "cut out":** the iOS effect is *background removal* (keep the real subject from the photo + white outline). An image-*generating* model tends to make a NEW, restyled image rather than faithfully cutting out the actual person. If the goal is "a sticker of *me* from my photo," use a segmentation/background-removal model or endpoint; a generative model gives "a sticker *inspired by* the photo." Also confirm the chosen model can emit a **transparent PNG** (generative endpoints often return opaque images).
  - **Plumbing — RESOLVED (2026-09-08), file paths (not binary-over-JSON):** OpenClaw downloads inbound media to a temp file and exposes `{{AttachmentPath}}` + `{{AttachmentUrl}}`; outbound sending accepts a local file path and **keeps transparency as PNG** (only opaque images get recompressed to JPEG). Pipeline: post → `{{AttachmentPath}}` → OpenClaw/OpenRouter produces the sticker PNG → OpenClaw posts it back to `#stickers`. **Still confirm on the gateway:** that Discord *image attachments* populate `{{AttachmentPath}}`.
  - **Sticker style — TO DEFINE (open).** A single fixed style is needed so output is consistent across stickers. Not yet chosen. When defined, it should be a reusable prompt preamble + constraints covering: art style / subject treatment (e.g. cartoon-vector, die-cut photo cutout, 3D, comic — this also settles generate-vs-cut-out), finish (white die-cut border, transparent bg, optional drop shadow), composition (centered, head-and-shoulders, facing forward), output size (square; Discord sticker is 320×320), and a negative-prompt list (no text/watermarks/busy background). Until defined, the Sticker Maker isn't buildable.
  - Not a registered Discord server sticker — posted as an image (no Manage-Expressions permission, no slot limits).

### 7. Game Reminders (lineup-lock) — **MERGED into Event 1**
Merged (2026-09-08) with Pre-Game Hype: same trigger time (1 hr before each game
day's first kickoff), so a single post to `#reminders` does both — lineup-lock
reminder first, then hype. See **Event 1** and `003-Automations.md`.

## Content/Timing/Delivery Decomposition (general principle)

Any bundled feature noun ("updates," "reminders," "notifications") should be split into these three dimensions before building, since each can change independently — and, here, since each has a different owner:

- **Content** — what the message says / which template or persona voice generates it *(OpenClaw agent layer)*
- **Timing** — when it fires (which, per above, may be clock-driven, live-event-driven, or message-driven — not always a simple schedule) *(clock/live: we build; message: OpenClaw)*
- **Delivery** — how/where it's posted to Discord (channel, formatting, ping behavior) *(OpenClaw)*

Test for whether something needs to be split: *could this dimension change without the others changing?* If yes, spec it separately.

## Data Layer (feeds events 2 and 4 especially)

Two data sources feed into a shared, normalized event-object layer before any persona/content logic touches them. Both sources, and the merge, are **MCP tools we build**:

1. **League data** (ESPN Fantasy API client, exposed via `espn-mcp-server` — built) — matchups, scores, rosters, box scores, transactions
2. **Game context** (live NFL stats source, e.g. MySportsFeeds — not built) — injuries, big plays, blowout scores, upsets

These merge into normalized event objects, e.g.:
```
{ type: "close_loss", team: "Dave", margin: 4.2 }
{ type: "injury", player: "X", team: "Marcus" }
{ type: "blowout", winner: "Y", score: "142-61" }
{ type: "bad_bench", team: "Dave", benched_player: "X", points_missed: 18 }
```

The agent's persona/content logic should only ever consume these normalized event objects — never raw API responses from either source. See `discord-bot-data-sources.md` for the full data-merge design.

## Open Items
- **Doc split (deferred):** this file blends requirements (the events + their intent/tone) with spec/design (Architecture & Scope, trigger mechanics, event-object shapes). Later, split to match the client's `-prd` / `-spec` convention — requirements → a bot PRD, the rest → a bot spec. No rush; sections are already grouped to make the move mechanical.
- Proactive-trigger mechanism (how clock-driven and live-event-driven triggers invoke the OpenClaw agent) not yet designed — this is the primary gap
- Live NFL-stats MCP source not yet built
- Event-object merge layer (`discord-bot-data-sources.md`) not yet written
- Conversational join-in "should I respond" filter — decide whether OpenClaw's native controls suffice before speccing custom logic
- Persona: **architecture decided + manual swap specced** — single bot agent, swappable `SOUL.md`; **current persona = Guillermo De La Cruz**. Version-controlled roster in `personas/` (one file per character; `personas/guillermo.md` + `personas/README.md`). **Manual swap (mid-season or next season):** install the chosen file as the agent's `SOUL.md` + reload the session — no cron/prompt changes, since tone lives in `SOUL.md` and prompts are content-only. Still open: **programmatic** selection only (scheduled rotation or a league vote) — needs the `agent:bootstrap` hook to pick the file automatically; not needed for manual switches.
- Sticker Maker (Event 6): built in OpenClaw + OpenRouter (not this repo); plumbing resolved. **Blocking open item: define a single fixed sticker STYLE** (art style, finish, composition, size, negative prompt) so output is consistent — undefined for now; not buildable until chosen.
