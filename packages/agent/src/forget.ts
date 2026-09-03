import { withSpan } from "@calebx/trace";

/**
 * `/forget`, across every store.
 *
 * The user is told their data is gone, so this must not half-succeed silently.
 * Each store is attempted independently — a mem0 outage should not prevent the
 * graph and Postgres wipes — and the report says exactly what failed so the
 * caller can tell the user the truth rather than a comfortable summary.
 */

export type ForgetStore =
  "memories" | "graph" | "modeState" | "reviewTasks" | "consent" | "onboarding";

export interface ForgetOutcome {
  store: ForgetStore;
  ok: boolean;
  error?: string;
}

export interface ForgetReport {
  ok: boolean;
  outcomes: ForgetOutcome[];
  failed: ForgetStore[];
}

export type ForgetTargets = Partial<Record<ForgetStore, () => Promise<void>>>;

/** Fixed order, so a partial failure is reproducible and comparable across runs. */
const ORDER: readonly ForgetStore[] = [
  "memories",
  "graph",
  "modeState",
  "reviewTasks",
  "consent",
  "onboarding",
];

export async function forgetEverything(
  targets: ForgetTargets,
): Promise<ForgetReport> {
  return withSpan("forget.all", { kind: "internal" }, async (span) => {
    const outcomes: ForgetOutcome[] = [];

    for (const store of ORDER) {
      const erase = targets[store];
      if (!erase) continue;
      try {
        await erase();
        outcomes.push({ store, ok: true });
      } catch (error) {
        outcomes.push({
          store,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const failed = outcomes.filter((o) => !o.ok).map((o) => o.store);
    span.setAttributes({
      storeCount: outcomes.length,
      failedCount: failed.length,
    });
    return { ok: failed.length === 0, outcomes, failed };
  });
}
