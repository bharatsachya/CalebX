import type { Bot } from "gramio";
import { copy } from "@calebx/channel";
import { parseCommand } from "@calebx/agent";
import type { AgentDeps } from "@calebx/agent";
import { checkRegisterRequest, registerGroup } from "./register-group.ts";

/**
 * Admin-only Telegram commands.
 *
 * Separate from the agent gate because the audience is different: these are run
 * by a coordinator in a group, not by a user in a conversation, and mixing them
 * into the message-handling file makes both harder to follow.
 */

export interface AdminGateDeps {
  agent: AgentDeps;
  adminChatId?: string | null;
}

export function registerAdminHandlers(bot: Bot, deps: AdminGateDeps): void {
  // --- /register_group (admin, inside the group) ---
  bot.command("register_group", async (context) => {
    const parsed = parseCommand(context.text ?? "/register_group");
    const senderId = context.from?.id;

    // Telegram's own admin list is the authority here: whoever can create the
    // group and add the bot is exactly who should be able to claim it.
    let senderIsChatAdmin = false;
    if (senderId !== undefined) {
      const member = await bot.api
        .getChatMember({ chat_id: context.chat.id, user_id: senderId })
        .catch(() => undefined);
      const status = (member as { status?: string } | undefined)?.status;
      senderIsChatAdmin = status === "administrator" || status === "creator";
    }

    const outcome = checkRegisterRequest({
      chatType: context.chat.type,
      argument: parsed?.argument,
      senderIsChatAdmin,
    });

    if (outcome.kind === "not_a_group" || outcome.kind === "usage") {
      return context.send(copy.REGISTER_GROUP_USAGE);
    }
    if (outcome.kind === "not_admin")
      return context.send(copy.REGISTER_GROUP_USAGE);

    const chatId = String(context.chat.id);
    try {
      await registerGroup(
        {
          cohorts: deps.agent.repos.cohorts,
          graph: deps.agent.graph,
          // Throws unless the bot is already an administrator — which is the
          // check that matters, so it is not duplicated beforehand.
          createInviteLink: async (id) => {
            const link = await bot.api.createChatInviteLink({
              chat_id: Number(id),
            });
            return (link as { invite_link: string }).invite_link;
          },
          adminId: deps.adminChatId ?? "telegram-admin",
        },
        chatId,
        context.chat.title ?? outcome.cohortKey,
        outcome.cohortKey,
      );
      return context.send(copy.registerGroupDone(outcome.cohortKey));
    } catch (error) {
      process.stderr.write(
        `[telegram] register_group failed: ${String(error)}\n`,
      );
      return context.send(copy.REGISTER_GROUP_NOT_ADMIN);
    }
  });
}
