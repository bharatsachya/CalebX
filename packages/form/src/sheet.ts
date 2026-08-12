/**
 * The spreadsheet layout: tab names, bookkeeping columns, and the hand-curated
 * Matches columns.
 *
 * Nothing here touches Google's API — `@calebx/sheets` reads these constants and
 * does the I/O. Keeping the layout in the domain package is what lets the init
 * script, the stores, and the renderer agree on column names without importing
 * each other.
 */

import { PUBLIC_FIELDS, SENSITIVE_FIELDS } from "./fields.ts";

export const SHEET_TABS = {
  /** Biodata + family + partner preferences. Written by the bot. */
  candidates: "Candidates",
  /** SENSITIVE. Written by the bot, never read by the match path. */
  contacts: "Contacts",
  /** Written by hand. Only ever read. */
  matches: "Matches",
} as const;

/** Columns every tab is keyed by. Namespaced `tg:123`, never a bare platform id. */
export const USER_ID_COLUMN = "user_id";

/** Bookkeeping columns on `Candidates`, ahead of the question columns. */
export const CANDIDATE_META_COLUMNS = [
  USER_ID_COLUMN,
  "created_at",
  "updated_at",
  "consent_granted",
] as const;

/**
 * The Matches columns, mirroring `006_matches.sql`.
 *
 * Absent by construction: anything from `contact_details`. That migration
 * releases contact info only on mutual interest, as a manual admin step — so
 * there is no column here for it to travel in.
 *
 * Also absent is the `candidate_a < candidate_b` canonical ordering. That
 * constraint exists to make pair-uniqueness expressible in SQL; in a flat
 * hand-curated sheet you simply write one row per (user, suggestion).
 *
 * `label` is what the user sees; `id` is the sheet header. Add a column here,
 * re-run `sheets:init`, and it renders with no code change.
 */
export const MATCH_COLUMNS = [
  { id: "matched_name", label: "Name" },
  { id: "matched_age", label: "Age" },
  { id: "matched_city", label: "City" },
  { id: "matched_occupation", label: "Work" },
  { id: "matched_community", label: "Community" },
  { id: "score", label: "Score" },
  { id: "stage", label: "Stage" },
  { id: "status", label: "Status" },
] as const;

/**
 * Rendered on its own, under the columns above.
 *
 * `006_matches.sql`: "`reason` is human-written and is what the parent actually
 * reads." It gets the emphasis it deserves rather than being one field in a list.
 */
export const MATCH_REASON_COLUMN = "reason";

/** Full header row for each tab, in order. */
export const CANDIDATE_HEADERS: readonly string[] = [
  ...CANDIDATE_META_COLUMNS,
  ...PUBLIC_FIELDS.map((field) => field.id),
];

export const CONTACT_HEADERS: readonly string[] = [
  USER_ID_COLUMN,
  "updated_at",
  ...SENSITIVE_FIELDS.map((field) => field.id),
];

export const MATCH_HEADERS: readonly string[] = [
  USER_ID_COLUMN,
  ...MATCH_COLUMNS.map((column) => column.id),
  MATCH_REASON_COLUMN,
];
