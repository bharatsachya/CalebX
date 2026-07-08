import { run } from "@calebx/db";

/** A user's consent decision for data processing. */
export type ConsentStatus = "granted" | "declined" | "unknown";

/**
 * Port for persisting a user's consent decision.
 *
 * Checked before ANY message content is processed. Backed by the User node in Neo4j
 * (property `consent_status`), mirrored to `consent_granted` which the matchmaking
 * query filters on. The bot depends on this interface, not the concrete class.
 */
export interface ConsentStore {
  /** Returns the stored decision, or "unknown" if the user has never been asked. */
  get(telegramId: number): Promise<ConsentStatus>;
  /** Records a decision. */
  set(telegramId: number, status: ConsentStatus): Promise<void>;
  /** Erases the stored decision (used by /forget). */
  delete(telegramId: number): Promise<void>;
}

export class Neo4jConsentStore implements ConsentStore {
  async get(telegramId: number): Promise<ConsentStatus> {
    const result = await run(
      `MATCH (u:User { telegram_id: $telegramId }) RETURN u.consent_status AS status`,
      { telegramId },
    );
    const status = result.records[0]?.get("status");
    return status === "granted" || status === "declined" ? status : "unknown";
  }

  async set(telegramId: number, status: ConsentStatus): Promise<void> {
    await run(
      `MERGE (u:User { telegram_id: $telegramId })
       ON CREATE SET u.created_at = $now
       SET u.consent_status = $status,
           u.consent_granted = $granted,
           u.last_active = $now`,
      {
        telegramId,
        status,
        granted: status === "granted",
        now: Date.now(),
      },
    );
  }

  async delete(telegramId: number): Promise<void> {
    await run(
      `MATCH (u:User { telegram_id: $telegramId })
       REMOVE u.consent_status
       SET u.consent_granted = false`,
      { telegramId },
    );
  }
}
