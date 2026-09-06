// ---------------------------------------------------------------------------
// Error taxonomy (spec section 2.3).
//
// Every failure surfaced by the client is one of these. `EspnApiError` is the
// base; the three subclasses distinguish the cases a consumer usually wants to
// branch on: bad/expired cookies (401), a 2xx body that isn't JSON (an auth
// redirect to HTML), and a transport-level failure (fetch threw, or timeout).
// ---------------------------------------------------------------------------

export interface EspnApiErrorInit {
  status?: number;
  url?: string;
  /** Truncated response body, for diagnostics. */
  body?: string;
  retriable?: boolean;
  /** Underlying cause (e.g. the fetch/abort error). */
  cause?: unknown;
}

export class EspnApiError extends Error {
  readonly status?: number;
  readonly url?: string;
  readonly body?: string;
  readonly retriable: boolean;

  constructor(message: string, init: EspnApiErrorInit = {}) {
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

/** 401 — espn_s2 / SWID missing, expired, or not for this league. */
export class EspnAuthError extends EspnApiError {}

/** 2xx but the body was not JSON (typically an auth redirect returning HTML). */
export class EspnParseError extends EspnApiError {}

/** fetch threw, or the request timed out / was aborted. */
export class EspnNetworkError extends EspnApiError {}
