// ---------------------------------------------------------------------------
// Cache collaborator (spec section 2.2).
//
// Caching is OPT-IN and pluggable. The library ships one in-memory
// implementation; a consumer can inject any `CacheStore` (e.g. a SQLite-backed
// one) instead. The library never persists — a cache is a disposable, TTL'd
// copy of a fetch result (decisions.md Q1).
// ---------------------------------------------------------------------------

export interface CacheEntry {
  value: unknown;
  /** Epoch millis after which the entry is stale. */
  expiresAt: number;
}

export interface CacheStore {
  get(key: string): CacheEntry | undefined | Promise<CacheEntry | undefined>;
  set(key: string, value: unknown, ttlMs: number): void | Promise<void>;
  delete?(key: string): void | Promise<void>;
  clear?(): void | Promise<void>;
}

/** Map + TTL, lazy eviction (expired entries are dropped on read). */
export class InMemoryCacheStore implements CacheStore {
  private readonly store = new Map<string, CacheEntry>();

  get(key: string): CacheEntry | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return entry;
  }

  set(key: string, value: unknown, ttlMs: number): void {
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}
