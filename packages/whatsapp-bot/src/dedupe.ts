/**
 * Message-id dedupe for webhook retries.
 *
 * Meta re-delivers an event until it gets a 200, and will keep trying for days.
 * Without this the bot answers the same message repeatedly.
 *
 * `markIfNew` is deliberately SYNCHRONOUS. Making it async — file-backed,
 * database-backed — reopens a check-then-set race between two concurrent
 * deliveries of the same id, which is the exact bug it exists to prevent.
 * Because it is therefore in-memory only, it resets on restart; the staleness
 * filter in the server is the restart-proof second line of defence.
 */
export class MessageDedupe {
  private readonly seen = new Map<string, number>();

  constructor(
    private readonly ttlMs = 10 * 60_000,
    private readonly maxEntries = 5_000,
  ) {}

  /** Records the id and returns true the first time it is seen. */
  markIfNew(messageId: string): boolean {
    const now = Date.now();
    const expiresAt = this.seen.get(messageId);
    if (expiresAt !== undefined && expiresAt > now) return false;

    this.seen.set(messageId, now + this.ttlMs);
    if (this.seen.size > this.maxEntries) this.evictOldest();
    return true;
  }

  /** Map preserves insertion order, so the first key is the oldest. */
  private evictOldest(): void {
    const oldest = this.seen.keys().next();
    if (!oldest.done) this.seen.delete(oldest.value);
  }
}
