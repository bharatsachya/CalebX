import type { ToolResult } from "@calebx/core";
import type { MatchmakingContext } from "../context.ts";

/**
 * Result helpers, argument coercion, and the profile precondition.
 *
 * `requireProfile` is here rather than repeated in four tools because "this
 * person has no matrimonial profile yet" is a normal state with one correct
 * answer, and four copies of it would eventually disagree.
 */

export const ok = (data: unknown, message?: string): ToolResult => ({
  ok: true,
  data,
  message,
});

export const no = (message: string): ToolResult => ({ ok: false, message });

/** Returns the candidate id, or the `ToolResult` to hand straight back. */
export function requireProfile(
  context: MatchmakingContext,
): string | ToolResult {
  if (!context.candidateId) {
    return no(
      "This person has no matrimonial profile yet — they need to complete one before matches can be searched.",
    );
  }
  return context.candidateId;
}

export function str(
  args: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = args[key];
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : undefined;
}

export function num(
  args: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = args[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (
    typeof value === "string" &&
    value.trim() !== "" &&
    !Number.isNaN(Number(value))
  ) {
    return Number(value);
  }
  return undefined;
}
