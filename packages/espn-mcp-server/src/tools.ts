// ---------------------------------------------------------------------------
// Tool table (spec section 3.2).
//
// One entry per library read method, 1:1 with the spec table. Each tool takes
// an optional `includeRaw` flag; by default the bulky `raw` field is stripped
// from output to keep responses small. The library's raw() escape hatch is NOT
// exposed here (spec section 3.3).
// ---------------------------------------------------------------------------

import type {
  EspnFantasyClient,
  Position,
  TransactionType,
} from "espn-fantasy-client";

/** Minimal JSON Schema object (kept as a plain object — no zod dependency). */
export type JsonSchema = {
  type: "object";
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
};

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  /** Run the tool. `args` is the already-parsed input object. */
  run(client: EspnFantasyClient, args: Record<string, unknown>): Promise<unknown>;
}

const includeRawProp = {
  includeRaw: {
    type: "boolean",
    description: "Include ESPN's original `raw` node in the output (omitted by default).",
  },
};

const POSITIONS: Position[] = ["QB", "RB", "WR", "TE", "K", "DST"];

function asPositions(value: unknown): Position[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value.filter((v): v is Position =>
    POSITIONS.includes(v as Position),
  );
  return out.length ? out : undefined;
}

function asNumberArray(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value.filter((v): v is number => typeof v === "number");
  return out.length ? out : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function asStringArray(value: unknown): TransactionType[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value.filter((v): v is string => typeof v === "string");
  return out.length ? out : undefined;
}

export const TOOLS: ToolDef[] = [
  {
    name: "espn_check_connection",
    description:
      "Cheap auth + connectivity probe. Returns the league identity (id, season, name).",
    inputSchema: { type: "object", properties: { ...includeRawProp } },
    run: (client) => client.checkConnection(),
  },
  {
    name: "espn_get_settings",
    description: "League settings: size, scoring type, draft type/budget/order, roster slots.",
    inputSchema: { type: "object", properties: { ...includeRawProp } },
    run: (client) => client.getSettings(),
  },
  {
    name: "espn_get_teams",
    description: "All teams with resolved names, abbreviations, and owners when present.",
    inputSchema: { type: "object", properties: { ...includeRawProp } },
    run: (client) => client.getTeams(),
  },
  {
    name: "espn_get_draft",
    description:
      "Draft board / picks (keeper and invalid picks excluded, sorted by overall pick).",
    inputSchema: { type: "object", properties: { ...includeRawProp } },
    run: (client) => client.getDraft(),
  },
  {
    name: "espn_get_players",
    description:
      "The draftable player universe with average auction values. Paginated internally.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Total players wanted (default 500)." },
        positions: {
          type: "array",
          items: { type: "string", enum: POSITIONS },
          description: "Filter to these positions.",
        },
        sort: {
          type: "string",
          enum: ["draftRank", "percentOwned", "auctionValue"],
          description: "Sort key (default draftRank).",
        },
        sortAsc: { type: "boolean" },
        ...includeRawProp,
      },
    },
    run: (client, args) =>
      client.getPlayers({
        limit: asNumber(args["limit"]),
        positions: asPositions(args["positions"]),
        sort: args["sort"] as "draftRank" | "percentOwned" | "auctionValue" | undefined,
        sortAsc: typeof args["sortAsc"] === "boolean" ? args["sortAsc"] : undefined,
      }),
  },
  {
    name: "espn_get_players_by_ids",
    description: "Named info for specific ESPN player ids.",
    inputSchema: {
      type: "object",
      properties: {
        ids: {
          type: "array",
          items: { type: "number" },
          description: "ESPN player ids.",
        },
        ...includeRawProp,
      },
      required: ["ids"],
    },
    run: (client, args) => client.getPlayersByIds(asNumberArray(args["ids"]) ?? []),
  },
  {
    name: "espn_get_rosters",
    description: "Current roster / lineup-slot assignments for every team.",
    inputSchema: {
      type: "object",
      properties: {
        scoringPeriodId: { type: "number", description: "Week; omit for current." },
        ...includeRawProp,
      },
    },
    run: (client, args) =>
      client.getRosters({ scoringPeriodId: asNumber(args["scoringPeriodId"]) }),
  },
  {
    name: "espn_get_matchups",
    description: "Head-to-head schedule / results. Optionally filtered to one matchup period.",
    inputSchema: {
      type: "object",
      properties: {
        matchupPeriodId: { type: "number" },
        ...includeRawProp,
      },
    },
    run: (client, args) =>
      client.getMatchups({ matchupPeriodId: asNumber(args["matchupPeriodId"]) }),
  },
  {
    name: "espn_get_scoreboard",
    description: "Weekly scores for a scoring period.",
    inputSchema: {
      type: "object",
      properties: {
        scoringPeriodId: { type: "number" },
        ...includeRawProp,
      },
    },
    run: (client, args) =>
      client.getScoreboard({ scoringPeriodId: asNumber(args["scoringPeriodId"]) }),
  },
  {
    name: "espn_get_standings",
    description: "Standings: wins/losses/ties, points for/against, rank.",
    inputSchema: { type: "object", properties: { ...includeRawProp } },
    run: (client) => client.getStandings(),
  },
  {
    name: "espn_get_transactions",
    description: "Waiver / free-agency / trade activity, optionally filtered.",
    inputSchema: {
      type: "object",
      properties: {
        types: {
          type: "array",
          items: { type: "string" },
          description: "ESPN transaction type strings (e.g. WAIVER, FREEAGENT, TRADE_ACCEPTED).",
        },
        teamId: { type: "number" },
        scoringPeriodId: { type: "number" },
        ...includeRawProp,
      },
    },
    run: (client, args) =>
      client.getTransactions({
        types: asStringArray(args["types"]),
        teamId: asNumber(args["teamId"]),
        scoringPeriodId: asNumber(args["scoringPeriodId"]),
      }),
  },
  {
    name: "espn_get_player_stats",
    description: "Actual + projected weekly points for players.",
    inputSchema: {
      type: "object",
      properties: {
        playerIds: { type: "array", items: { type: "number" } },
        scoringPeriodId: { type: "number", description: "Week; omit for season totals." },
        ...includeRawProp,
      },
    },
    run: (client, args) =>
      client.getPlayerStats({
        playerIds: asNumberArray(args["playerIds"]),
        scoringPeriodId: asNumber(args["scoringPeriodId"]),
      }),
  },
];

/** Recursively drop every `raw` property (used unless includeRaw is set). */
export function stripRaw(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripRaw);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (key === "raw") continue;
      out[key] = stripRaw(v);
    }
    return out;
  }
  return value;
}
