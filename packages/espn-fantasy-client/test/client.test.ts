import test from "node:test";
import assert from "node:assert/strict";

import {
  EspnFantasyClient,
  EspnAuthError,
  EspnParseError,
  EspnNetworkError,
  EspnApiError,
  normalizeSwid,
  DEFAULT_RETRY,
  type EspnCreds,
} from "../dist/index.js";

const CREDS: EspnCreds = {
  leagueId: "12345",
  season: 2026,
  espnS2: "S2COOKIE",
  swid: "ABC-DEF", // deliberately unbraced
};

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

test("normalizeSwid wraps only when needed", () => {
  assert.equal(normalizeSwid("ABC-DEF"), "{ABC-DEF}");
  assert.equal(normalizeSwid("{ABC-DEF}"), "{ABC-DEF}");
});

test("checkConnection: hits mSettings, sends brace-normalized SWID cookie + spoofed UA", async () => {
  const { impl, calls } = fakeFetch(() => ({
    status: 200,
    body: JSON.stringify({ settings: { name: "Cool People League" } }),
  }));
  const client = new EspnFantasyClient({ creds: CREDS, fetchImpl: impl });
  const id = await client.checkConnection();
  assert.equal(id.name, "Cool People League");
  assert.equal(id.leagueId, "12345");
  assert.equal(id.season, 2026);

  assert.match(calls[0]!.url, /view=mSettings/);
  assert.match(calls[0]!.headers["Cookie"]!, /SWID=\{ABC-DEF\}/);
  assert.match(calls[0]!.headers["Cookie"]!, /espn_s2=S2COOKIE/);
  assert.match(calls[0]!.headers["User-Agent"]!, /Chrome/);
  assert.equal(calls[0]!.headers["Accept"], "application/json");
});

test("401 -> EspnAuthError with preserved message; not retried", async () => {
  const { impl, calls } = fakeFetch(() => ({ status: 401, body: "<html>login</html>" }));
  const client = new EspnFantasyClient({ creds: CREDS, fetchImpl: impl, retry: false });
  await assert.rejects(
    () => client.getTeams(),
    (err: unknown) => {
      assert.ok(err instanceof EspnAuthError);
      assert.equal((err as EspnAuthError).status, 401);
      assert.match((err as EspnAuthError).message, /espn_s2 \/ SWID/);
      return true;
    },
  );
  assert.equal(calls.length, 1); // 401 is non-retriable
});

test("2xx non-JSON body -> EspnParseError", async () => {
  const { impl } = fakeFetch(() => ({ status: 200, body: "<!DOCTYPE html><html>redirect</html>" }));
  const client = new EspnFantasyClient({ creds: CREDS, fetchImpl: impl, retry: false });
  await assert.rejects(() => client.getSettings(), EspnParseError);
});

test("fetch throwing -> EspnNetworkError", async () => {
  const { impl } = fakeFetch(() => new Error("ECONNRESET"));
  const client = new EspnFantasyClient({ creds: CREDS, fetchImpl: impl, retry: false });
  await assert.rejects(() => client.getTeams(), EspnNetworkError);
});

test("non-401 error status -> EspnApiError (no 502 remap)", async () => {
  const { impl } = fakeFetch(() => ({ status: 404, body: "nope" }));
  const client = new EspnFantasyClient({ creds: CREDS, fetchImpl: impl, retry: false });
  await assert.rejects(
    () => client.getTeams(),
    (err: unknown) => {
      assert.ok(err instanceof EspnApiError);
      assert.equal((err as EspnApiError).status, 404);
      assert.ok(!(err instanceof EspnAuthError));
      return true;
    },
  );
});

test("DEFAULT_RETRY.retryOn: network + 429 + 5xx retriable; 4xx and success not", () => {
  const { retryOn } = DEFAULT_RETRY;
  assert.equal(retryOn({ error: new Error("boom") }), true);
  assert.equal(retryOn({ status: 429 }), true);
  assert.equal(retryOn({ status: 500 }), true);
  assert.equal(retryOn({ status: 503 }), true);
  assert.equal(retryOn({ status: 404 }), false);
  assert.equal(retryOn({ status: 200 }), false);
  assert.equal(retryOn({}), false);
});

test("retry: a retriable 500 then success (backoff kept tiny)", async () => {
  const { impl, calls } = fakeFetch((_c, n) =>
    n === 1
      ? { status: 500, body: "server error" }
      : { status: 200, body: JSON.stringify({ teams: [{ id: 1, name: "A", abbrev: "A" }] }) },
  );
  const client = new EspnFantasyClient({
    creds: CREDS,
    fetchImpl: impl,
    retry: { maxRetries: 2, baseDelayMs: 1, maxDelayMs: 2 },
    rateLimit: false,
  });
  const teams = await client.getTeams();
  assert.equal(teams.length, 1);
  assert.equal(calls.length, 2); // one retry
});

test("getPlayers: internal pagination flattens pages and stops on a short page", async () => {
  const page = (ids: number[]) => ({
    status: 200,
    body: JSON.stringify({
      players: ids.map((id) => ({
        player: { id, fullName: `P${id}`, defaultPositionId: 2, proTeamId: 1 },
      })),
    }),
  });
  const { impl, calls } = fakeFetch((call, n) => {
    // assert the X-Fantasy-Filter is present and carries a window
    assert.ok(call.headers["X-Fantasy-Filter"]);
    if (n === 1) return page([1, 2]); // full page
    if (n === 2) return page([3, 4]); // full page
    return page([5]); // short page => stop
  });
  const client = new EspnFantasyClient({ creds: CREDS, fetchImpl: impl, rateLimit: false });
  const players = await client.getPlayers({ limit: 10, pageSize: 2 });
  assert.deepEqual(players.map((p) => p.id), [1, 2, 3, 4, 5]);
  assert.equal(calls.length, 3);
});

test("getPlayers: respects total limit across pages", async () => {
  const { impl } = fakeFetch(() => ({
    status: 200,
    body: JSON.stringify({
      players: [1, 2, 3].map((id) => ({
        player: { id, fullName: `P${id}`, defaultPositionId: 2, proTeamId: 1 },
      })),
    }),
  }));
  const client = new EspnFantasyClient({ creds: CREDS, fetchImpl: impl, rateLimit: false });
  const players = await client.getPlayers({ limit: 2, pageSize: 3 });
  assert.equal(players.length, 2); // sliced to the requested limit
});

test("cache: a hit avoids a second fetch; forceRefresh bypasses", async () => {
  let served = 0;
  const { impl } = fakeFetch(() => {
    served++;
    return { status: 200, body: JSON.stringify({ teams: [{ id: served, name: "T", abbrev: "T" }] }) };
  });
  const client = new EspnFantasyClient({
    creds: CREDS,
    fetchImpl: impl,
    cache: { ttlMs: 60_000 },
    rateLimit: false,
  });
  const a = await client.getTeams();
  const b = await client.getTeams();
  assert.equal(served, 1); // second call served from cache
  assert.equal(a[0]!.id, b[0]!.id);

  const c = await client.getTeams({ forceRefresh: true });
  assert.equal(served, 2); // forceRefresh went to network
  assert.equal(c[0]!.id, 2);
});

test("getPlayersByIds: empty ids short-circuits without a fetch", async () => {
  const { impl, calls } = fakeFetch(() => ({ status: 200, body: "{}" }));
  const client = new EspnFantasyClient({ creds: CREDS, fetchImpl: impl });
  const out = await client.getPlayersByIds([]);
  assert.deepEqual(out, []);
  assert.equal(calls.length, 0);
});
