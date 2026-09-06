// ---------------------------------------------------------------------------
// Rate limiter collaborator (spec section 2.2).
//
// Caps outbound request rate regardless of how eagerly a consumer polls. The
// default enforces both a max concurrency and a minimum interval between
// request *starts*. Injectable so multiple client instances could later share
// one limiter (protecting ESPN in aggregate).
// ---------------------------------------------------------------------------

export interface RateLimitOptions {
  /** Max requests in flight at once. Default 2. */
  maxConcurrent: number;
  /** Minimum gap between request starts, in ms. Default 250. */
  minIntervalMs: number;
}

export const DEFAULT_RATE_LIMIT_OPTIONS: RateLimitOptions = {
  maxConcurrent: 2,
  minIntervalMs: 250,
};

export interface RateLimiter {
  /** Run fn subject to the limiter's concurrency/interval policy. */
  schedule<T>(fn: () => Promise<T>): Promise<T>;
}

type Waiter = () => void;

export class DefaultRateLimiter implements RateLimiter {
  private readonly maxConcurrent: number;
  private readonly minIntervalMs: number;
  private active = 0;
  private lastStart = 0;
  private readonly queue: Waiter[] = [];

  constructor(options: Partial<RateLimitOptions> = {}) {
    this.maxConcurrent = options.maxConcurrent ?? DEFAULT_RATE_LIMIT_OPTIONS.maxConcurrent;
    this.minIntervalMs = options.minIntervalMs ?? DEFAULT_RATE_LIMIT_OPTIONS.minIntervalMs;
  }

  async schedule<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      await this.respectInterval();
      this.lastStart = Date.now();
      return await fn();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.maxConcurrent) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.queue.push(() => {
        this.active++;
        resolve();
      });
    });
  }

  private release(): void {
    this.active--;
    const next = this.queue.shift();
    if (next) next();
  }

  private async respectInterval(): Promise<void> {
    if (this.minIntervalMs <= 0) return;
    const wait = this.lastStart + this.minIntervalMs - Date.now();
    if (wait > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, wait));
    }
  }
}
