import type { Bot } from "gramio";
import { adminPrincipal, userPrincipal } from "@calebx/authz";
import { copy, telegramUserId, type ModeName } from "@calebx/channel";
import {
  deleteAllMemories,
  forgetEverything,
  parseCommand,
} from "@calebx/agent";
import type { AgentDeps } from "@calebx/agent";
import { publishTyping, type PubSub, type TurnRunner } from "@calebx/queue";
import type { AgentMode } from "@calebx/core";
import {
  discoverableKeyboard,
  forgetConfirmKeyboard,
  modeConsentKeyboard,
} from "./keyboards.ts";

/**
 * The agent's Telegram surface: the message handler and the four commands that
 * only make sense once a user is past consent and onboarding.
 *
 * Everything user-facing here comes from `@calebx/channel`; this file holds
 * transport and rendering only.
 */

export interface AgentGateDeps {
  agent: AgentDeps;
  runner: TurnRunner;
  /** Present in queued mode; typing is Telegram-only. */
  typingBus?: PubSub;
  /** Erases the per-channel consent and onboarding records. */
  eraseChannelState(userId: string): Promise<void>;
  adminChatId?: string | null;
}

/**
 * Which mode a pending consent prompt was for, keyed by user.
 *
 * Keyed by user rather than chat because the callback that answers the prompt
 * carries the user reliably and the chat only sometimes — and because a person
 * answering in one chat has answered, whichever chat it was.
 */
const pendingModeConsent = new Map<string, AgentMode>();

function outboundKeyboard(kind: string) {
  return kind === "mode_consent"
    ? { reply_markup: modeConsentKeyboard }
    : undefined;
}

