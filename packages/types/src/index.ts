export interface User {
  telegram_id: number;
  username?: string;
  consent_granted: boolean;
  created_at: number;
  last_active: number;
}

/** One chat turn kept in the short-term session buffer (file-backed, never in DB). */
export interface SessionTurn {
  role: "user" | "assistant";
  text: string;
  at: number;
}

/** LLM-distilled summary of a chat session. The only conversation-derived data persisted. */
export interface SummaryRecord {
  id: string;
  text: string;
  /** Lowercase interest tags extracted alongside the summary, e.g. ["hiking", "specialty coffee"]. */
  interests: string[];
  created_at: number;
}

/** Profile + interests a user is matched on. No raw messages leave this shape. */
export interface MatchableUser {
  telegramId: number;
  username: string;
  name: string;
  city: string;
  age: string;
  purpose: string;
  interests: string[];
  photoFileId?: string;
}

export type RecommendationStatus = "pending" | "revealed" | "declined";

export interface RecommendationRecord {
  id: string;
  aTelegramId: number;
  bTelegramId: number;
  score: number;
  /** Shared interest tags shown on the (anonymised) recommendation card. */
  shared: string[];
  status: RecommendationStatus;
  aAccepted: boolean;
  bAccepted: boolean;
  createdAt: number;
}

/** A scored candidate pair produced by the pure matching function. */
export interface ScoredPair {
  aTelegramId: number;
  bTelegramId: number;
  score: number;
  shared: string[];
}

/**
 * A recommendation as seen BY a specific user. Always edge-gated: only produced for a
 * user who is a party to the edge. `other` holds level-1 (anonymised) fields; `reveal`
 * is present only once the recommendation is mutually accepted (status "revealed").
 */
export interface RecommendationView {
  id: string;
  score: number;
  shared: string[];
  status: RecommendationStatus;
  youAccepted: boolean;
  theyAccepted: boolean;
  other: { telegramId: number; name: string; age: string; city: string };
  reveal?: { username: string; photoFileId?: string };
}
