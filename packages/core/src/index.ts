export type { User, UserProfile } from "./entities.ts";
export type {
  IUserRepository,
  ISummaryStore,
  IRecommendationStore,
} from "./ports.ts";
export {
  scorePair,
  sharedInterests,
  pairKey,
  pickRecommendations,
  type PickOptions,
} from "./matching.ts";
