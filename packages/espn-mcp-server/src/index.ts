#!/usr/bin/env node
// ---------------------------------------------------------------------------
// espn-mcp-server (spec section 3).
//
// A thin stdio MCP server that constructs ONE EspnFantasyClient from env creds
// (bot resilience profile, cache ~120s) and exposes the spec 3.2 tools 1:1.
// It holds no ESPN logic — it forwards calls to the library and shapes output.
//
// TODO (spec section 5.1): OpenClaw transport is not yet confirmed. stdio is
// implemented here; if OpenClaw requires HTTP/SSE instead, swap the transport
// in main() once docs.openclaw.ai confirms the registration/launch model.
// ---------------------------------------------------------------------------

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  EspnFantasyClient,
  EspnApiError,
  type EspnCreds,
} from "espn-fantasy-client";

import { TOOLS, stripRaw } from "./tools.js";

const SERVER_NAME = "espn-mcp-server";
const SERVER_VERSION = "0.1.0";

/** Read ESPN creds from env once at startup. Returns null if incomplete. */
function loadCreds(): EspnCreds | null {
  const leagueId = process.env["ESPN_LEAGUE_ID"]?.trim();
  const season = Number(process.env["ESPN_SEASON"] ?? 2026);
  const espnS2 = process.env["ESPN_S2"]?.trim();
  const swid = process.env["ESPN_SWID"]?.trim();
  if (!leagueId || !espnS2 || !swid) return null;
  return { leagueId, season, espnS2, swid };
}

/** Build the one shared client using the bot resilience profile (spec 2.1/3.2). */
function makeClient(creds: EspnCreds): EspnFantasyClient {
  return new EspnFantasyClient({
    creds,
    retry: { maxRetries: 4, baseDelayMs: 500 },
    rateLimit: { maxConcurrent: 1, minIntervalMs: 750 },
    cache: { ttlMs: 120_000 },
  });
}

const NOT_CONFIGURED_MESSAGE =
  "ESPN creds not configured. Set ESPN_LEAGUE_ID, ESPN_SEASON, ESPN_S2, and ESPN_SWID in the server environment.";

async function main(): Promise<void> {
  const creds = loadCreds();
  const client = creds ? makeClient(creds) : null;

  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = TOOLS.find((t) => t.name === request.params.name);
    if (!tool) {
      return {
        isError: true,
        content: [{ type: "text", text: `Unknown tool: ${request.params.name}` }],
      };
    }
    if (!client) {
      return {
        isError: true,
        content: [{ type: "text", text: NOT_CONFIGURED_MESSAGE }],
      };
    }

    const args = (request.params.arguments ?? {}) as Record<string, unknown>;
    const includeRaw = args["includeRaw"] === true;

    try {
      const result = await tool.run(client, args);
      const shaped = includeRaw ? result : stripRaw(result);
      return {
        content: [{ type: "text", text: JSON.stringify(shaped, null, 2) }],
      };
    } catch (err) {
      const message =
        err instanceof EspnApiError
          ? `${err.name}${err.status ? ` (${err.status})` : ""}: ${err.message}`
          : `Unexpected error: ${(err as Error).message}`;
      return { isError: true, content: [{ type: "text", text: message }] };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Note: do NOT write to stdout — it carries the MCP protocol on stdio.
  console.error(
    `${SERVER_NAME} v${SERVER_VERSION} ready on stdio` +
      (client ? "" : " (creds NOT configured — tools will return an error)"),
  );
}

main().catch((err) => {
  console.error("Fatal error starting espn-mcp-server:", err);
  process.exit(1);
});
