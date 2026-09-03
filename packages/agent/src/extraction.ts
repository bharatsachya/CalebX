import type { AgentMode } from "@calebx/core";
import { COMMUNITY_EXTRACTION_PROMPT } from "@calebx/community";
import { MATCHMAKER_EXTRACTION_PROMPT } from "@calebx/matchmaking";
import { ValidationError } from "@calebx/errors";

/**
 * Parsing Stage 1's output.
 *
 * The extraction prompt is mode-specific because the same sentence means
 * different things in the two modes — "I like quiet places" is a venue
 * preference in community mode and a temperament signal in matchmaker mode. One
 * shared extractor would blur both.
 *
 * Everything here is total: a model that returns prose, truncated JSON, or the
 * right shape with wrong types yields an empty extraction rather than throwing.
 * This runs in a background job whose failure the user never sees, so a crash
 * would just mean a silently lost persona write.
 */

export { COMMUNITY_EXTRACTION_PROMPT, MATCHMAKER_EXTRACTION_PROMPT };

export function extractionPromptFor(mode: AgentMode): string {
  return mode === "matchmaker"
    ? MATCHMAKER_EXTRACTION_PROMPT
    : COMMUNITY_EXTRACTION_PROMPT;
}

export type ChunkCategory =
  "interest" | "location" | "social" | "sentiment" | "preference";

const CATEGORIES: readonly ChunkCategory[] = [
  "interest",
  "location",
  "social",
  "sentiment",
  "preference",
];

export interface ExtractedChunk {
  text: string;
  category: ChunkCategory;
}

export interface ExtractedPrefs {
  ageMin?: number;
  ageMax?: number;
  communityPref?: string;
  educationPref?: string;
  dietPref?: string;
  lookingFor?: string;
  prefTags?: string[];
}

export interface Extraction {
  intents: string[];
  entities: string[];
  sentiment: "positive" | "neutral" | "negative";
  locationHint: string | null;
  chunks: ExtractedChunk[];
  prefs: ExtractedPrefs;
}

export const EMPTY_EXTRACTION: Extraction = {
  intents: [],
  entities: [],
  sentiment: "neutral",
  locationHint: null,
  chunks: [],
  prefs: {},
};

function strings(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (item): item is string => typeof item === "string" && item.trim() !== "",
    )
    .map((item) => item.trim())
    .slice(0, limit);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : undefined;
}

function optionalNumber(value: unknown): number | undefined {
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

/**
 * Models fence JSON in markdown often enough that stripping it is cheaper than
 * re-prompting.
 */
function unfence(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  return trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
}

function parseChunks(value: unknown): ExtractedChunk[] {
  if (!Array.isArray(value)) return [];
  const out: ExtractedChunk[] = [];
  for (const entry of value.slice(0, 5)) {
    if (entry === null || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const text = optionalString(record.text);
    const category = optionalString(record.category);
    if (!text || text.length < 8) continue;
    if (!category || !CATEGORIES.includes(category as ChunkCategory)) continue;
    out.push({ text, category: category as ChunkCategory });
  }
  return out;
}

function parsePrefs(value: unknown): ExtractedPrefs {
  if (value === null || typeof value !== "object") return {};
  const record = value as Record<string, unknown>;
  const prefs: ExtractedPrefs = {
    ageMin: optionalNumber(record.ageMin),
    ageMax: optionalNumber(record.ageMax),
    communityPref: optionalString(record.communityPref),
    educationPref: optionalString(record.educationPref),
    dietPref: optionalString(record.dietPref),
    lookingFor: optionalString(record.lookingFor),
  };
  const tags = strings(record.prefTags, 5);
  if (tags.length > 0) prefs.prefTags = tags;

  // An inverted range is worse than no range: stored, it silently matches
  // nobody and reads as "no results".
  if (
    prefs.ageMin !== undefined &&
    prefs.ageMax !== undefined &&
    prefs.ageMin > prefs.ageMax
  ) {
    delete prefs.ageMin;
    delete prefs.ageMax;
  }

  return Object.fromEntries(
    Object.entries(prefs).filter(([, entry]) => entry !== undefined),
  ) as ExtractedPrefs;
}

function parseSentiment(value: unknown): Extraction["sentiment"] {
  return value === "positive" || value === "negative" ? value : "neutral";
}

export function parseExtraction(raw: string): Extraction {
  let parsed: unknown;
  try {
    parsed = JSON.parse(unfence(raw));
  } catch {
    return EMPTY_EXTRACTION;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return EMPTY_EXTRACTION;
  }

  const record = parsed as Record<string, unknown>;
  return {
    intents: strings(record.intents, 5),
    entities: strings(record.entities, 10),
    sentiment: parseSentiment(record.sentiment),
    locationHint: optionalString(record.location_hint) ?? null,
    chunks: parseChunks(record.chunks),
    prefs: parsePrefs(record.prefs),
  };
}

/** Throws only where a caller genuinely cannot proceed without valid output. */
export function requireExtraction(raw: string): Extraction {
  const extraction = parseExtraction(raw);
  if (extraction === EMPTY_EXTRACTION) {
    throw new ValidationError("extraction produced nothing usable");
  }
  return extraction;
}
