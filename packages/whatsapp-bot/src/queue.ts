/**
 * Serialises work per user, while staying concurrent across users.
 *
 * Two things need this. First, the onboarding stores are read-modify-write: two
 * messages from one user in flight at once would both read the same step and
 * one answer would be lost. Second, the Cloud API does not guarantee ordering
 * across concurrent requests, so a two-message reply (acknowledgement, then the
 * next question) must be awaited in order or it can arrive backwards.
 */
export class UserQueue {
  private readonly chains = new Map<string, Promise<void>>();

  /**
   * Appends a task to this user's chain. Never throws and never rejects — these
   * run detached from the request that scheduled them, so an escaping error
   * would be an unhandled rejection.
   */
  run(userId: string, task: () => Promise<void>): void {
    const previous = this.chains.get(userId) ?? Promise.resolve();

    const next = previous
      .then(task)
      .catch((error: unknown) =>
        console.error(`[whatsapp] handler failed for ${userId}:`, error),
      );

    this.chains.set(userId, next);

    // Drop the chain once it drains, so the map doesn't grow with every user.
    void next.finally(() => {
      if (this.chains.get(userId) === next) this.chains.delete(userId);
    });
  }

  /** Resolves once all currently-queued work has finished. Used by tests. */
  async drain(): Promise<void> {
    while (this.chains.size > 0) {
      await Promise.all([...this.chains.values()]);
    }
  }
}
