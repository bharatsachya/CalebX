import type { AgentMode } from "@calebx/core";
import type { ToolDefinition, ToolResult } from "@calebx/core";
import { withSpan } from "@calebx/trace";
import type { ChatModel } from "./chat.ts";

/**
 * The `/recommendation` path.
 *
 * Retrieval runs **deterministically** — this code calls the tools, the model
 * does not. Leaving it to the model means a turn where it forgets, or calls the
 * wrong one, or narrates a recommendation it never fetched. The model's job here
 * is only the last step: turning real results into something worth reading.
 *
 * The agent invokes this itself when a user asks in plain language; the command
 * is the manual shortcut to the same path (assumptions.md A10).
 */

/** Which tools each mode's recommendation pass runs, in order. */
export const RECOMMENDATION_TOOLS: Readonly<
  Record<AgentMode, readonly string[]>
> = {
  matchmaker: ["search_matrimonial_candidates"],
  community_connector: [
    "find_like_minded_people",
    "search_community_groups",
    "get_curated_places",
  ],
};

export interface GatheredResult {
  tool: string;
  result: ToolResult;
}

/**
 * Runs each named tool and collects what came back.
 *
 * Failures are collected, not thrown: in community mode three sources are tried
 * and it is entirely normal for two to have nothing. A single failure must not
 * discard the one that worked.
 */
export async function gatherRecommendations<Context>(
  tools: readonly ToolDefinition<Context>[],
  names: readonly string[],
  context: Context,
): Promise<GatheredResult[]> {
  return withSpan(
    "recommendation.gather",
    { kind: "internal" },
    async (span) => {
      const byName = new Map(tools.map((tool) => [tool.name, tool]));
      const gathered: GatheredResult[] = [];

      for (const name of names) {
        const tool = byName.get(name);
        if (!tool) continue;
        try {
          gathered.push({
            tool: name,
            result: await tool.handler(context, {}),
          });
        } catch (error) {
          gathered.push({
            tool: name,
            result: {
              ok: false,
              message: error instanceof Error ? "unavailable" : "unavailable",
            },
          });
        }
      }

      span.setAttributes({
        attempted: names.length,
        succeeded: gathered.filter((g) => g.result.ok).length,
      });
      return gathered;
    },
  );
}

export function hasAnything(gathered: GatheredResult[]): boolean {
  return gathered.some(
    (entry) => entry.result.ok && entry.result.data !== undefined,
  );
}

/**
 * Builds the narration prompt.
 *
 * The results go in as JSON with an explicit instruction not to invent — the
 * single most likely failure of this path is a model that pads three real
 * suggestions into five.
 */
export function buildNarrationPrompt(
  persona: string,
  gathered: GatheredResult[],
): string {
  const usable = gathered.filter((entry) => entry.result.ok);
  const notes = gathered
    .filter((entry) => !entry.result.ok && entry.result.message)
    .map((entry) => `- ${entry.tool}: ${entry.result.message}`)
    .join("\n");

  return `${persona}

You have just fetched real results. Describe them to the person in your own
voice, in a few sentences — not as a list, not as a table, not with headings.

Hard rules for this message:
- Mention ONLY what appears in the results below. Never add, embellish, or round up.
- If there is one result, describe one. Do not pad it to three.
- Do not mention scores, similarity, handles, ids, or ratings.
- End with at most one question.

RESULTS (JSON):
${JSON.stringify(usable.map((entry) => ({ source: entry.tool, data: entry.result.data })))}
${notes ? `\nSources that had nothing:\n${notes}` : ""}`;
}

export interface RecommendationOutcome {
  gathered: GatheredResult[];
  /** Null when nothing was found — the caller decides what to say. */
  narration: string | null;
}

export async function runRecommendation<Context>(options: {
  model: ChatModel;
  persona: string;
  tools: readonly ToolDefinition<Context>[];
  toolNames: readonly string[];
  context: Context;
  temperature?: number;
}): Promise<RecommendationOutcome> {
  const gathered = await gatherRecommendations(
    options.tools,
    options.toolNames,
    options.context,
  );

  if (!hasAnything(gathered)) return { gathered, narration: null };

  const completion = await withSpan(
    "recommendation.narrate",
    { kind: "llm" },
    () =>
      options.model.complete({
        system: buildNarrationPrompt(options.persona, gathered),
        messages: [{ role: "user", content: "Tell me what you found." }],
        tools: [],
        temperature: options.temperature ?? 0.6,
      }),
  );

  return { gathered, narration: completion.content };
}