export function registerAgentHandlers(bot: Bot, deps: AgentGateDeps): void {
  // --- /switch ---
  bot.command("switch", async (context) => {
    const userId = telegramUserId(context.from.id);
    const parsed = parseCommand(context.text ?? "/switch");
    const outbound = await deps.runner.run({
      userId,
      chatId: String(context.chat.id),
      text: context.text ?? "/switch",
      channel: "Telegram",
      command: parsed ?? { name: "switch" },
    });

    for (const message of outbound) {
      if (message.kind === "mode_consent" && message.mode) {
        pendingModeConsent.set(userId, message.mode);
      }
      await context.send(message.text, outboundKeyboard(message.kind));
    }
  });

  bot.callbackQuery(copy.MODE_SWITCH_ACCEPT, async (context) => {
    const telegramId = context.from?.id;
    if (telegramId === undefined) return context.answer();
    const userId = telegramUserId(telegramId);
    const mode = pendingModeConsent.get(userId);
    if (!mode) return context.answer();
    // Consent is recorded before the switch, never after: the grant is what
    // makes the mode enterable, not a formality that follows it.
    const principal = userPrincipal(
      userId,
      mode,
      [mode],
      [deps.agent.hashUserId(userId)],
    );
    await deps.agent.agentUsers.grantConsent(principal, userId, mode);
    await deps.agent.agentUsers.enroll(principal, userId, mode);
    await deps.agent.agentUsers.setActiveMode(principal, userId, mode);
    pendingModeConsent.delete(userId);

    await context.answer();
    await context.send(copy.switchedMessage(mode as ModeName));
  });

  bot.callbackQuery(copy.MODE_SWITCH_DECLINE, async (context) => {
    const telegramId = context.from?.id;
    if (telegramId !== undefined)
      pendingModeConsent.delete(telegramUserId(telegramId));
    await context.answer();
    await context.send(copy.modeConsentDeclined);
  });

  // --- /recommendation ---
  bot.command("recommendation", async (context) => {
    const userId = telegramUserId(context.from.id);
    await runTurn(context, deps, userId, context.text ?? "", {
      name: "recommendation",
    });
  });

  // --- discoverability opt-in ---
  bot.command("findme", async (context) =>
    context.send(copy.DISCOVERABLE_REQUEST, {
      reply_markup: discoverableKeyboard,
    }),
  );

  for (const [data, value] of [
    [copy.DISCOVERABLE_ACCEPT, true],
    [copy.DISCOVERABLE_DECLINE, false],
  ] as const) {
    bot.callbackQuery(data, async (context) => {
      const telegramId = context.from?.id;
      if (telegramId === undefined) return context.answer();
      const userId = telegramUserId(telegramId);
      const principal = userPrincipal(userId, "community_connector", [
        "community_connector",
      ]);
      await deps.agent.graph.setDiscoverable(principal, userId, value);
      await context.answer();
      await context.send(copy.discoverableSet(value));
    });
  }

  // --- /forget, two-step ---
  bot.callbackQuery(copy.FORGET_CONFIRM_DECLINE, async (context) => {
    await context.answer();
    await context.editText(copy.modeConsentDeclined).catch(() => undefined);
  });

  bot.callbackQuery(copy.FORGET_CONFIRM_ACCEPT, async (context) => {
    const telegramId = context.from?.id;
    if (telegramId === undefined) return context.answer();
    const userId = telegramUserId(telegramId);

    const report = await forgetEverything({
      memories: () => deleteAllMemories(userId),
      graph: async () => {
        for (const mode of ["community_connector", "matchmaker"] as const) {
          await deps.agent.graph.deleteUser(
            userPrincipal(
              userId,
              mode,
              [mode],
              [deps.agent.hashUserId(userId)],
            ),
            userId,
          );
        }
      },
      modeState: () =>
        deps.agent.agentUsers.deleteUser(
          userPrincipal(userId, "community_connector", [
            "community_connector",
            "matchmaker",
          ]),
          userId,
        ),
      reviewTasks: () =>
        deps.agent.repos.review.deleteOpenForUser(
          userPrincipal(userId, "community_connector", ["community_connector"]),
          userId,
        ),
      consent: () => deps.eraseChannelState(userId),
    });

    await context.answer();
    await context.send(
      report.ok
        ? copy.forgottenMessage(copy.TELEGRAM_HINTS)
        : copy.forgetPartialFailure,
    );

    if (!report.ok && deps.adminChatId) {
      // A partial wipe is exactly the kind of thing a person has to finish.
      await deps.agent.repos.review
        .file(adminPrincipal("forget-reporter"), {
          kind: "agent_escalation",
          userId,
          payload: { reason: "forget incomplete", stores: report.failed },
        })
        .catch(() => undefined);
    }
  });

  // --- ordinary conversation ---
  bot.on("message", async (context) => {
    const text = typeof context.text === "string" ? context.text : "";
    if (text.trim() === "" || text.startsWith("/")) return;
    await runTurn(context, deps, telegramUserId(context.from.id), text);
  });
}

type MessageContext = {
  chat: { id: number | string };
  send(text: string, options?: unknown): Promise<unknown>;
};

async function runTurn(
  context: MessageContext,
  deps: AgentGateDeps,
  userId: string,
  text: string,
  command?: { name: string; argument?: string },
): Promise<void> {
  const chatId = String(context.chat.id);

  // Typing goes out before the work starts, and is stopped in `finally` so a
  // failed turn does not leave the indicator running.
  if (deps.typingBus) {
    await publishTyping(deps.typingBus, { chatId, action: "start" }).catch(
      () => undefined,
    );
  }

  try {
    const outbound = await deps.runner.run({
      userId,
      chatId,
      text,
      channel: "Telegram",
      command,
    });
    for (const message of outbound) {
      if (message.kind === "mode_consent" && message.mode) {
        pendingModeConsent.set(userId, message.mode);
      }
      await context.send(message.text, outboundKeyboard(message.kind));
    }
  } catch (error) {
    // A failed turn still owes a reply — silence reads as a dead bot.
    process.stderr.write(`[telegram] turn failed: ${String(error)}\n`);
    await context.send(copy.AGENT_UNAVAILABLE);
  } finally {
    if (deps.typingBus) {
      await publishTyping(deps.typingBus, { chatId, action: "stop" }).catch(
        () => undefined,
      );
    }
  }
}
