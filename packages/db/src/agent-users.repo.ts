import { assertAuthorized, scopedSql, type Principal } from "@calebx/authz";
import { AGENT_MODES, type AgentMode, type UserModeState } from "@calebx/core";
import { ValidationError } from "@calebx/errors";
import { poolExecutor, type SqlExecutor } from "./executor.ts";

/**
 * Mode assignment and per-mode consent.
 *
 * The mode state is the most security-sensitive row in the system: it decides
 * which subagent runs and therefore which half of the data the turn is allowed
 * to touch. So it is read and written through the same authorization layer as
 * everything else, and never cached anywhere that is not invalidated on write.
 */

interface ModeRow {
  user_id: string;
  active_mode: AgentMode | null;
  enrolled_modes: AgentMode[] | null;
}

const SELECT_STATE = `
SELECT user_id, active_mode, enrolled_modes
FROM agent_users
WHERE user_id = $1
`;

const UPSERT_USER = `
INSERT INTO agent_users (user_id) VALUES ($1)
ON CONFLICT (user_id) DO UPDATE SET last_active = now()
RETURNING user_id, active_mode, enrolled_modes
`;

const SET_ACTIVE_MODE = `
UPDATE agent_users
SET active_mode = $2, last_active = now()
WHERE user_id = $1
RETURNING user_id, active_mode, enrolled_modes
`;

const ENROLL = `
UPDATE agent_users
SET enrolled_modes = (
      SELECT array_agg(DISTINCT m)
      FROM unnest(enrolled_modes || $2::agent_mode[]) AS m
    ),
    active_mode = coalesce(active_mode, $2[1]),
    last_active = now()
WHERE user_id = $1
RETURNING user_id, active_mode, enrolled_modes
`;

const GRANT_CONSENT = `
INSERT INTO mode_consent (user_id, mode) VALUES ($1, $2)
ON CONFLICT (user_id, mode) DO NOTHING
`;

const SELECT_CONSENT = `
SELECT mode FROM mode_consent WHERE user_id = $1
`;

const DELETE_USER = `
DELETE FROM agent_users WHERE user_id = $1
`;

function toState(row: ModeRow): UserModeState {
  return {
    userId: row.user_id,
    activeMode: row.active_mode,
    enrolledModes: row.enrolled_modes ?? [],
  };
}

function assertMode(mode: string): AgentMode {
  if (!(AGENT_MODES as readonly string[]).includes(mode)) {
    throw new ValidationError(`unknown agent mode: ${mode}`);
  }
  return mode as AgentMode;
}

export class AgentUsersRepository {
  constructor(private readonly executor: SqlExecutor = poolExecutor) {}

  private sql(principal: Principal): SqlExecutor {
    return scopedSql(this.executor, principal);
  }

  private assertOwn(principal: Principal, userId: string, write = false): void {
    assertAuthorized(principal, write ? "write" : "read", {
      kind: "mode_state",
      ownerId: userId,
      // Mode state is deliberately mode-agnostic: it is what *decides* the
      // mode, so gating it on the current mode would be circular.
      mode: null,
    });
  }

  /** Null when the user has never been seen — the router's cue to classify. */
  async getState(
    principal: Principal,
    userId: string,
  ): Promise<UserModeState | null> {
    this.assertOwn(principal, userId);
    const rows = await this.sql(principal).query<ModeRow>(SELECT_STATE, [
      userId,
    ]);
    return rows[0] ? toState(rows[0]) : null;
  }

  /** Creates the row if absent. Safe to call on every turn. */
  async ensure(principal: Principal, userId: string): Promise<UserModeState> {
    this.assertOwn(principal, userId, true);
    const rows = await this.sql(principal).query<ModeRow>(UPSERT_USER, [
      userId,
    ]);
    if (!rows[0]) {
      // ON CONFLICT ... RETURNING always returns a row; a missing one means the
      // statement did not run, which must not be mistaken for "no modes".
      throw new ValidationError("agent_users upsert returned no row");
    }
    return toState(rows[0]);
  }

  async setActiveMode(
    principal: Principal,
    userId: string,
    mode: AgentMode,
  ): Promise<UserModeState> {
    this.assertOwn(principal, userId, true);
    const rows = await this.sql(principal).query<ModeRow>(SET_ACTIVE_MODE, [
      userId,
      assertMode(mode),
    ]);
    if (!rows[0]) throw new ValidationError(`no agent_users row for ${userId}`);
    return toState(rows[0]);
  }

  /** Adds a mode to `enrolled_modes`, and makes it active if none was. */
  async enroll(
    principal: Principal,
    userId: string,
    mode: AgentMode,
  ): Promise<UserModeState> {
    this.assertOwn(principal, userId, true);
    const rows = await this.sql(principal).query<ModeRow>(ENROLL, [
      userId,
      [assertMode(mode)],
    ]);
    if (!rows[0]) throw new ValidationError(`no agent_users row for ${userId}`);
    return toState(rows[0]);
  }

  async grantConsent(
    principal: Principal,
    userId: string,
    mode: AgentMode,
  ): Promise<void> {
    this.assertOwn(principal, userId, true);
    await this.sql(principal).query(GRANT_CONSENT, [userId, assertMode(mode)]);
  }

  async consentedModes(
    principal: Principal,
    userId: string,
  ): Promise<AgentMode[]> {
    this.assertOwn(principal, userId);
    const rows = await this.sql(principal).query<{ mode: AgentMode }>(
      SELECT_CONSENT,
      [userId],
    );
    return rows.map((row) => row.mode);
  }

  /** /forget. Cascades to mode_consent. */
  async deleteUser(principal: Principal, userId: string): Promise<void> {
    assertAuthorized(principal, "delete", {
      kind: "mode_state",
      ownerId: userId,
      mode: null,
    });
    await this.sql(principal).query(DELETE_USER, [userId]);
  }
}
