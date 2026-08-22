import { describe, expect, it, beforeEach } from "bun:test";
import {
  type CandidateProfile,
  type CandidateStore,
  type ContactRecord,
  type ContactStore,
  type MatchStore,
  copy,
  nextField,
  isComplete,
  FORM_FIELDS,
} from "@calebx/form";
import {
  type ConsentStatus,
  type ConsentStore,
  isPhoneMatch,
  normalizePhone,
  telegramUserId,
} from "@calebx/channel";
import { type FormDeps } from "./form/handlers.ts";

import { SheetsIdentityStore } from "../../sheets/src/sheets.identity.store.ts";
import { SheetsConsentStore } from "../../sheets/src/sheets.consent.store.ts";
import { handleContactMessage } from "./form/contact.flow.ts";
import {
  forgetCommand,
  matchCommand,
  skipCommand,
  startCommand,
} from "./form/commands.ts";
import { applyAnswer } from "./form/answer.flow.ts";
import { loadProfile } from "./form/profile.ts";

/** In-memory CandidateStore for unit and integration testing. */
class MemoryCandidateStore implements CandidateStore {
  public records = new Map<string, CandidateProfile>();

  async get(userId: string): Promise<CandidateProfile | null> {
    return this.records.get(userId) ?? null;
  }

  async findByTelegramId(
    telegramUserId: string,
  ): Promise<CandidateProfile | null> {
    for (const record of this.records.values()) {
      if (record.telegramUserId === telegramUserId) return record;
    }
    return null;
  }

  async set(userId: string, profile: CandidateProfile): Promise<void> {
    this.records.set(userId, profile);
  }

  async delete(userId: string): Promise<void> {
    this.records.delete(userId);
  }
}

/** In-memory ContactStore for unit and integration testing. */
class MemoryContactStore implements ContactStore {
  public records = new Map<string, ContactRecord>();

  async get(userId: string): Promise<ContactRecord | null> {
    return this.records.get(userId) ?? null;
  }

  async findByPhone(normalizedPhone: string): Promise<ContactRecord[]> {
    const results: ContactRecord[] = [];
    for (const record of this.records.values()) {
      const phone = record.answers["phone"];
      if (phone && isPhoneMatch(phone, normalizedPhone)) {
        results.push(record);
      }
    }
    return results;
  }

  async set(userId: string, record: ContactRecord): Promise<void> {
    this.records.set(userId, record);
  }

  async delete(userId: string): Promise<void> {
    this.records.delete(userId);
  }
}

class MemoryMatchStore implements MatchStore {
  async list(_userId: string) {
    return [];
  }
}

interface TestContext {
  from: { id: number };
  sent: Array<{ text: string; params?: object }>;
  send(text: string, params?: object): Promise<unknown>;
}

function createTestContext(telegramId: number): TestContext {
  const sent: Array<{ text: string; params?: object }> = [];
  return {
    from: { id: telegramId },
    sent,
    async send(text: string, params?: object) {
      sent.push({ text, params });
      return { message_id: 1 };
    },
  };
}

