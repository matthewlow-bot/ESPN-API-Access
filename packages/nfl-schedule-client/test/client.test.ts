import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  NflScheduleClient,
  NflScheduleError,
  NflScheduleParseError,
  NflScheduleNetworkError,
  DEFAULT_RETRY,
} from "../dist/index.js";

function fixtureText(name: string): string {
  const url = new URL(`./fixtures/${name}`, import.meta.url);
  return readFileSync(fileURLToPath(url), "utf8");
}

interface FakeCall {
  url: string;
  headers: Record<string, string>;
}

/** Build a fake fetch that records calls and returns queued responses. */
function fakeFetch(
  handler: (call: FakeCall, n: number) => { status: number; body: string } | Error,
) {
  const calls: FakeCall[] = [];
  const impl = (url: string, init?: { headers?: Record<string, string> }) => {
    const call: FakeCall = { url, headers: init?.headers ?? {} };
    calls.push(call);
    const result = handler(call, calls.length);
    if (result instanceof Error) return Promise.reject(result);
    return Promise.resolve(new Response(result.body, { status: result.status }));
  };
  return { impl: impl as unknown as typeof fetch, calls };
}

test("getWeek: builds public scoreboard URL with week/year and seasontype=2 default; spoofed UA", async () => {
  const { impl, calls } = fakeFetch(() => ({ status: 200, body: fixtureText("scoreboard.json") }));
  const client = new NflScheduleClient({ fetchImpl: impl });
  const games = await client.getWeek({ week: 1, year: 2025 });

  assert.equal(games.length, 6);
  assert.equal(games[0]!.shortName, "DAL @ PHI");

  assert.match(calls[0]!.url, /site\.api\.espn\.com/);
  assert.match(calls[0]!.url, /\/football\/nfl\/scoreboard/);
  assert.match(calls[0]!.url, /week=1/);
  assert.match(calls[0]!.url, /year=2025/);
  assert.match(calls[0]!.url, /seasontype=2/); // regular season default
  assert.match(calls[0]!.headers["User-Agent"]!, /Chrome/);
  assert.equal(calls[0]!.headers["Accept"], "application/json");
});

test("getWeek: seasonType override is honored; omitting week/year omits those params", async () => {
  const { impl, calls } = fakeFetch(() => ({ status: 200, body: '{"events":[]}' }));
  const client = new NflScheduleClient({ fetchImpl: impl });
  const games = await client.getWeek({ seasonType: 3 });

  assert.deepEqual(games, []);
  assert.match(calls[0]!.url, /seasontype=3/);
  assert.doesNotMatch(calls[0]!.url, /week=/);
  assert.doesNotMatch(calls[0]!.url, /year=/);
});

test("403 edge block -> NflScheduleError (status 403), not retried by default classifier", async () => {
  const { impl, calls } = fakeFetch(() => ({
    status: 403,
    body: "<HTML><HEAD><TITLE>Access Denied</TITLE></HEAD></HTML>",
  }));
  const client = new NflScheduleClient({ fetchImpl: impl, retry: false });
  await assert.rejects(
    () => client.getWeek({ week: 1 }),
    (err: unknown) => {
      assert.ok(err instanceof NflScheduleError);
      assert.equal((err as NflScheduleError).status, 403);
      assert.equal((err as NflScheduleError).retriable, false);
      return true;
    },
  );
  assert.equal(calls.length, 1);
});

test("2xx non-JSON body -> NflScheduleParseError", async () => {
  const { impl } = fakeFetch(() => ({ status: 200, body: "<!DOCTYPE html><html>nope</html>" }));
  const client = new NflScheduleClient({ fetchImpl: impl, retry: false });
  await assert.rejects(() => client.getWeek(), NflScheduleParseError);
});

test("fetch throwing -> NflScheduleNetworkError", async () => {
  const { impl } = fakeFetch(() => new Error("ECONNRESET"));
  const client = new NflScheduleClient({ fetchImpl: impl, retry: false });
  await assert.rejects(() => client.getWeek(), NflScheduleNetworkError);
});

test("DEFAULT_RETRY.retryOn: network + 429 + 5xx retriable; 4xx and success not", () => {
  const { retryOn } = DEFAULT_RETRY;
  assert.equal(retryOn({ error: new Error("boom") }), true);
  assert.equal(retryOn({ status: 429 }), true);
  assert.equal(retryOn({ status: 503 }), true);
  assert.equal(retryOn({ status: 403 }), false);
  assert.equal(retryOn({ status: 200 }), false);
});

test("retry: a retriable 500 then success (backoff kept tiny)", async () => {
  const { impl, calls } = fakeFetch((_c, n) =>
    n === 1 ? { status: 500, body: "server error" } : { status: 200, body: '{"events":[]}' },
  );
  const client = new NflScheduleClient({
    fetchImpl: impl,
    retry: { maxRetries: 2, baseDelayMs: 1, maxDelayMs: 2 },
  });
  const games = await client.getWeek({ week: 1 });
  assert.deepEqual(games, []);
  assert.equal(calls.length, 2); // one retry
});
