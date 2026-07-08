/**
 * Cloudflare Worker runtime surface. We hand-declare the minimal slices of the
 * Workers types we actually use, so the monorepo's `tsc --noEmit` needs no extra
 * `@cloudflare/workers-types` wiring. Swap for the official types later if desired.
 */

/** The subset of Cloudflare KV we rely on for the session buffer. */
export interface KvNamespace {
  get(key: string): Promise<string | null>;
  put(
    key: string,
    value: string,
    options?: { expirationTtl?: number },
  ): Promise<void>;
  delete(key: string): Promise<void>;
  list(options?: {
    prefix?: string;
    cursor?: string;
    limit?: number;
  }): Promise<{
    keys: { name: string }[];
    list_complete: boolean;
    cursor?: string;
  }>;
}

/**
 * Worker environment: secrets + vars (validated by @calebx/config) plus bindings.
 * The index signature lets @calebx/config's `loadConfig(env)` read string secrets;
 * `SESSIONS` is the typed KV binding.
 */
export interface Env {
  SESSIONS: KvNamespace;
  [key: string]: unknown;
}

/** Minimal ExecutionContext — only `waitUntil` is used (post-response work). */
export interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

/** Cron trigger event passed to the scheduled() handler. */
export interface ScheduledEvent {
  cron: string;
  scheduledTime: number;
}
