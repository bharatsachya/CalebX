export { runTurn, type TurnInput, type TurnOutcome } from "./agent.ts";

export {
  toToolSpecs,
  type ChatCompletion,
  type ChatMessage,
  type ChatModel,
  type ChatRequest,
  type ChatRole,
  type ToolCall,
  type ToolSpec,
} from "./chat.ts";

export { extractionCall, openRouterModel } from "./llm.ts";

export {
  NullMemory,
  addMemory,
  allMemoryKeys,
  mem0Memory,
  type MemoryPort,
  deleteAllMemories,
  memoryKey,
  searchMemories,
} from "./memory.ts";

export {
  MODE_LABELS,
  modeFromClassification,
  otherMode,
  parseSwitchTarget,
  resolveMode,
  resolveSwitch,
  type ModeDecision,
} from "./modes.ts";

export { ROUTER_PROMPT, classifyMode } from "./router.ts";

export {
  MAX_TOOL_ITERATIONS,
  runToolLoop,
  type ToolInvocation,
  type ToolLoopOptions,
  type ToolLoopResult,
} from "./tool-runner.ts";

export {
  RECOMMENDATION_TOOLS,
  buildNarrationPrompt,
  gatherRecommendations,
  hasAnything,
  runRecommendation,
  type GatheredResult,
  type RecommendationOutcome,
} from "./recommendation.ts";

export { createHumanReviewTool, type EscalationDeps } from "./human-review.ts";

export {
  forgetEverything,
  type ForgetOutcome,
  type ForgetReport,
  type ForgetStore,
  type ForgetTargets,
} from "./forget.ts";

export { looksLikeRecommendationRequest, parseCommand } from "./intent.ts";

export {
  buildCommunityBundle,
  buildMatchmakerBundle,
  principalForTurn,
  type AgentDeps,
  type SubagentBundle,
} from "./runtime.ts";

export {
  enforceOneQuestion,
  finalizeReply,
  stripInternalsTalk,
} from "./reply.ts";

export {
  COMMUNITY_EXTRACTION_PROMPT,
  EMPTY_EXTRACTION,
  MATCHMAKER_EXTRACTION_PROMPT,
  extractionPromptFor,
  parseExtraction,
  requireExtraction,
  type Extraction,
  type ExtractedChunk,
  type ExtractedPrefs,
} from "./extraction.ts";
