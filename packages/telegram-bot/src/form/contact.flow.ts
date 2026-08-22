/**
 * Contact-sharing and phone-based identity linking flow.
 */

import {
  copy as channelCopy,
  normalizePhone,
  telegramUserId,
  type ConsentStore,
} from "@calebx/channel";
import { copy, type IdentityStore } from "@calebx/form";
import { consentKeyboard } from "../keyboards.ts";
import { logAuditEvent } from "../observability.ts";
import { startCommand } from "./commands.ts";
import { removeKeyboard, requestPhoneKeyboard } from "./keyboards.ts";
import { type ProfileStores } from "./profile.ts";

export interface ContactFlowDeps extends ProfileStores {
  consent: ConsentStore;
  identity?: IdentityStore;
}

const HINTS = channelCopy.TELEGRAM_HINTS;

export async function handleContactMessage(
  deps: ContactFlowDeps,
  context: {
    from: { id: number };
    send: (text: string, params?: object) => Promise<unknown>;
  },
  contact: {
    phoneNumber?: string;
    phone_number?: string;
    userId?: number;
    user_id?: number;
  },
): Promise<void> {
  const tgUserId = telegramUserId(context.from.id);
  const phoneNumber = contact.phone_number ?? contact.phoneNumber;
  const contactUserId = contact.user_id ?? contact.userId;

  if (!phoneNumber) return;

  // 1. Verify consent
  if ((await deps.consent.get(tgUserId)) !== "granted") {
    await context.send(
      `${channelCopy.NEEDS_CONSENT_NUDGE}\n\n${channelCopy.privacyNotice(HINTS)}`,
      { reply_markup: consentKeyboard },
    );
    return;
  }

  // 2. Authenticate contact ownership: contactUserId must match context.from.id
  if (contactUserId !== undefined && contactUserId !== context.from.id) {
    logAuditEvent("untrusted_contact_rejected", {
      telegramUserId: tgUserId,
      contactUserId,
    });
    await context.send(copy.UNTRUSTED_CONTACT, {
      reply_markup: requestPhoneKeyboard,
    });
    return;
  }

  // 3. Normalize phone number
  const normalized = normalizePhone(phoneNumber);
  if (!normalized) {
    await context.send(copy.UNTRUSTED_CONTACT, {
      reply_markup: requestPhoneKeyboard,
    });
    return;
  }

  logAuditEvent("contact_received", {
    telegramUserId: tgUserId,
    phone: normalized,
  });

  if (!deps.identity) {
    await startCommand(deps, context, tgUserId);
    return;
  }

  // 4. Match against user database
  const matchResult = await deps.identity.matchPhone(tgUserId, normalized);

  if (matchResult.kind === "none") {
    logAuditEvent("phone_match_not_found", {
      telegramUserId: tgUserId,
      phone: normalized,
    });

    // User does not exist in dataset: create new profile and start onboarding
    const canonicalUserId = deps.identity.createNewUser
      ? await deps.identity.createNewUser(tgUserId, normalized)
      : tgUserId;

    await deps.consent.set(tgUserId, "granted");

    logAuditEvent("profile_linked", {
      telegramUserId: tgUserId,
      canonicalUserId,
    });

    await context.send(copy.NEW_PROFILE_CREATED, {
      reply_markup: removeKeyboard,
    });
    await startCommand(deps, context, canonicalUserId);
    return;
  }

  if (matchResult.kind === "ambiguous") {
    logAuditEvent("phone_match_ambiguous", {
      telegramUserId: tgUserId,
      phone: normalized,
      count: matchResult.count,
    });
    await context.send(copy.PHONE_AMBIGUOUS, {
      reply_markup: removeKeyboard,
    });
    return;
  }

  if (matchResult.kind === "telegram_conflict") {
    logAuditEvent("telegram_identity_conflict", {
      telegramUserId: tgUserId,
      phone: normalized,
      reason: matchResult.reason,
    });
    await context.send(copy.IDENTITY_CONFLICT, {
      reply_markup: removeKeyboard,
    });
    return;
  }

  // 5. Exact match: Link account
  const canonicalUserId = matchResult.user.userId;
  await deps.identity.linkTelegramUser(canonicalUserId, tgUserId);
  await deps.consent.set(tgUserId, "granted");

  logAuditEvent("phone_match_success", {
    telegramUserId: tgUserId,
    canonicalUserId,
    phone: normalized,
  });
  logAuditEvent("profile_linked", {
    telegramUserId: tgUserId,
    canonicalUserId,
  });

  await context.send("Account linked successfully!", {
    reply_markup: removeKeyboard,
  });
  await startCommand(deps, context, canonicalUserId);
}
