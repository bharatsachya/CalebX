/**
 * Structured observability and audit logging for form-bot.
 *
 * Implements security-compliant event logging with masked identifiers.
 * Never logs raw phone numbers, full names, private answers, or credentials.
 */

import { logger } from "@calebx/logger";
import { maskPhone } from "@calebx/channel";

export type AuditEventType =
  | "bot_started"
  | "consent_granted"
  | "consent_declined"
  | "contact_received"
  | "untrusted_contact_rejected"
  | "phone_match_success"
  | "phone_match_not_found"
  | "phone_match_ambiguous"
  | "telegram_identity_conflict"
  | "profile_linked"
  | "profile_completion_started"
  | "profile_completed"
  | "profile_resumed"
  | "sheets_write_failed"
  | "user_forgotten";

export interface AuditEventPayload {
  telegramUserId?: string;
  canonicalUserId?: string;
  phone?: string;
  count?: number;
  reason?: string;
  fieldId?: string;
  error?: unknown;
  [key: string]: unknown;
}

export function logAuditEvent(
  event: AuditEventType,
  payload: AuditEventPayload = {},
): void {
  const safePayload: Record<string, unknown> = {
    event,
    timestamp: new Date().toISOString(),
  };

  if (payload.telegramUserId)
    safePayload.telegramUserId = payload.telegramUserId;
  if (payload.canonicalUserId)
    safePayload.canonicalUserId = payload.canonicalUserId;
  if (payload.phone) safePayload.maskedPhone = maskPhone(payload.phone);
  if (payload.count !== undefined) safePayload.count = payload.count;
  if (payload.reason) safePayload.reason = payload.reason;
  if (payload.fieldId) safePayload.fieldId = payload.fieldId;
  if (payload.error) {
    safePayload.error =
      payload.error instanceof Error
        ? payload.error.message
        : String(payload.error);
  }

  // Pass additional non-sensitive keys
  for (const [key, value] of Object.entries(payload)) {
    if (
      ![
        "telegramUserId",
        "canonicalUserId",
        "phone",
        "error",
        "answers",
      ].includes(key)
    ) {
      safePayload[key] = value;
    }
  }

  logger.info(safePayload, `[audit] ${event}`);
}
