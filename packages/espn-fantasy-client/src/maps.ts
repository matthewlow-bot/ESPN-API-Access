// ---------------------------------------------------------------------------
// Id maps and constants (spec section 2.7).
//
// Carried over verbatim from the draft tool's server/espn.ts. These drift when
// the NFL/ESPN change (e.g. relocations) and are a known maintenance point.
// ---------------------------------------------------------------------------

import type { Position } from "./types.js";

export const ESPN_READ_HOST = "https://lm-api-reads.fantasy.espn.com";

/**
 * ESPN's crowd-sourced auction values are calibrated to their default $200
 * budget. Exported for documentation only — the library does NOT scale
 * (that is a consumer concern; spec section 2.2).
 */
export const ESPN_DEFAULT_AUCTION_BUDGET = 200;

export const POSITION_BY_ID: Record<number, Position> = {
  1: "QB",
  2: "RB",
  3: "WR",
  4: "TE",
  5: "K",
  16: "DST",
};

/** Convenience inverse of POSITION_BY_ID for building slot filters. */
export const ID_BY_POSITION: Record<Position, number> = {
  QB: 1,
  RB: 2,
  WR: 3,
  TE: 4,
  K: 5,
  DST: 16,
};

export const PRO_TEAM_ABBR: Record<number, string> = {
  0: "FA",
  1: "ATL",
  2: "BUF",
  3: "CHI",
  4: "CIN",
  5: "CLE",
  6: "DAL",
  7: "DEN",
  8: "DET",
  9: "GB",
  10: "TEN",
  11: "IND",
  12: "KC",
  13: "LV",
  14: "LAR",
  15: "MIA",
  16: "MIN",
  17: "NE",
  18: "NO",
  19: "NYG",
  20: "NYJ",
  21: "PHI",
  22: "ARI",
  23: "PIT",
  24: "LAC",
  25: "SF",
  26: "SEA",
  27: "TB",
  28: "WSH",
  29: "CAR",
  30: "JAX",
  33: "BAL",
  34: "HOU",
};
