/**
 * Serialises work per user, while staying concurrent across users.
 *
 * Copied from `packages/whatsapp-bot/src/queue.ts`, and needed here for the same
 * reason plus a sharper one: the sheet stores are read-modify-write, and a
 * Sheets round-trip is a few hundred milliseconds. Two taps in quick succession
 * would both read the same answers and one would be lost. The agent bot has no
 * equivalent because its file ledger writes settle in microseconds.
 */
export class UserQueue {
  private readonly chains = new Map<string, Promise<void>>();

  /**
   * Appends a task to this user's chain. Never throws and never rejects — these
   * run detached from the update that scheduled them, so an escaping error would
   * be an unhandled rejection.
   */
  run(userId: string, task: () => Promise<void>): void {
    const previous = this.chains.get(userId) ?? Promise.resolve();

    const next = previous
      .then(task)
      .catch((error: unknown) =>
        console.error(`[form] handler failed for ${userId}:`, error),
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
