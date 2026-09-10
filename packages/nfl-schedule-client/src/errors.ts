// ---------------------------------------------------------------------------
// Error taxonomy (mirrors espn-fantasy-client's shape, minus the auth case —
// the public scoreboard API takes no cookies).
//
// `NflScheduleError` is the base; two subclasses distinguish the cases a
// consumer usually branches on: a 2xx body that isn't JSON, and a
// transport-level failure (fetch threw, or the request timed out / was aborted).
//
// NOTE: on a sandbox that ESPN's edge (Akamai) blocks, requests come back as
// HTTP 403 with an HTML "Access Denied" body — surfaced here as a plain
// `NflScheduleError` (status 403), NOT an auth error. See README.
// ---------------------------------------------------------------------------

export interface NflScheduleErrorInit {
  status?: number;
  url?: string;
  /** Truncated response body, for diagnostics. */
  body?: string;
  retriable?: boolean;
  /** Underlying cause (e.g. the fetch/abort error). */
  cause?: unknown;
}

export class NflScheduleError extends Error {
  readonly status?: number;
  readonly url?: string;
  readonly body?: string;
  readonly retriable: boolean;

  constructor(message: string, init: NflScheduleErrorInit = {}) {
    super(message, init.cause !== undefined ? { cause: init.cause } : undefined);
    this.name = new.target.name;
    this.status = init.status;
    this.url = init.url;
    this.body = init.body;
    this.retriable = init.retriable ?? false;
    // Restore prototype chain for instanceof across transpile targets.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** 2xx but the body was not JSON (e.g. an edge/CDN error page returning HTML). */
export class NflScheduleParseError extends NflScheduleError {}

/** fetch threw, or the request timed out / was aborted. */
export class NflScheduleNetworkError extends NflScheduleError {}
