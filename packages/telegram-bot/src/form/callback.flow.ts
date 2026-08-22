/**
 * Callback query handling for consent, sections, and inline keyboard answers.
 */

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
  type IdentityStore,
  type SectionId,
} from "@calebx/form";
import { logAuditEvent } from "../observability.ts";
import { applyAnswer } from "./answer.flow.ts";
import { startCommand } from "./commands.ts";
import {
  fieldPickerKeyboard,
  requestPhoneKeyboard,
  sectionPickerKeyboard,
} from "./keyboards.ts";
import { loadProfile, type ProfileStores } from "./profile.ts";
import { sendText } from "./render.ts";
import { beginEdit, endEdit } from "./session.ts";
import { editPromptFor } from "./update.flow.ts";

export interface CallbackDeps extends ProfileStores {
  consent: ConsentStore;
  identity?: IdentityStore;
}

const HINTS = channelCopy.TELEGRAM_HINTS;

export async function handleCallbackQuery(
  deps: CallbackDeps,
  context: {
    data?: string;
    from?: { id: number };
    answer: (text?: string) => Promise<unknown>;
    editText: (text: string, params?: object) => Promise<unknown>;
    send: (text: string, params?: object) => Promise<unknown>;
  },
  serialize: (userId: string, task: () => Promise<void>) => void,
): Promise<boolean> {
  const data = typeof context.data === "string" ? context.data : "";
  const telegramId = context.from?.id;
  if (telegramId === undefined || data === "") return false;

  const tgUserId = telegramUserId(telegramId);
  const edit = (text: string, params?: object) =>
    context.editText(text, params).catch(() => undefined);

  if (data === channelCopy.CONSENT_ACCEPT) {
    await deps.consent.set(tgUserId, "granted");
    logAuditEvent("consent_granted", { telegramUserId: tgUserId });
    await context.answer("Thanks!");
    await edit(channelCopy.ACCEPTED_MESSAGE);
    serialize(tgUserId, async () => {
      const canonicalUserId = deps.identity
        ? await deps.identity.findCanonicalUserId(tgUserId)
        : tgUserId;
      if (!canonicalUserId) {
        await context.send(copy.REQUEST_PHONE_PROMPT, {
          reply_markup: requestPhoneKeyboard,
        });
        return;
      }
      await startCommand(deps, context, canonicalUserId);
    });
    return true;
  }

  if (data === channelCopy.CONSENT_DECLINE) {
    await deps.consent.set(tgUserId, "declined");
    logAuditEvent("consent_declined", { telegramUserId: tgUserId });
    await context.answer();
    await edit(channelCopy.declinedMessage(HINTS));
    return true;
  }

  const canonicalUserId =
    (deps.identity
      ? await deps.identity.findCanonicalUserId(tgUserId)
      : null) ?? tgUserId;

  if (data === CALLBACK_CANCEL) {
    endEdit(canonicalUserId);
    await context.answer();
    await edit(copy.UPDATE_CANCELLED);
    return true;
  }

  if (data === CALLBACK_BACK) {
    await context.answer();
    await edit(copy.UPDATE_PICK_SECTION, {
      reply_markup: sectionPickerKeyboard(),
    });
    return true;
  }

  const sectionId = parseSectionCallback(data);
  if (sectionId !== null) {
    await context.answer();
    const profile = await loadProfile(deps, canonicalUserId);
    await edit(copy.UPDATE_PICK_FIELD, {
      reply_markup: fieldPickerKeyboard(
        sectionId as SectionId,
        profile.answers,
      ),
    });
    return true;
  }

  const fieldId = parseEditCallback(data);
  if (fieldId !== null) {
    const field = fieldById(fieldId);
    await context.answer();
    if (!field) {
      await sendText(context, copy.UPDATE_CANCELLED);
      return true;
    }

    beginEdit(canonicalUserId, fieldId);
    const profile = await loadProfile(deps, canonicalUserId);
    await editPromptFor(context, field, profile.answers[fieldId]);
    return true;
  }

  if (fieldByOptionId(data)) {
    await context.answer();
    serialize(tgUserId, () =>
      applyAnswer(deps, context, canonicalUserId, {
        kind: "choice",
        id: data,
      }),
    );
    return true;
  }

  return false;
}
