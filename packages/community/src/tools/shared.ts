import type { ToolResult } from "@calebx/core";
import type { ChunkCategory } from "@calebx/graph";

/**
 * Argument coercion and result helpers, shared by the community tools.
 *
 * The coercion is not defensive padding: models send `"3"` where the schema says
 * number and `"   "` where it says string often enough that treating those as
 * absent, rather than as values, is the difference between a saved preference
 * and a saved blank.
 */

export const ok = (data: unknown, message?: string): ToolResult => ({
  ok: true,
  data,
  message,
});

export const no = (message: string): ToolResult => ({ ok: false, message });

export const CATEGORIES: readonly ChunkCategory[] = [
  "interest",
  "location",
  "social",
  "sentiment",
  "preference",
];

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
