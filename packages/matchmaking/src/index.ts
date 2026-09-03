export {
  MATCHMAKING_TOOLS,
  expressInterest,
  getMyProfile,
  listMyMatches,
  searchCandidates,
  updatePartnerPreferences,
} from "./tools/index.ts";
export { MATCHMAKER_EXTRACTION_PROMPT, MATCHMAKER_PERSONA } from "./persona.ts";
export {
  OFF_MODE_HINTS,
  assertNoContactLeak,
  looksOffMode,
  type LeakCheckOptions,
} from "./guardrails.ts";
export type { MatchmakingContext } from "./context.ts";
