#!/usr/bin/env node
// ---------------------------------------------------------------------------
// pregame-regenerator
//
// Weekly host script. Reads this week's NFL kickoffs (nfl-schedule-client) and
// (re)creates one OpenClaw one-shot "Pre-Game Post" job 1 hour before the first
// game of each game day, delivered to #reminders. Each post is a lineup-lock
// reminder + a little pre-game hype (Events 1+7, merged — see docs/003-Automations.md).
//
// Runs on the OpenClaw HOST (it shells out to `openclaw automations ...`).
// DEFAULTS TO DRY-RUN: prints the plan. Pass --apply to actually create jobs.
//
// HOST-SIDE UNKNOWNS to confirm before trusting --apply (see docs/003-Automations.md):
//   - which week ESPN returns for "current" on a Tuesday (step: resolve week);
//   - the exact `openclaw automations list`/`remove` interface used for idempotency.
// ---------------------------------------------------------------------------

import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import {
  NflScheduleClient,
  firstKickoffPerGameDay,
  DEFAULT_SCHEDULE_TZ,
  type GameDayKickoff,
} from "nfl-schedule-client";

/** Delivery target: #reminders. See docs/003-Automations.md channel registry. */
const REMINDERS_CHANNEL_ID = "1546282433098547280";

/** Prompt handed to the (persona) agent when the job fires. */
const PREGAME_PROMPT =
  "First games kick off in ~1 hour. Post to the league: (1) a lineup-lock " +
  "reminder to set lineups now, then (2) a little pre-game hype previewing this " +
  "week's matchups — pull the matchups with espn_get_matchups.";

interface Options {
  apply: boolean;
  tz: string;
  leadMinutes: number;
  channel: string;
  /** OpenClaw agent that owns/runs the job (the dedicated FF agent, "commish"). */
  agent: string;
  /** Discord account/identity delivery goes out as (the "ffbot" account). */
  account: string;
  week?: number;
  year?: number;
  /** Where failures are reported (a DM target) — NEVER a league channel. */
  errorTarget?: string;
}

function parseOptions(argv: string[]): Options {
  const { values } = parseArgs({
    args: argv,
    options: {
      apply: { type: "boolean", default: false },
      tz: { type: "string", default: DEFAULT_SCHEDULE_TZ },
      "lead-minutes": { type: "string", default: "60" },
      channel: { type: "string", default: REMINDERS_CHANNEL_ID },
      agent: { type: "string", default: "commish" },
      account: { type: "string", default: "ffbot" },
      week: { type: "string" },
      year: { type: "string" },
      "error-target": { type: "string" },
    },
  });
  const num = (v: string | undefined): number | undefined =>
    v === undefined ? undefined : Number(v);
  return {
    apply: Boolean(values.apply),
    tz: String(values.tz),
    leadMinutes: Number(values["lead-minutes"]),
    channel: String(values.channel),
    agent: String(values.agent),
    account: String(values.account),
    week: num(values.week as string | undefined),
    year: num(values.year as string | undefined),
    // DM target for failure reports. Config at deploy (env or flag); never a league channel.
    errorTarget:
      (values["error-target"] as string | undefined) ?? process.env.REGEN_ERROR_TARGET,
  };
}

/** A single planned post. */
interface PlannedPost {
  name: string;
  /** ISO-8601 UTC — when the job fires (1h before the day's first kickoff). */
  at: string;
  gameDay: string;
  firstKickoff: string;
  gameCount: number;
}

/** Steps 4–5: turn per-game-day first kickoffs into future post targets. */
function planPosts(
  days: GameDayKickoff[],
  leadMinutes: number,
  now: Date,
): PlannedPost[] {
  const leadMs = leadMinutes * 60_000;
  const posts: PlannedPost[] = [];
  for (const day of days) {
    const at = new Date(day.firstKickoffDate.getTime() - leadMs);
    if (at.getTime() <= now.getTime()) continue; // step 5: drop past targets
    posts.push({
      name: `Pre-Game Post ${day.gameDay}`,
      at: at.toISOString(),
      gameDay: day.gameDay,
      firstKickoff: day.firstKickoff,
      gameCount: day.gameCount,
    });
  }
  return posts;
}

/** Build the argv for `openclaw automations add` for one post. */
function addArgs(post: PlannedPost, opts: Options): string[] {
  return [
    "automations",
    "add",
    "--at",
    post.at,
    // Prompt must be an explicit --message payload: with --at set, a bare positional
    // is treated as the job name, and the gateway rejects it ("Choose exactly one
    // payload: --system-event, --message, --command, or --script"). Verified on the
    // live gateway 2026-09-10.
    "--message",
    PREGAME_PROMPT,
    "--name",
    post.name,
    // Run as the dedicated FF agent and deliver out the ffbot Discord identity —
    // NOT main/personal Clawbert. Without --agent an --at job defaults to its creator.
    "--agent",
    opts.agent,
    "--account",
    opts.account,
    "--announce",
    "--channel",
    "discord",
    "--to",
    `channel:${opts.channel}`,
    // Don't hard-fail / retry-spam if a single delivery fails (pairs with the
    // persona's "stay silent on failure" boundary — errors never reach the channel).
    "--best-effort-deliver",
  ];
}

