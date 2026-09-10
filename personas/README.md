# Personas — the bot's voice roster

The bot is a **single** OpenClaw agent with a **swappable** persona. Its personality
is a `SOUL.md` file (tone, humor, boundaries) that OpenClaw loads every session. This
directory is the version-controlled roster of persona files — one per character.

- **Active persona:** `guillermo.md` (Guillermo De La Cruz).

## Why it's clean to swap
Tone/voice lives here (in the persona file), **not** in the automation prompts. The
crons supply only *content/targets* — what to post, whom to roast — and the persona
supplies the *voice*. So swapping a persona **re-voices every post** (reminders,
pre-game, recap) with **zero changes to any cron or prompt**. See `docs/002-Specs.md`
(persona) and `docs/003-Automations.md` (Persona section).

## Switching the persona (mid-season or next season — same steps)
1. Pick or author the persona file here (add new ones to grow the roster).
2. Install it as the bot agent's active `SOUL.md` on the OpenClaw host — copy it,
   symlink it, or point the `agent:bootstrap` hook at it.
3. **Reload / start a fresh agent session** so the new `SOUL.md` loads — it's read
   per session, so it won't change mid-conversation.

A manual swap needs only steps 1–3. A mid-season swap changes the bot's voice
abruptly (the league will notice — could be a fun reveal, or jarring; your call).

The `agent:bootstrap` hook is only required for **programmatic** selection — scheduled
rotation, or a league vote choosing the persona. That's still an open item (see
`002-Specs.md`) and is **not** needed for occasional manual switches.

## Adding a persona
Copy `guillermo.md` as a template, rewrite the voice, and keep the same section shape
(who you are / voice & tone / humor & roasting / boundaries). Keep the **boundaries**
consistent across personas — no invented stats, **never post errors to the channel
(stay silent on failure)**, Discord-length posts, stay in character — so only the
*flavor* changes, not the rules.
