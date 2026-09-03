import { assertAuthorized, scopedSql, type Principal } from "@calebx/authz";
import { ValidationError } from "@calebx/errors";
import { poolExecutor, type SqlExecutor } from "./executor.ts";
import * as Q from "./queries/matchmaking.queries.ts";
import type { MatchStage, MatchStatus } from "./types.ts";

/**
 * Partner preferences and matches.
 *
 * Two shapes of data with opposite mutability rules, deliberately in one place:
 * preferences are a mutable row the user owns and may correct, matches are a
 * pair record neither side owns alone. That asymmetry is why `setStatus` writes
 * one side's column by name rather than taking a generic patch.
 */

export interface PartnerPrefs {
  candidateId: string;
  ageMin: number | null;
  ageMax: number | null;
  communityPref: string | null;
  incomeMin: number | null;
  educationPref: string | null;
  dietPref: string | null;
  lookingFor: string | null;
  prefTags: string[];
}

interface PrefsRow {
  candidate_id: string;
  age_min: number | null;
  age_max: number | null;
  community_pref: string | null;
  income_min: number | null;
  education_pref: string | null;
  diet_pref: string | null;
  looking_for: string | null;
  pref_tags: string[] | null;
}

export interface MatchRecord {
  id: string;
  candidateA: string;
  candidateB: string;
  stage: MatchStage;
  statusA: MatchStatus;
  statusB: MatchStatus;
  reason: string | null;
  score: number | null;
}

interface MatchRow {
  id: string;
  candidate_a: string;
  candidate_b: string;
  stage: MatchStage;
  status_a: MatchStatus;
  status_b: MatchStatus;
  reason: string | null;
  score: number | null;
}

function toPrefs(row: PrefsRow): PartnerPrefs {
  return {
    candidateId: row.candidate_id,
    ageMin: row.age_min,
    ageMax: row.age_max,
    communityPref: row.community_pref,
    incomeMin: row.income_min,
    educationPref: row.education_pref,
    dietPref: row.diet_pref,
    lookingFor: row.looking_for,
    prefTags: row.pref_tags ?? [],
  };
}

function toMatch(row: MatchRow): MatchRecord {
  return {
    id: row.id,
    candidateA: row.candidate_a,
    candidateB: row.candidate_b,
    stage: row.stage,
    statusA: row.status_a,
    statusB: row.status_b,
    reason: row.reason,
    score: row.score,
  };
}

/** The pair ordering the CHECK constraint requires, decided in one place. */
export function orderPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

export class MatchmakingRepository {
  constructor(private readonly executor: SqlExecutor = poolExecutor) {}

  private own(principal: Principal, userIdHash: string, write = false): void {
    assertAuthorized(principal, write ? "write" : "read", {
      kind: "partner_prefs",
      ownerId: userIdHash,
      mode: "matchmaker",
    });
  }

  async getPrefs(
    principal: Principal,
    userIdHash: string,
  ): Promise<PartnerPrefs | null> {
    this.own(principal, userIdHash);
    const rows = await scopedSql(this.executor, principal).query<PrefsRow>(
      Q.SELECT_PREFS,
      [userIdHash],
    );
    return rows[0] ? toPrefs(rows[0]) : null;
  }

  /**
   * Writes only what was supplied; omitted fields keep their stored value.
   *
   * The agent never writes a preference the user has not confirmed, so a turn
   * that establishes one fact must not clear the other nine.
   */
  async updatePrefs(
    principal: Principal,
    userIdHash: string,
    candidateId: string,
    patch: Partial<Omit<PartnerPrefs, "candidateId">>,
  ): Promise<PartnerPrefs> {
    this.own(principal, userIdHash, true);
    if (
      patch.ageMin != null &&
      patch.ageMax != null &&
      patch.ageMin > patch.ageMax
    ) {
      throw new ValidationError(
        `age range is inverted: ${patch.ageMin} > ${patch.ageMax}`,
      );
    }
    const rows = await this.executor.query<PrefsRow>(Q.UPSERT_PREFS, [
      candidateId,
      patch.ageMin ?? null,
      patch.ageMax ?? null,
      patch.communityPref ?? null,
      patch.incomeMin ?? null,
      patch.educationPref ?? null,
      patch.dietPref ?? null,
      patch.lookingFor ?? null,
      patch.prefTags ? JSON.stringify(patch.prefTags) : null,
    ]);
    if (!rows[0])
      throw new ValidationError("partner_prefs upsert returned no row");
    return toPrefs(rows[0]);
  }

  async listMatches(
    principal: Principal,
    userIdHash: string,
    limit = 20,
  ): Promise<MatchRecord[]> {
    assertAuthorized(principal, "read", {
      kind: "match",
      ownerId: userIdHash,
      mode: "matchmaker",
    });
    const rows = await scopedSql(this.executor, principal).query<MatchRow>(
      Q.LIST_MATCHES,
      [userIdHash, limit],
    );
    return rows.map(toMatch);
  }

  /** Records interest, ordering the pair canonically. Admin/system only. */
  async recordSuggestion(
    principal: Principal,
    candidateA: string,
    candidateB: string,
    reason: string | null,
    score: number | null,
  ): Promise<MatchRecord> {
    assertAuthorized(principal, "write", {
      kind: "match",
      ownerId: null,
      mode: null,
    });
    const [first, second] = orderPair(candidateA, candidateB);
    const rows = await this.executor.query<MatchRow>(Q.UPSERT_MATCH, [
      first,
      second,
      reason,
      score,
    ]);
    return toMatch(rows[0]);
  }

  /**
   * Sets one side's status.
   *
   * Which column is written depends on which side of the canonical ordering the
   * actor is on, so the caller passes the actor's candidate id rather than
   * guessing "a" or "b" — getting that wrong records the wrong person's answer.
   */
  async setStatus(
    principal: Principal,
    match: MatchRecord,
    actorCandidateId: string,
    status: MatchStatus,
  ): Promise<MatchRecord> {
    assertAuthorized(principal, "write", {
      kind: "match",
      ownerId: null,
      mode: null,
    });
    if (
      actorCandidateId !== match.candidateA &&
      actorCandidateId !== match.candidateB
    ) {
      throw new ValidationError("actor is not part of this match");
    }
    const statement =
      actorCandidateId === match.candidateA ? Q.SET_STATUS_A : Q.SET_STATUS_B;
    const rows = await this.executor.query<MatchRow>(statement, [
      match.id,
      status,
    ]);
    return toMatch(rows[0]);
  }

  async setStage(
    principal: Principal,
    matchId: string,
    stage: MatchStage,
  ): Promise<MatchRecord> {
    assertAuthorized(principal, "write", {
      kind: "match",
      ownerId: null,
      mode: null,
    });
    const rows = await this.executor.query<MatchRow>(Q.SET_STAGE, [
      matchId,
      stage,
    ]);
    return toMatch(rows[0]);
  }
}

/** True when both sides said yes — the trigger for a coordinator review. */
export function isMutual(match: MatchRecord): boolean {
  return match.statusA === "interested" && match.statusB === "interested";
}

/** Contact details may only be revealed once a coordinator advanced the stage. */
export function isContactUnlocked(match: MatchRecord): boolean {
  return (
    match.stage === "contact_shared" ||
    match.stage === "meeting" ||
    match.stage === "progressing"
  );
}
