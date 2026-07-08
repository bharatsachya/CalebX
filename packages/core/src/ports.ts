import type {
  MatchableUser,
  RecommendationRecord,
  RecommendationView,
  SummaryRecord,
} from "@calebx/types";
import type { User, UserProfile } from "./entities.ts";

export interface IUserRepository {
  createUser(
    telegramId: number,
    profile?: { username?: string } & Partial<UserProfile>,
  ): Promise<User>;
  getUserByTelegramId(telegramId: number): Promise<User | null>;
  updateUserProfile(telegramId: number, profile: UserProfile): Promise<void>;
  setPhoto(telegramId: number, photoFileId: string): Promise<void>;
  /** Users eligible to be matched: consented + onboarded (name + city present). */
  listMatchable(): Promise<MatchableUser[]>;
  /** Erases the user node and everything derived from them (summaries, edges). */
  deleteUser(telegramId: number): Promise<void>;
}

export interface ISummaryStore {
  addSummary(
    telegramId: number,
    text: string,
    interests: string[],
  ): Promise<void>;
  /** Most-recent-first summaries for one user, for conversational context. */
  getSummaries(telegramId: number, limit: number): Promise<SummaryRecord[]>;
}

export interface IRecommendationStore {
  /** Persists a new pending recommendation edge between two users. */
  create(
    aTelegramId: number,
    bTelegramId: number,
    score: number,
    shared: string[],
  ): Promise<RecommendationRecord>;
  /** Every pair that has ever been recommended, as "min:max" keys, to avoid repeats. */
  existingPairKeys(): Promise<Set<string>>;
  /** Pending/revealed recommendations visible to this user (edge-gated view). */
  listForUser(telegramId: number): Promise<RecommendationView[]>;
  /**
   * Records that `telegramId` accepted recommendation `id`, but ONLY if they are
   * a party to that edge. Returns the updated edge-gated view, or null if not authorised.
   */
  accept(id: string, telegramId: number): Promise<RecommendationView | null>;
  /** Declines a recommendation the user is a party to. Returns false if not authorised. */
  decline(id: string, telegramId: number): Promise<boolean>;
}
