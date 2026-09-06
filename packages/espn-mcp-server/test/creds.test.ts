import test from "node:test";
import assert from "node:assert/strict";

import { parseEspnCreds } from "../dist/creds.js";

const NOW = new Date("2026-09-05T00:00:00Z"); // deterministic "current year" = 2026
const GOOD_SWID = "{34B09A65-6C3F-4CB9-9144-653FB377CAD6}";
const GOOD_S2 = "AECRfMQxRvf%2FXfo2B21Mx%2BmcV9fgy2UIBPOR95CH3Lw";

test("valid creds parse and normalize", () => {
  const r = parseEspnCreds(
    { ESPN_LEAGUE_ID: "503578", ESPN_SEASON: "2026", ESPN_S2: GOOD_S2, ESPN_SWID: GOOD_SWID },
    NOW,
  );
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.creds, {
    leagueId: "503578",
    season: 2026,
    espnS2: GOOD_S2,
    swid: GOOD_SWID,
  });
  assert.equal(r.warnings.length, 0);
});

test("the doubled-prefix paste bug is auto-corrected (NAME=value pasted for BOTH cookies)", () => {
  // This is the exact mistake that produced the opaque 401 in production.
  const r = parseEspnCreds(
    {
      ESPN_LEAGUE_ID: "503578",
      ESPN_S2: `ESPN_S2=${GOOD_S2}`,
      ESPN_SWID: `ESPN_SWID=${GOOD_SWID}`,
    },
    NOW,
  );
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.creds.espnS2, GOOD_S2); // prefix stripped
  assert.equal(r.creds.swid, GOOD_SWID);
  assert.ok(r.warnings.some((w) => /ESPN_S2/.test(w)));
  assert.ok(r.warnings.some((w) => /ESPN_SWID/.test(w)));
});

test("bare SWID (no braces) gets brace-wrapped", () => {
  const r = parseEspnCreds(
    { ESPN_LEAGUE_ID: "1", ESPN_S2: GOOD_S2, ESPN_SWID: "34B09A65-6C3F-4CB9-9144-653FB377CAD6" },
    NOW,
  );
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.creds.swid, GOOD_SWID);
});

test("missing cookie => kind:missing, names the vars", () => {
  const r = parseEspnCreds({ ESPN_LEAGUE_ID: "503578", ESPN_S2: GOOD_S2 }, NOW);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.kind, "missing");
  assert.match(r.message, /ESPN_SWID/);
});

test("malformed SWID (not a GUID) => kind:malformed, actionable message", () => {
  const r = parseEspnCreds(
    { ESPN_LEAGUE_ID: "1", ESPN_S2: GOOD_S2, ESPN_SWID: "not-a-guid" },
    NOW,
  );
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.kind, "malformed");
  assert.match(r.message, /GUID/);
});

test("residual NAME=value in S2 (unknown prefix) => malformed, not forwarded", () => {
  const r = parseEspnCreds(
    { ESPN_LEAGUE_ID: "1", ESPN_S2: `SWID2=${GOOD_S2}`, ESPN_SWID: GOOD_SWID },
    NOW,
  );
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.kind, "malformed");
  assert.match(r.message, /NAME=value/);
});

test("bad ESPN_SEASON (non-numeric) => malformed", () => {
  const r = parseEspnCreds(
    { ESPN_LEAGUE_ID: "1", ESPN_S2: GOOD_S2, ESPN_SWID: GOOD_SWID, ESPN_SEASON: "twentytwentysix" },
    NOW,
  );
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.kind, "malformed");
  assert.match(r.message, /year/);
});

test("out-of-range ESPN_SEASON => malformed", () => {
  const r = parseEspnCreds(
    { ESPN_LEAGUE_ID: "1", ESPN_S2: GOOD_S2, ESPN_SWID: GOOD_SWID, ESPN_SEASON: "1999" },
    NOW,
  );
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.kind, "malformed");
});

test("absent ESPN_SEASON defaults to the current calendar year (no magic literal)", () => {
  const r = parseEspnCreds(
    { ESPN_LEAGUE_ID: "1", ESPN_S2: GOOD_S2, ESPN_SWID: GOOD_SWID },
    new Date("2027-01-15T00:00:00Z"),
  );
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.creds.season, 2027);
});
