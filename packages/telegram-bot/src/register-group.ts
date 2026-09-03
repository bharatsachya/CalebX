import { adminPrincipal, systemPrincipal } from "@calebx/authz";
import type { CohortGroupsRepository } from "@calebx/db";
import type { GraphStore } from "@calebx/graph";
import { withSpan } from "@calebx/trace";

/**
 * `/register_group <cohort-key>` — the human half of group creation.
 *
 * A bot cannot create a Telegram group: the Bot API has no method, and creation
 * requires a user account, which is the MTProto path the Bot Developer Terms
 * rule out. So an admin creates the group, adds the bot, and runs this. Only
 * then can the bot mint an invite link — `createChatInviteLink` needs the bot to
 * already be an administrator.
 *
 * The decision logic is separated from the GramIO handler so the refusals — not
 * a group, no cohort key, not an admin — are unit-testable without a bot.
 */

/** A cohort key is `category:city`, lowercase, as `cohortKey()` produces. */
const COHORT_KEY = /^[a-z0-9-]+:[a-z0-9-]+$/;

export type RegisterOutcome =
  | { kind: "not_a_group" }
  | { kind: "usage" }
  | { kind: "not_admin" }
  | { kind: "ok"; cohortKey: string };

export interface RegisterRequest {
  chatType: string;
  /** Everything after the command, as typed. */
  argument?: string;
  senderIsChatAdmin: boolean;
}

/**
 * Validates a request without performing it.
 *
 * Refuses in a fixed order — shape of the chat, then shape of the argument, then
 * who is asking — so the message a user gets back names the first thing they can
 * actually fix.
 */
export function checkRegisterRequest(
  request: RegisterRequest,
): RegisterOutcome {
  if (request.chatType !== "group" && request.chatType !== "supergroup") {
    return { kind: "not_a_group" };
  }
  const cohortKey = request.argument?.trim().toLowerCase() ?? "";
  if (!COHORT_KEY.test(cohortKey)) return { kind: "usage" };
  // Checked last because it is the only one the person cannot fix themselves.
  if (!request.senderIsChatAdmin) return { kind: "not_admin" };
  return { kind: "ok", cohortKey };
}

export interface RegisterDeps {
  cohorts: CohortGroupsRepository;
  graph: GraphStore;
  /** Mints the invite link. Throws if the bot is not an administrator. */
  createInviteLink(chatId: string): Promise<string>;
  adminId: string;
}

/**
 * Records the group against its cohort, in both stores.
 *
 * Postgres is the registry a coordinator reads; the Neo4j node is what the
 * community subagent traverses to. Writing only one of them leaves a cohort that
 * looks registered from one side and invisible from the other.
 */
export async function registerGroup(
  deps: RegisterDeps,
  chatId: string,
  title: string,
  cohortKey: string,
): Promise<{ inviteLink: string }> {
  return withSpan(
    "admin.register_group",
    { kind: "internal", attributes: { cohortKey } },
    async () => {
      const inviteLink = await deps.createInviteLink(chatId);
      const admin = adminPrincipal(deps.adminId);

      // Ensure the cohort row exists before filling it in: an admin may register
      // a group the cohort job has not gotten to yet.
      await deps.cohorts.upsert(admin, cohortKey, title, 0);
      await deps.cohorts.register(admin, cohortKey, chatId, inviteLink, title);

      await deps.graph.upsertGroup(systemPrincipal("group-registrar"), {
        groupId: chatId,
        title,
        cohortKey,
        inviteLink,
        category: cohortKey.split(":")[0] ?? "social",
        memberCount: 0,
      });

      return { inviteLink };
    },
  );
}