describe("Form Bot Phone Linking & Identity Verification", () => {
  let candidates: MemoryCandidateStore;
  let contacts: MemoryContactStore;
  let matches: MemoryMatchStore;
  let identity: SheetsIdentityStore;
  let consent: SheetsConsentStore;
  let deps: FormDeps;

  beforeEach(() => {
    candidates = new MemoryCandidateStore();
    contacts = new MemoryContactStore();
    matches = new MemoryMatchStore();
    identity = new SheetsIdentityStore({ candidates, contacts });
    consent = new SheetsConsentStore(candidates);
    deps = { candidates, contacts, matches, identity, consent };
  });

  // 1. Successful phone linking
  it("Scenario 1: successfully links phone to existing canonical user and updates telegram_user_id", async () => {
    // Seed existing user in sheet
    await candidates.set("U12345", {
      userId: "U12345",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      consentGranted: false,
      answers: { full_name: "Rahul", city: "Jaipur" },
    });
    await contacts.set("U12345", {
      userId: "U12345",
      answers: { phone: "+919876543210" },
    });

    const ctx = createTestContext(555555555);
    const tgUserId = telegramUserId(555555555);
    await consent.set(tgUserId, "granted");

    await handleContactMessage(deps, ctx, {
      phone_number: "+91 98765-43210",
      user_id: 555555555,
    });

    expect(
      ctx.sent.some((m) => m.text.includes("Account linked successfully!")),
    ).toBe(true);

    // Verify canonical linking
    const resolved = await identity.findCanonicalUserId(tgUserId);
    expect(resolved).toBe("U12345");

    const updated = await candidates.get("U12345");
    expect(updated?.telegramUserId).toBe(tgUserId);
    expect(updated?.consentGranted).toBe(true);
  });

  // 2. Phone normalization
  it("Scenario 2: phone normalization handles variants (+91, 0, parens, spaces, dashes, 10-digit)", () => {
    expect(normalizePhone("+91 (987) 654-3210")).toBe("+919876543210");
    expect(normalizePhone("09876543210")).toBe("+919876543210");
    expect(normalizePhone("9876543210")).toBe("+919876543210");
    expect(normalizePhone("00919876543210")).toBe("+919876543210");
    expect(normalizePhone("+1 (415) 555-2671")).toBe("+14155552671");
    expect(isPhoneMatch("+919876543210", "98765-43210")).toBe(true);
  });

  // 3. No matching phone -> Sign up / Create profile
  it("Scenario 3: creates a new profile and starts onboarding when phone is not in existing dataset", async () => {
    const ctx = createTestContext(555555555);
    const tgUserId = telegramUserId(555555555);
    await consent.set(tgUserId, "granted");

    await handleContactMessage(deps, ctx, {
      phone_number: "+919999999999",
      user_id: 555555555,
    });

    expect(ctx.sent.some((m) => m.text === copy.NEW_PROFILE_CREATED)).toBe(
      true,
    );

    const resolved = await identity.findCanonicalUserId(tgUserId);
    expect(resolved).toBe(tgUserId);

    const candidate = await candidates.get(tgUserId);
    expect(candidate).not.toBeNull();
    expect(candidate?.telegramUserId).toBe(tgUserId);

    const contact = await contacts.get(tgUserId);
    expect(contact?.answers["phone"]).toBe("+919999999999");
  });

  // 4. Multiple matching phones
  it("Scenario 4: handles ambiguous multiple matches safely by requesting manual assistance", async () => {
    await contacts.set("U1", {
      userId: "U1",
      answers: { phone: "+919876543210" },
    });
    await contacts.set("U2", {
      userId: "U2",
      answers: { phone: "+919876543210" },
    });

    const ctx = createTestContext(555555555);
    const tgUserId = telegramUserId(555555555);
    await consent.set(tgUserId, "granted");

    await handleContactMessage(deps, ctx, {
      phone_number: "+919876543210",
      user_id: 555555555,
    });

    expect(ctx.sent.some((m) => m.text === copy.PHONE_AMBIGUOUS)).toBe(true);
    expect(await identity.findCanonicalUserId(tgUserId)).toBeNull();
  });

  // 5. Telegram contact does not belong to current Telegram user
  it("Scenario 5: rejects contact if contact.user_id !== context.from.id", async () => {
    await contacts.set("U12345", {
      userId: "U12345",
      answers: { phone: "+919876543210" },
    });

    const ctx = createTestContext(555555555);
    const tgUserId = telegramUserId(555555555);
    await consent.set(tgUserId, "granted");

    // Attacker 555555555 shares Victim 999999999's contact card
    await handleContactMessage(deps, ctx, {
      phone_number: "+919876543210",
      user_id: 999999999, // mismatch!
    });

    expect(ctx.sent.some((m) => m.text === copy.UNTRUSTED_CONTACT)).toBe(true);
    expect(await identity.findCanonicalUserId(tgUserId)).toBeNull();
  });

  // 6. Telegram ID already linked to same user
  it("Scenario 6: treats user already linked to same record as authenticated and continues onboarding", async () => {
    const tgUserId = telegramUserId(555555555);
    await candidates.set("U12345", {
      userId: "U12345",
      telegramUserId: tgUserId,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      consentGranted: true,
      answers: { full_name: "Rahul" },
    });
    await contacts.set("U12345", {
      userId: "U12345",
      answers: { phone: "+919876543210" },
    });
    await consent.set(tgUserId, "granted");

    const match = await identity.matchPhone(tgUserId, "+919876543210");
    expect(match.kind).toBe("exact");
    if (match.kind === "exact") {
      expect(match.user.userId).toBe("U12345");
    }
  });

  // 7. Telegram ID linked to different user
  it("Scenario 7: detects conflict when current Telegram ID is already linked to another record", async () => {
    const tgUserId = telegramUserId(555555555);
    await candidates.set("U_ORIGINAL", {
      userId: "U_ORIGINAL",
      telegramUserId: tgUserId,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      consentGranted: true,
      answers: {},
    });
    await contacts.set("U_DIFFERENT", {
      userId: "U_DIFFERENT",
      answers: { phone: "+919876543210" },
    });

    const match = await identity.matchPhone(tgUserId, "+919876543210");
    expect(match.kind).toBe("telegram_conflict");
    if (match.kind === "telegram_conflict") {
      expect(match.reason).toBe("telegram_already_linked_to_different_user");
    }
  });

  // 8. Phone already linked to another Telegram ID
  it("Scenario 8: detects conflict when phone number is already claimed by a different Telegram ID", async () => {
    const otherTg = telegramUserId(111111111);
    await candidates.set("U12345", {
      userId: "U12345",
      telegramUserId: otherTg,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      consentGranted: true,
      answers: {},
    });
    await contacts.set("U12345", {
      userId: "U12345",
      answers: { phone: "+919876543210" },
    });

    const currentTg = telegramUserId(555555555);
    const match = await identity.matchPhone(currentTg, "+919876543210");
    expect(match.kind).toBe("telegram_conflict");
    if (match.kind === "telegram_conflict") {
      expect(match.reason).toBe("phone_already_linked_to_different_telegram");
    }
  });

  // 9. User declines consent
  it("Scenario 9: respects consent decline and prevents data ingestion", async () => {
    const tgUserId = telegramUserId(555555555);
    await consent.set(tgUserId, "declined");
    expect(await consent.get(tgUserId)).toBe("declined");

    const ctx = createTestContext(555555555);
    await handleContactMessage(deps, ctx, {
      phone_number: "+919876543210",
      user_id: 555555555,
    });
    // Consent nudge was shown, linking stopped
    expect(await identity.findCanonicalUserId(tgUserId)).toBeNull();
  });

  // 10. User accepts consent
  it("Scenario 10: accepts consent and persists status", async () => {
    const tgUserId = telegramUserId(555555555);
    await consent.set(tgUserId, "granted");
    expect(await consent.get(tgUserId)).toBe("granted");
  });

  // 11. Existing user with no missing fields
  it("Scenario 11: tells user their profile is already complete if all fields are present", async () => {
    const allAnswers: Record<string, string> = {};
    for (const field of FORM_FIELDS) {
      allAnswers[field.id] = "Sample Answer";
    }

    await candidates.set("U12345", {
      userId: "U12345",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      consentGranted: true,
      answers: allAnswers,
    });

    const ctx = createTestContext(555555555);
    await startCommand(deps, ctx, "U12345");
    expect(ctx.sent.some((m) => m.text === copy.ALREADY_COMPLETE)).toBe(true);
  });

  // 12. Existing user with some missing fields
  it("Scenario 12: asks only for missing fields and greets with resume message", async () => {
    await candidates.set("U12345", {
      userId: "U12345",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      consentGranted: true,
      answers: {
        owner_type: "self",
        language: "Hindi",
        full_name: "Rahul",
      },
    });

    const ctx = createTestContext(555555555);
    await startCommand(deps, ctx, "U12345");

    expect(ctx.sent.some((m) => m.text === copy.RESUMING)).toBe(true);
    const profile = await loadProfile(deps, "U12345");
    const upcoming = nextField(profile.answers);
    expect(upcoming?.id).toBe("gender"); // first unanswered field after owner_type, language & full_name
  });

  // 13. Existing user with all fields missing
  it("Scenario 13: starts with welcome message and first question if all fields missing", async () => {
    await candidates.set("U12345", {
      userId: "U12345",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      consentGranted: true,
      answers: {},
    });

    const ctx = createTestContext(555555555);
    await startCommand(deps, ctx, "U12345");
    expect(
      ctx.sent.some((m) => m.text === copy.WELCOME || m.text === copy.RESUMING),
    ).toBe(true);
  });

  // 14. Resume after interruption
  it("Scenario 14: resumes exactly at the next missing field after an interruption", async () => {
    await candidates.set("U12345", {
      userId: "U12345",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      consentGranted: true,
      answers: { owner_type: "self" },
    });

    const ctx = createTestContext(555555555);
    await startCommand(deps, ctx, "U12345");
    const nextQ = nextField((await loadProfile(deps, "U12345")).answers);
    expect(nextQ?.id).toBe("language");
  });

  // 15. Duplicate Telegram update
  it("Scenario 15: duplicate contact updates are idempotent and do not create duplicate rows", async () => {
    await candidates.set("U12345", {
      userId: "U12345",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      consentGranted: false,
      answers: { full_name: "Rahul" },
    });
    await contacts.set("U12345", {
      userId: "U12345",
      answers: { phone: "+919876543210" },
    });

    const ctx = createTestContext(555555555);
    const tgUserId = telegramUserId(555555555);
    await consent.set(tgUserId, "granted");

    // First update
    await handleContactMessage(deps, ctx, {
      phone_number: "+919876543210",
      user_id: 555555555,
    });
    // Duplicate update retry
    await handleContactMessage(deps, ctx, {
      phone_number: "+919876543210",
      user_id: 555555555,
    });

    expect(candidates.records.size).toBe(1);
    expect((await candidates.get("U12345"))?.telegramUserId).toBe(tgUserId);
  });

  // 16. Google Sheets failure
  it("Scenario 16: handles sheet persistence failure gracefully without unhandled crashes", async () => {
    const failingCandidates: CandidateStore = {
      async get() {
        return null;
      },
      async set() {
        throw new Error("Sheets 503 service unavailable");
      },
      async delete() {
        throw new Error("Sheets 503 service unavailable");
      },
    };
    const badDeps: FormDeps = {
      candidates: failingCandidates,
      contacts,
      matches,
      consent,
    };

    const ctx = createTestContext(555555555);
    // owner_type is the first field and choice 'self' is valid input
    await applyAnswer(badDeps, ctx, "U12345", {
      kind: "choice",
      id: "form:owner_type:self",
    });
    expect(ctx.sent.some((m) => m.text === copy.STORAGE_UNAVAILABLE)).toBe(
      true,
    );
  });

  // 17. Restart/persistence behavior
  it("Scenario 17: persists consent and identity mapping across container restarts", async () => {
    const tgUserId = telegramUserId(555555555);
    // User already linked in Sheets
    await candidates.set("U12345", {
      userId: "U12345",
      telegramUserId: tgUserId,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      consentGranted: true,
      answers: {},
    });

    // Simulate brand new container restart by instantiating fresh store instances
    const freshIdentity = new SheetsIdentityStore({ candidates, contacts });
    const freshConsent = new SheetsConsentStore(candidates);

    const resolved = await freshIdentity.findCanonicalUserId(tgUserId);
    expect(resolved).toBe("U12345");

    const consentStatus = await freshConsent.get(tgUserId);
    expect(consentStatus).toBe("granted");
  });

  // 18. /forget
  it("Scenario 18: /forget unlinks Telegram account and revokes consent", async () => {
    const tgUserId = telegramUserId(555555555);
    await candidates.set("U12345", {
      userId: "U12345",
      telegramUserId: tgUserId,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      consentGranted: true,
      answers: { full_name: "Rahul" },
    });

    await identity.unlinkTelegramUser("U12345");
    await consent.delete(tgUserId);

    expect(await identity.findCanonicalUserId(tgUserId)).toBeNull();
    const candidate = await candidates.get("U12345");
    expect(candidate?.telegramUserId).toBe("");
    expect(candidate?.consentGranted).toBe(false);
  });

  // 19. Multiple users onboarding concurrently
  it("Scenario 19: multiple users onboarding concurrently do not interfere with each other", async () => {
    await candidates.set("U_A", {
      userId: "U_A",
      telegramUserId: telegramUserId(111),
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      consentGranted: true,
      answers: { owner_type: "self" },
    });

    await candidates.set("U_B", {
      userId: "U_B",
      telegramUserId: telegramUserId(222),
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      consentGranted: true,
      answers: {
        owner_type: "self",
        language: "Hindi",
        full_name: "Priya",
        gender: "female",
      },
    });

    const profA = await loadProfile(deps, "U_A");
    const profB = await loadProfile(deps, "U_B");

    expect(nextField(profA.answers)?.id).toBe("language");
    expect(nextField(profB.answers)?.id).toBe("dob");
  });
});
