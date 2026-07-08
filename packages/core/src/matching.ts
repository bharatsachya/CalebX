import type { MatchableUser, ScoredPair } from "@calebx/types";

const AGE_BUCKETS = ["18-24", "25-34", "35-44", "45+"];
const PURPOSE_TOKENS = ["meet people", "discover places", "communities"];

const SAME_CITY_POINTS = 3;
const PURPOSE_OVERLAP_POINTS = 2;
const SAME_AGE_POINTS = 1;
const ADJACENT_AGE_POINTS = 0.5;
const INTEREST_WEIGHT = 5;

function normalise(value: string): string {
  return value.trim().toLowerCase();
}

function purposeSet(purpose: string): Set<string> {
  const lower = normalise(purpose);
  return new Set(PURPOSE_TOKENS.filter((token) => lower.includes(token)));
}

function interestSet(interests: string[]): Set<string> {
  return new Set(interests.map(normalise).filter((i) => i.length > 0));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const item of a) if (b.has(item)) intersection += 1;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function agePoints(a: string, b: string): number {
  const ia = AGE_BUCKETS.indexOf(a);
  const ib = AGE_BUCKETS.indexOf(b);
  if (ia === -1 || ib === -1) return 0;
  const gap = Math.abs(ia - ib);
  if (gap === 0) return SAME_AGE_POINTS;
  if (gap === 1) return ADJACENT_AGE_POINTS;
  return 0;
}

/** Interest tags shared by both users, for the recommendation card. */
export function sharedInterests(a: MatchableUser, b: MatchableUser): string[] {
  const bSet = interestSet(b.interests);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of a.interests) {
    const key = normalise(raw);
    if (key.length > 0 && bSet.has(key) && !seen.has(key)) {
      seen.add(key);
      out.push(key);
    }
  }
  return out;
}

/** Pure compatibility score between two users. Higher is better. */
export function scorePair(a: MatchableUser, b: MatchableUser): number {
  let score = 0;
  if (normalise(a.city) === normalise(b.city) && normalise(a.city).length > 0) {
    score += SAME_CITY_POINTS;
  }
  const purposeA = purposeSet(a.purpose);
  const purposeB = purposeSet(b.purpose);
  for (const token of purposeA) {
    if (purposeB.has(token)) {
      score += PURPOSE_OVERLAP_POINTS;
      break;
    }
  }
  score += agePoints(a.age, b.age);
  score +=
    INTEREST_WEIGHT *
    jaccard(interestSet(a.interests), interestSet(b.interests));
  return score;
}

/** Stable "min:max" key for an unordered pair. */
export function pairKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

export interface PickOptions {
  minScore: number;
  /** Pair keys already recommended in the past — never re-recommend these. */
  existingPairs: Set<string>;
  /** Max new recommendations per user in this run. */
  maxPerUser: number;
}

/**
 * Greedy matcher: scores all unordered pairs, drops already-recommended pairs and
 * anything below minScore, then picks highest-scoring pairs first while capping how
 * many new recommendations each user gets this run. Never pairs a user with themself.
 */
export function pickRecommendations(
  users: MatchableUser[],
  options: PickOptions,
): ScoredPair[] {
  const candidates: ScoredPair[] = [];
  for (let i = 0; i < users.length; i++) {
    for (let j = i + 1; j < users.length; j++) {
      const a = users[i];
      const b = users[j];
      if (a === undefined || b === undefined) continue;
      if (a.telegramId === b.telegramId) continue;
      if (options.existingPairs.has(pairKey(a.telegramId, b.telegramId)))
        continue;
      const score = scorePair(a, b);
      if (score < options.minScore) continue;
      candidates.push({
        aTelegramId: a.telegramId,
        bTelegramId: b.telegramId,
        score,
        shared: sharedInterests(a, b),
      });
    }
  }

  candidates.sort((x, y) => y.score - x.score);

  const perUserCount = new Map<number, number>();
  const picked: ScoredPair[] = [];
  for (const pair of candidates) {
    const aCount = perUserCount.get(pair.aTelegramId) ?? 0;
    const bCount = perUserCount.get(pair.bTelegramId) ?? 0;
    if (aCount >= options.maxPerUser || bCount >= options.maxPerUser) continue;
    picked.push(pair);
    perUserCount.set(pair.aTelegramId, aCount + 1);
    perUserCount.set(pair.bTelegramId, bCount + 1);
  }
  return picked;
}
