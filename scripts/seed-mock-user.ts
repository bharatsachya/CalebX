#!/usr/bin/env bun
/**
 * Seeds a mock user into Google Sheets for testing phone-based account linking.
 * Run with: bun run scripts/seed-mock-user.ts
 */

import { SheetsCandidateStore, SheetsContactStore } from "@calebx/sheets";
import { normalizePhone } from "@calebx/channel";

async function seed(): Promise<void> {
  const rawPhone = "8189422985";
  const normalizedPhone = normalizePhone(rawPhone);
  if (!normalizedPhone) {
    throw new Error(`Invalid phone number: ${rawPhone}`);
  }
  const userId = `mock_user_${rawPhone}`;

  const now = new Date().toISOString();

  console.log(`Seeding mock user:`);
  console.log(`  user_id: ${userId}`);
  console.log(`  phone:   ${normalizedPhone}`);

  const candidates = new SheetsCandidateStore();
  const contacts = new SheetsContactStore();

  // 1. Seed Contacts tab with phone number
  await contacts.set(userId, {
    userId,
    answers: {
      phone: normalizedPhone,
      email: "mock.aarav@example.com",
    },
  });

  console.log(`✓ Seeded Contacts tab`);

  // 2. Seed Candidates tab with partial profile data
  await candidates.set(userId, {
    userId,
    telegramUserId: "",
    createdAt: now,
    updatedAt: now,
    consentGranted: false,
    answers: {
      owner_type: "self",
      language: "Hindi",
      full_name: "Aarav Sharma",
    },
  });
  console.log(
    `✓ Seeded Candidates tab (partial fields: owner_type, language, full_name)`,
  );

  console.log(`\n🎉 Mock user successfully created in Google Sheets!`);
  console.log(`Now when you share phone ${rawPhone} in Telegram:`);
  console.log(`1. The bot will match your phone to '${userId}'.`);
  console.log(`2. It will link your Telegram account.`);
  console.log(
    `3. It will skip owner_type, language, full_name and ask only the missing fields (starting from Gender).`,
  );
}

seed().catch((err) => {
  console.error("Error seeding mock user:", err);
  process.exit(1);
});
