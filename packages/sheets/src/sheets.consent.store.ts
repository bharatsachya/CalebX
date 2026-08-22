/**
 * Durable ConsentStore backed by Google Sheets and in-memory cache.
 *
 * Ensures consent decisions persist across Azure Container App restarts
 * without requiring PostgreSQL or Redis.
 */

import {
  type ConsentStatus,
  type ConsentStore,
  type UserId,
} from "@calebx/channel";
import { type CandidateStore } from "@calebx/form";
import { SheetsCandidateStore } from "./sheets.candidate.store.ts";

export class SheetsConsentStore implements ConsentStore {
  private readonly memoryCache = new Map<string, ConsentStatus>();
  private readonly candidates: CandidateStore;

  constructor(candidates?: CandidateStore) {
    this.candidates = candidates ?? new SheetsCandidateStore();
  }

  async get(userId: UserId): Promise<ConsentStatus> {
    // 1. Check in-memory session cache first
    const cached = this.memoryCache.get(userId);
    if (cached !== undefined) return cached;

    // 2. Check candidate record in Sheets (durable across restarts)
    if (this.candidates.findByTelegramId) {
      const candidate = await this.candidates.findByTelegramId(userId);
      if (candidate) {
        const status = candidate.consentGranted ? "granted" : "declined";
        this.memoryCache.set(userId, status);
        return status;
      }
    }

    const direct = await this.candidates.get(userId);
    if (direct) {
      const status = direct.consentGranted ? "granted" : "declined";
      this.memoryCache.set(userId, status);
      return status;
    }

    return "unknown";
  }

  async set(userId: UserId, status: ConsentStatus): Promise<void> {
    this.memoryCache.set(userId, status);

    // If candidate exists in sheet, sync consent_granted column
    let candidate = this.candidates.findByTelegramId
      ? await this.candidates.findByTelegramId(userId)
      : null;

    if (!candidate) {
      candidate = await this.candidates.get(userId);
    }

    if (candidate) {
      await this.candidates.set(candidate.userId, {
        ...candidate,
        consentGranted: status === "granted",
        updatedAt: new Date().toISOString(),
      });
    }
  }

  async delete(userId: UserId): Promise<void> {
    this.memoryCache.delete(userId);

    let candidate = this.candidates.findByTelegramId
      ? await this.candidates.findByTelegramId(userId)
      : null;

    if (!candidate) {
      candidate = await this.candidates.get(userId);
    }

    if (candidate) {
      await this.candidates.set(candidate.userId, {
        ...candidate,
        consentGranted: false,
        updatedAt: new Date().toISOString(),
      });
    }
  }
}
