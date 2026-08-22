/**
 * IdentityStore over Google Sheets.
 *
 * Implements canonical internal user resolution, phone matching,
 * identity conflict detection, and Telegram account linking.
 */

import {
  type CandidateStore,
  type ContactStore,
  type IdentityStore,
  type PhoneMatchResult,
} from "@calebx/form";
import { normalizePhone } from "@calebx/channel";
import { SheetsCandidateStore } from "./sheets.candidate.store.ts";
import { SheetsContactStore } from "./sheets.contact.store.ts";

export interface SheetsIdentityDeps {
  candidates?: CandidateStore;
  contacts?: ContactStore;
}

export class SheetsIdentityStore implements IdentityStore {
  private readonly candidates: CandidateStore;
  private readonly contacts: ContactStore;

  constructor(deps: SheetsIdentityDeps = {}) {
    this.candidates = deps.candidates ?? new SheetsCandidateStore();
    this.contacts = deps.contacts ?? new SheetsContactStore();
  }

  /**
   * Resolves a Telegram user ID (e.g. "tg:1101953596") to its linked canonical
   * internal user_id. Returns null if not linked.
   */
  async findCanonicalUserId(telegramUserId: string): Promise<string | null> {
    if (!telegramUserId) return null;

    // 1. Check if any row has telegram_user_id matching this ID
    if (this.candidates.findByTelegramId) {
      const candidate = await this.candidates.findByTelegramId(telegramUserId);
      if (candidate) return candidate.userId;
    }

    // 2. Fallback: check if the user_id itself is the telegram ID (legacy support)
    const direct = await this.candidates.get(telegramUserId);
    if (direct) return direct.userId;

    return null;
  }

  /**
   * Matches a normalized phone against the user database.
   */
  async matchPhone(
    telegramUserId: string,
    rawOrNormalizedPhone: string,
  ): Promise<PhoneMatchResult> {
    const normalized = normalizePhone(rawOrNormalizedPhone);
    if (!normalized) {
      return { kind: "none" };
    }

    // Find contacts with matching phone
    const matches = this.contacts.findByPhone
      ? await this.contacts.findByPhone(normalized)
      : [];

    if (matches.length === 0) {
      return { kind: "none" };
    }

    if (matches.length > 1) {
      return { kind: "ambiguous", count: matches.length };
    }

    const match = matches[0]!;
    const candidate = await this.candidates.get(match.userId);

    // Conflict Check 1: Record already linked to a different Telegram user
    if (
      candidate?.telegramUserId &&
      candidate.telegramUserId.trim() !== "" &&
      candidate.telegramUserId !== telegramUserId
    ) {
      return {
        kind: "telegram_conflict",
        reason: "phone_already_linked_to_different_telegram",
      };
    }

    // Conflict Check 2: Current Telegram ID already linked to a different internal user
    const existingLinkedUser = await this.findCanonicalUserId(telegramUserId);
    if (existingLinkedUser && existingLinkedUser !== match.userId) {
      return {
        kind: "telegram_conflict",
        reason: "telegram_already_linked_to_different_user",
      };
    }

    return {
      kind: "exact",
      user: {
        userId: match.userId,
        telegramUserId: candidate?.telegramUserId,
        answers: {
          ...(candidate?.answers ?? {}),
          ...match.answers,
        },
      },
    };
  }

  /**
   * Links a Telegram user ID to an existing canonical user record.
   */
  async linkTelegramUser(
    canonicalUserId: string,
    telegramUserId: string,
  ): Promise<void> {
    const existing = await this.candidates.get(canonicalUserId);
    const now = new Date().toISOString();

    await this.candidates.set(canonicalUserId, {
      userId: canonicalUserId,
      telegramUserId,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      consentGranted: true,
      answers: existing?.answers ?? {},
    });
  }

  /**
   * Unlinks Telegram account and revokes consent on the canonical record.
   */
  async unlinkTelegramUser(canonicalUserId: string): Promise<void> {
    const existing = await this.candidates.get(canonicalUserId);
    if (!existing) return;

    const now = new Date().toISOString();
    await this.candidates.set(canonicalUserId, {
      ...existing,
      telegramUserId: "",
      consentGranted: false,
      updatedAt: now,
    });
  }

  /**
   * Creates a new user record for a fresh sign-up.
   */
  async createNewUser(
    telegramUserId: string,
    normalizedPhone: string,
  ): Promise<string> {
    const canonicalUserId = telegramUserId;
    const now = new Date().toISOString();

    await this.candidates.set(canonicalUserId, {
      userId: canonicalUserId,
      telegramUserId,
      createdAt: now,
      updatedAt: now,
      consentGranted: true,
      answers: {},
    });

    await this.contacts.set(canonicalUserId, {
      userId: canonicalUserId,
      answers: { phone: normalizedPhone },
    });

    return canonicalUserId;
  }
}
