import { getPool } from "./db.ts";
import type { MessageDirection } from "./types.ts";

/**
 * Logs one WhatsApp message. `wa_message_id` is unique — a retried webhook
 * delivery that somehow reached here twice (dedupe.ts should already have
 * caught it) writes once, not twice.
 */
export async function logMessage(
  candidateId: string,
  waMessageId: string,
  direction: MessageDirection,
  body: string | null,
): Promise<void> {
  await getPool().query(
    `INSERT INTO messages (candidate_id, wa_message_id, direction, body)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (wa_message_id) DO NOTHING`,
    [candidateId, waMessageId, direction, body],
  );
}
