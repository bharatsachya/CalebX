/**
 * Registration table: wires GramIO updates to the form flows and identity linking.
 *
 * All user actions run through a `UserQueue` to serialize read-modify-write turns.
 * Resolves Telegram IDs to canonical internal user IDs before touching profile data.
 */

import type { Bot } from "gramio";
import {
  copy as channelCopy,
  telegramUserId,
  type ConsentStore,
} from "@calebx/channel";
import { copy, type IdentityStore, type MatchStore } from "@calebx/form";
import { consentKeyboard } from "../keyboards.ts";
import { logAuditEvent } from "../observability.ts";
import { applyAnswer } from "./answer.flow.ts";
import { handleCallbackQuery } from "./callback.flow.ts";
import {
  forgetCommand,
  matchCommand,
  skipCommand,
  startCommand,
} from "./commands.ts";
import { handleContactMessage } from "./contact.flow.ts";
import { requestPhoneKeyboard, sectionPickerKeyboard } from "./keyboards.ts";
import { loadProfile, type ProfileStores } from "./profile.ts";
import { UserQueue } from "./queue.ts";
import { sendText } from "./render.ts";
import { endEdit } from "./session.ts";

export interface FormDeps extends ProfileStores {
  matches: MatchStore;
  consent: ConsentStore;
  identity?: IdentityStore;
}

const HINTS = channelCopy.TELEGRAM_HINTS;

async function resolveCanonicalUser(
  deps: FormDeps,
  tgUserId: string,
): Promise<string | null> {
  if (!deps.identity) return tgUserId;
  return deps.identity.findCanonicalUserId(tgUserId);
}

export function registerFormHandlers(bot: Bot, deps: FormDeps): void {
  const queue = new UserQueue();

  const serialize = (
    userId: string,
    context: { send: (text: string, params?: object) => unknown },
    task: () => Promise<void>,
  ): void =>
    queue.run(userId, async () => {
      try {
        await task();
      } catch (error) {
        logAuditEvent("sheets_write_failed", {
          telegramUserId: userId,
          error,
        });
        await sendText(context, copy.STORAGE_UNAVAILABLE).catch(
          () => undefined,
        );
      }
    });

  // ── Commands ───────────────────────────────────────────────────────

  bot.command("start", (context) => {
    const tgUserId = telegramUserId(context.from.id);
    serialize(tgUserId, context, async () => {
      if ((await deps.consent.get(tgUserId)) !== "granted") {
        await context.send(channelCopy.privacyNotice(HINTS), {
          reply_markup: consentKeyboard,
        });
        return;
      }

      const canonicalUserId = await resolveCanonicalUser(deps, tgUserId);
      if (!canonicalUserId) {
        await context.send(copy.REQUEST_PHONE_PROMPT, {
          reply_markup: requestPhoneKeyboard,
        });
        return;
      }

      await startCommand(deps, context, canonicalUserId);
    });
  });

  bot.command("skip", (context) => {
    const tgUserId = telegramUserId(context.from.id);
    serialize(tgUserId, context, async () => {
      const canonicalUserId = await resolveCanonicalUser(deps, tgUserId);
      if (!canonicalUserId) {
        await context.send(copy.REQUEST_PHONE_PROMPT, {
          reply_markup: requestPhoneKeyboard,
        });
        return;
      }
      await skipCommand(deps, context, canonicalUserId);
    });
  });

  bot.command("match", (context) => {
    const tgUserId = telegramUserId(context.from.id);
    serialize(tgUserId, context, async () => {
      const canonicalUserId = await resolveCanonicalUser(deps, tgUserId);
      if (!canonicalUserId) {
        await context.send(copy.REQUEST_PHONE_PROMPT, {
          reply_markup: requestPhoneKeyboard,
        });
        return;
      }
      await matchCommand(deps, deps.matches, context, canonicalUserId);
    });
  });

  bot.command("update", (context) => {
    const tgUserId = telegramUserId(context.from.id);
    serialize(tgUserId, context, async () => {
      const canonicalUserId = await resolveCanonicalUser(deps, tgUserId);
      if (!canonicalUserId) {
        await context.send(copy.REQUEST_PHONE_PROMPT, {
          reply_markup: requestPhoneKeyboard,
        });
        return;
      }
      endEdit(canonicalUserId);
      const profile = await loadProfile(deps, canonicalUserId);
      if (!profile.exists) return sendText(context, copy.UPDATE_NOTHING_YET);
      await context.send(copy.UPDATE_PICK_SECTION, {
        reply_markup: sectionPickerKeyboard(),
      });
    });
  });

  bot.command("forget", (context) => {
    const tgUserId = telegramUserId(context.from.id);
    serialize(tgUserId, context, async () => {
      const canonicalUserId = await resolveCanonicalUser(deps, tgUserId);
      await deps.consent.delete(tgUserId);
      if (canonicalUserId) {
        await deps.consent.delete(canonicalUserId);
        if (deps.identity) {
          await deps.identity.unlinkTelegramUser(canonicalUserId);
        }
        await forgetCommand(deps, context, canonicalUserId);
      } else {
        await sendText(context, copy.FORGOTTEN);
      }
      logAuditEvent("user_forgotten", {
        telegramUserId: tgUserId,
        canonicalUserId: canonicalUserId ?? undefined,
      });
    });
  });

  // ── Contact Sharing (Phone Linking) ────────────────────────────────

  bot.on("message", (context, next) => {
    const rawContact =
      (
        context as unknown as {
          contact?: {
            phone_number?: string;
            phoneNumber?: string;
            user_id?: number;
            userId?: number;
          };
        }
      ).contact ??
      (
        context as unknown as {
          message?: {
            contact?: {
              phone_number?: string;
              phoneNumber?: string;
              user_id?: number;
              userId?: number;
            };
          };
        }
      ).message?.contact;

    if (!rawContact || (!rawContact.phone_number && !rawContact.phoneNumber)) {
      return next();
    }

    const tgUserId = telegramUserId(context.from.id);
    serialize(tgUserId, context, () =>
      handleContactMessage(deps, context, rawContact),
    );
  });

  // ── Callback queries ───────────────────────────────────────────────

  bot.on("callback_query", async (context, next) => {
    const handled = await handleCallbackQuery(deps, context, (userId, task) =>
      serialize(userId, context, task),
    );
    if (!handled) return next();
  });

  // ── Typed answers ──────────────────────────────────────────────────

  bot.on("message", (context) => {
    const text = typeof context.text === "string" ? context.text : "";
    if (text.startsWith("/") || text.trim() === "") return;

    const tgUserId = telegramUserId(context.from.id);
    serialize(tgUserId, context, async () => {
      const canonicalUserId = await resolveCanonicalUser(deps, tgUserId);
      if (!canonicalUserId) {
        await context.send(copy.REQUEST_PHONE_PROMPT, {
          reply_markup: requestPhoneKeyboard,
        });
        return;
      }
      await applyAnswer(deps, context, canonicalUserId, {
        kind: "text",
        value: text,
      });
    });
  });
}
