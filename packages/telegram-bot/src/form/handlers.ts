/**
 * Registration table: wires GramIO updates to the flows in this directory.
 *
 * Everything runs through a `UserQueue`, so one user's updates are applied one
 * at a time. The stores are read-modify-write over a network round-trip;
 * without this, two quick taps would both read the same answers and one would
 * be lost.
 *
 * Callback queries are dispatched by a single handler rather than one
 * registration per option id (the approach in `../onboarding.gate.ts`). With
 * eight choice fields and thirty-odd options, one lookup beats thirty chained
 * middlewares on every tap.
 */

import type { Bot } from "gramio";
import {
  copy as channelCopy,
  telegramUserId,
  type ConsentStore,
} from "@calebx/channel";
import {
  CALLBACK_BACK,
  CALLBACK_CANCEL,
  copy,
  fieldByOptionId,
  fieldById,
  parseEditCallback,
  parseSectionCallback,
  type MatchStore,
  type SectionId,
} from "@calebx/form";
import { consentKeyboard } from "../keyboards.ts";
import { applyAnswer } from "./answer.flow.ts";
import {
  forgetCommand,
  matchCommand,
  skipCommand,
  startCommand,
} from "./commands.ts";
import { fieldPickerKeyboard, sectionPickerKeyboard } from "./keyboards.ts";
import { loadProfile, type ProfileStores } from "./profile.ts";
import { UserQueue } from "./queue.ts";
import { sendText } from "./render.ts";
import { beginEdit, endEdit } from "./session.ts";
import { editPromptFor } from "./update.flow.ts";

export interface FormDeps extends ProfileStores {
  matches: MatchStore;
  consent: ConsentStore;
}

const HINTS = channelCopy.TELEGRAM_HINTS;

export function registerFormHandlers(bot: Bot, deps: FormDeps): void {
  const queue = new UserQueue();

  /** Runs `task` on the user's chain, replying with a fallback if it throws. */
  const serialize = (
    userId: string,
    context: { send: (text: string, params?: object) => unknown },
    task: () => Promise<void>,
  ): void =>
    queue.run(userId, async () => {
      try {
        await task();
      } catch (error) {
        // A failed turn still owes the user a reply (CLAUDE.md rule 13).
        console.error(`[form] turn failed for ${userId}:`, error);
        await sendText(context, copy.STORAGE_UNAVAILABLE).catch(
          () => undefined,
        );
      }
    });

  // ── Commands ───────────────────────────────────────────────────────

  // /start is the consent flow's entry point, so it checks consent itself
  // rather than relying on the gate (which lets /start through by design).
  bot.command("start", (context) => {
    const userId = telegramUserId(context.from.id);
    serialize(userId, context, async () => {
      if ((await deps.consent.get(userId)) !== "granted") {
        await context.send(channelCopy.privacyNotice(HINTS), {
          reply_markup: consentKeyboard,
        });
        return;
      }
      await startCommand(deps, context, userId);
    });
  });

  bot.command("skip", (context) => {
    const userId = telegramUserId(context.from.id);
    serialize(userId, context, () => skipCommand(deps, context, userId));
  });

  bot.command("match", (context) => {
    const userId = telegramUserId(context.from.id);
    serialize(userId, context, () =>
      matchCommand(deps, deps.matches, context, userId),
    );
  });

  bot.command("update", (context) => {
    const userId = telegramUserId(context.from.id);
    serialize(userId, context, async () => {
      endEdit(userId);
      const profile = await loadProfile(deps, userId);
      if (!profile.exists) return sendText(context, copy.UPDATE_NOTHING_YET);
      await context.send(copy.UPDATE_PICK_SECTION, {
        reply_markup: sectionPickerKeyboard(),
      });
    });
  });

  // /forget revokes consent as well as erasing the answers, so a user who walks
  // away leaves nothing behind and is asked to agree again if they return.
  bot.command("forget", (context) => {
    const userId = telegramUserId(context.from.id);
    serialize(userId, context, async () => {
      await deps.consent.delete(userId);
      await forgetCommand(deps, context, userId);
    });
  });

  // ── Callback queries ───────────────────────────────────────────────

  bot.on("callback_query", async (context, next) => {
    const data = typeof context.data === "string" ? context.data : "";
    const telegramId = context.from?.id;
    if (telegramId === undefined || data === "") return next();

    const userId = telegramUserId(telegramId);
    const edit = (text: string, params?: object) =>
      context.editText(text, params).catch(() => undefined);

    // Consent — accept. The first thing that may touch the sheet.
    if (data === channelCopy.CONSENT_ACCEPT) {
      await deps.consent.set(userId, "granted");
      await context.answer("Thanks!");
      await edit(channelCopy.ACCEPTED_MESSAGE);
      serialize(userId, context, () => startCommand(deps, context, userId));
      return;
    }

    if (data === channelCopy.CONSENT_DECLINE) {
      await deps.consent.set(userId, "declined");
      await context.answer();
      await edit(channelCopy.declinedMessage(HINTS));
      return;
    }

    if (data === CALLBACK_CANCEL) {
      endEdit(userId);
      await context.answer();
      await edit(copy.UPDATE_CANCELLED);
      return;
    }

    if (data === CALLBACK_BACK) {
      await context.answer();
      await edit(copy.UPDATE_PICK_SECTION, {
        reply_markup: sectionPickerKeyboard(),
      });
      return;
    }

    const sectionId = parseSectionCallback(data);
    if (sectionId !== null) {
      await context.answer();
      const profile = await loadProfile(deps, userId);
      await edit(copy.UPDATE_PICK_FIELD, {
        reply_markup: fieldPickerKeyboard(
          sectionId as SectionId,
          profile.answers,
        ),
      });
      return;
    }

    const fieldId = parseEditCallback(data);
    if (fieldId !== null) {
      const field = fieldById(fieldId);
      await context.answer();
      if (!field) return void sendText(context, copy.UPDATE_CANCELLED);

      beginEdit(userId, fieldId);
      const profile = await loadProfile(deps, userId);
      await editPromptFor(context, field, profile.answers[fieldId]);
      return;
    }

    // An answer button. The option id identifies its own field, so a tap on a
    // keyboard the user scrolled back to is recognised rather than applied to
    // whatever question happens to be current — `applyAnswer` rejects it.
    if (fieldByOptionId(data)) {
      await context.answer();
      serialize(userId, context, () =>
        applyAnswer(deps, context, userId, { kind: "choice", id: data }),
      );
      return;
    }

    return next();
  });

  // ── Typed answers ──────────────────────────────────────────────────

  bot.on("message", (context) => {
    const text = typeof context.text === "string" ? context.text : "";
    if (text.startsWith("/") || text.trim() === "") return;

    const userId = telegramUserId(context.from.id);
    serialize(userId, context, () =>
      applyAnswer(deps, context, userId, { kind: "text", value: text }),
    );
  });
}
