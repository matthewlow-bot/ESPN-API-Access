// ---------------------------------------------------------------------------
// Credential parsing for the MCP server.
//
// Env-parsing is a CONSUMER concern (the library takes creds as constructor
// args and never reads env), so it lives here, not in espn-fantasy-client.
//
// This exists because the #1 real-world failure is a human pasting the cookie
// as "NAME=value" (e.g. ESPN_S2=AEC... / ESPN_SWID={...}). A bare .trim() then
// forwards `espn_s2=ESPN_S2=AEC...` to ESPN, which returns an opaque 401 that is
// indistinguishable from an expired/wrong-league cookie. We sanitize the obvious
// paste mistakes and validate shape up front, returning an ACTIONABLE message
// instead of letting garbage reach ESPN.
// ---------------------------------------------------------------------------

import type { EspnCreds } from "espn-fantasy-client";

export type CredsResult =
  | { ok: true; creds: EspnCreds; warnings: string[] }
  | { ok: false; kind: "missing" | "malformed"; message: string };

export interface EnvLike {
  [key: string]: string | undefined;
}

/** A SWID is a GUID in braces: {8-4-4-4-12} hex. */
const SWID_GUID = /^\{[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\}$/;

/**
 * Strip a stray leading "NAME=" prefix (any of `names`, case-insensitive) that a
 * user pastes by accident. Returns the cleaned value and whether it changed.
 */
function stripKeyPrefix(
  value: string,
  names: string[],
): { value: string; stripped: boolean } {
  const lower = value.toLowerCase();
  for (const name of names) {
    const prefix = `${name.toLowerCase()}=`;
    if (lower.startsWith(prefix)) {
      return { value: value.slice(prefix.length).trim(), stripped: true };
    }
  }
  return { value, stripped: false };
}

/** True when the value still looks like an un-stripped "NAME=value" residue. */
function looksLikeNameValue(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*=/.test(value);
}

/** Ensure a SWID is wrapped in a single pair of braces. */
function braceWrap(swid: string): string {
  const bare = swid.replace(/^\{+/, "").replace(/\}+$/, "");
  return `{${bare}}`;
}

/**
 * Parse and validate ESPN creds from an env-like object. `now` is injectable for
 * deterministic tests. On success returns normalized creds (SWID brace-wrapped,
 * season defaulted to the current year when absent); on failure returns a
 * `missing` or `malformed` result carrying a human-actionable message.
 */
export function parseEspnCreds(env: EnvLike, now: Date = new Date()): CredsResult {
  const warnings: string[] = [];

  const league = stripKeyPrefix((env["ESPN_LEAGUE_ID"] ?? "").trim(), [
    "ESPN_LEAGUE_ID",
    "leagueId",
  ]);
  const s2 = stripKeyPrefix((env["ESPN_S2"] ?? "").trim(), [
    "ESPN_S2",
    "espn_s2",
    "s2",
  ]);
  const swidRaw = stripKeyPrefix((env["ESPN_SWID"] ?? "").trim(), [
    "ESPN_SWID",
    "SWID",
    "swid",
  ]);
  if (league.stripped) warnings.push("Stripped a stray key= prefix from ESPN_LEAGUE_ID.");
  if (s2.stripped) warnings.push("Stripped a stray key= prefix from ESPN_S2.");
  if (swidRaw.stripped) warnings.push("Stripped a stray key= prefix from ESPN_SWID.");

  const leagueId = league.value;
  const espnS2 = s2.value;

  // --- required-field gate (includes season implicitly via validation below) ---
  const missing: string[] = [];
  if (!leagueId) missing.push("ESPN_LEAGUE_ID");
  if (!espnS2) missing.push("ESPN_S2");
  if (!swidRaw.value) missing.push("ESPN_SWID");
  if (missing.length > 0) {
    return {
      ok: false,
      kind: "missing",
      message:
        `ESPN creds not configured — missing: ${missing.join(", ")}. ` +
        "Set ESPN_LEAGUE_ID, ESPN_SEASON, ESPN_S2, and ESPN_SWID in the server environment.",
    };
  }

  // --- shape validation: catch malformed values before they reach ESPN ---
  if (looksLikeNameValue(espnS2)) {
    const upTo = espnS2.slice(0, espnS2.indexOf("=") + 1);
    return {
      ok: false,
      kind: "malformed",
      message: `ESPN_S2 still looks like "NAME=value" (starts with "${upTo}"). Paste only the cookie VALUE, not "NAME=value".`,
    };
  }

  const swid = braceWrap(swidRaw.value);
  if (!SWID_GUID.test(swid)) {
    return {
      ok: false,
      kind: "malformed",
      message:
        `ESPN_SWID doesn't look like a GUID {8-4-4-4-12}. Did you paste "NAME=value" instead of just the value, or copy the wrong field? Got: ${swidRaw.value}`,
    };
  }

  // --- season: default to the current calendar year; validate an explicit value ---
  const seasonRaw = stripKeyPrefix((env["ESPN_SEASON"] ?? "").trim(), ["ESPN_SEASON"]).value;
  let season: number;
  if (seasonRaw === "") {
    season = now.getFullYear();
  } else {
    season = Number(seasonRaw);
    const maxYear = now.getFullYear() + 1;
    if (!Number.isInteger(season) || season < 2000 || season > maxYear) {
      return {
        ok: false,
        kind: "malformed",
        message: `ESPN_SEASON must be a 4-digit year between 2000 and ${maxYear} (got "${seasonRaw}").`,
      };
    }
  }

  return { ok: true, creds: { leagueId, season, espnS2, swid }, warnings };
}
