import type { ToolDefinition } from "@calebx/core";
import type { MatchmakingContext } from "../context.ts";
import { getMyProfile } from "./profile.tool.ts";
import { updatePartnerPreferences } from "./preferences.tool.ts";
import { searchCandidates } from "./search.tool.ts";
import { expressInterest } from "./interest.tool.ts";
import { listMyMatches } from "./matches.tool.ts";

/**
 * The matchmaker subagent's tools.
 *
 * Every handler ends with `assertNoContactLeak` on whatever it is about to
 * return. Not belt-and-braces for its own sake: the model repeats what it is
 * given, so the boundary between "data we fetched" and "words the user reads" is
 * the only place a leak can still be stopped.
 */
export const MATCHMAKING_TOOLS: readonly ToolDefinition<MatchmakingContext>[] =
  [
    getMyProfile,
    updatePartnerPreferences,
    searchCandidates,
    expressInterest,
    listMyMatches,
  ] as const;

export { getMyProfile } from "./profile.tool.ts";
export { updatePartnerPreferences } from "./preferences.tool.ts";
export { searchCandidates } from "./search.tool.ts";
export { expressInterest } from "./interest.tool.ts";
export { listMyMatches } from "./matches.tool.ts";