function runOpenclaw(args: string[]): { ok: boolean; output: string } {
  const res = spawnSync("openclaw", args, { encoding: "utf8" });
  if (res.error) return { ok: false, output: String(res.error.message ?? res.error) };
  const output = `${res.stdout ?? ""}${res.stderr ?? ""}`.trim();
  return { ok: res.status === 0, output };
}

/**
 * Step 6 (idempotency): best-effort removal of an existing job with this name so
 * a re-run before the job fires doesn't double-post.
 *
 * Removal uses `openclaw automations rm <id>` (Clawbert confirmed the verb is `rm`,
 * not `remove`). The `automations list --json` shape is still being confirmed on the
 * gateway; this expects an array of objects carrying a name/id. If the output shape
 * differs, it logs and skips (fail-open) rather than guessing wrong.
 */
function clearExisting(name: string): void {
  const listed = runOpenclaw(["automations", "list", "--json"]);
  if (!listed.ok) {
    console.warn(`  ! could not list existing jobs to dedupe (${listed.output}); skipping clear`);
    return;
  }
  let jobs: Array<Record<string, unknown>>;
  let hasMore = false;
  try {
    const parsed = JSON.parse(listed.output);
    // Confirmed shape (Clawbert): { jobs: [...], hasMore, nextOffset }; items carry id + name.
    jobs = Array.isArray(parsed) ? parsed : (parsed?.jobs ?? []);
    hasMore = Boolean(parsed?.hasMore);
  } catch {
    console.warn("  ! `automations list --json` was not JSON as expected; skipping clear (confirm host interface)");
    return;
  }
  if (hasMore) {
    // TODO(host): confirm the limit/offset flags and page through; for now dedupe
    // only sees the first page (fine while FF jobs are few).
    console.warn("  ! automations list is paginated (hasMore=true) — dedupe only saw the first page");
  }
  for (const job of jobs) {
    if (job?.name !== name) continue;
    const id = job.id as string | undefined;
    if (!id) continue;
    const removed = runOpenclaw(["automations", "rm", id]);
    console.log(`  - removed existing "${name}" (${id})${removed.ok ? "" : ` [warn: ${removed.output}]`}`);
  }
}

/**
 * Report a failure to the admin DM target. Errors NEVER go to a league channel —
 * only to this configured DM target (or nowhere, if unset). If the notify itself
 * fails, log locally; don't escalate to a channel.
 */
function notifyAdmin(target: string | undefined, message: string): void {
  if (!target) {
    console.error("  (no --error-target / REGEN_ERROR_TARGET set — error not DM'd)");
    return;
  }
  const res = runOpenclaw([
    "message", "send", "--channel", "discord", "--target", target, "--message", message,
  ]);
  if (!res.ok) console.error(`  ! failed to DM admin (${target}): ${res.output}`);
}

async function run(opts: Options): Promise<void> {
  const now = new Date();

  // Steps 2–3: resolve week + fetch kickoffs.
  const client = new NflScheduleClient();
  const games = await client.getWeek({ week: opts.week, year: opts.year });

  // Step 4: earliest kickoff per game day (day-agnostic).
  const days = firstKickoffPerGameDay(games, opts.tz);
  const posts = planPosts(days, opts.leadMinutes, now);

  // Step 8: log the plan.
  console.log(
    `pregame-regenerator ${opts.apply ? "APPLY" : "DRY-RUN"} — ${games.length} games, ` +
      `${days.length} game day(s), ${posts.length} post(s) to schedule ` +
      `(tz=${opts.tz}, lead=${opts.leadMinutes}m, channel=${opts.channel})`,
  );
  if (posts.length === 0) {
    console.log("  nothing to schedule (no future game days).");
    return;
  }

  const failures: string[] = [];
  for (const post of posts) {
    console.log(`  • ${post.name}: fire ${post.at}  (first kickoff ${post.firstKickoff}, ${post.gameCount} game(s))`);
    if (opts.apply) {
      clearExisting(post.name); // step 6
      const created = runOpenclaw(addArgs(post, opts)); // step 7
      if (created.ok) {
        console.log("    created");
      } else {
        console.log(`    FAILED: ${created.output}`);
        failures.push(`${post.name}: ${created.output}`);
      }
    } else {
      console.log(`    would run: openclaw ${addArgs(post, opts).map((a) => (a.includes(" ") ? JSON.stringify(a) : a)).join(" ")}`);
    }
  }

  // Partial-failure report → admin DM only, never a league channel.
  if (failures.length > 0) {
    notifyAdmin(
      opts.errorTarget,
      `pregame-regenerator: ${failures.length}/${posts.length} post(s) failed to schedule:\n${failures.join("\n")}`,
    );
    process.exitCode = 1;
  }
}

const opts = parseOptions(process.argv.slice(2));
run(opts).catch((err) => {
  const msg = err?.message ?? String(err);
  console.error("pregame-regenerator failed:", msg);
  // Fatal error → admin DM only, never a league channel.
  notifyAdmin(opts.errorTarget, `pregame-regenerator crashed: ${msg}`);
  process.exitCode = 1;
});
