/**
 * TypeScript mirrors of the tables in `migrations/`. Keep these in sync by
 * hand — there is no codegen step, the schema is six small tables.
 */

export type OwnerType = "self" | "family";
export type CandidateState = "active" | "paused" | "married" | "withdrawn";
export type MessageDirection = "inbound" | "outbound";
export type MatchSource = "manual" | "algo";
export type MatchStatus = "pending" | "interested" | "declined";
export type MatchStage =
  | "suggested"
  | "mutual_interest"
  | "contact_shared"
  | "meeting"
  | "progressing"
  | "closed";
export type PhotoVisibility = "hidden" | "on_mutual_interest" | "public";

export interface Candidate {
  id: string;
  wa_phone: string;
  owner_type: OwnerType;
  language: string | null;
  last_active_at: string | null;

  full_name: string | null;
  gender: string | null;
  dob: string | null;
  birth_place: string | null;
  city: string | null;
  complexion: string | null;
  height_cm: number | null;
  marital_status: string | null;
  community: string | null;
  highest_education: string | null;
  occupation: string | null;
  income_band: string | null;
  diet: string | null;
  father_name: string | null;
  father_occupation: string | null;
  mother_name: string | null;
  mother_occupation: string | null;
  brothers: number | null;
  brothers_married: number | null;
  sisters: number | null;
  sisters_married: number | null;

  state: CandidateState;
  profile: Record<string, unknown>;

  created_at: string;
  updated_at: string;
}

/** SENSITIVE — see contact_details.sql. Never serialize this into an outbound payload. */
export interface ContactDetails {
  candidate_id: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  updated_at: string;
}

export interface Message {
  id: string;
  candidate_id: string;
  wa_message_id: string;
  direction: MessageDirection;
  body: string | null;
  created_at: string;
}

export interface PartnerPrefs {
  candidate_id: string;
  age_min: number | null;
  age_max: number | null;
  community_pref: string | null;
  income_min: number | null;
  education_pref: string | null;
  diet_pref: string | null;
  looking_for: string | null;
  pref_tags: unknown[];
  updated_at: string;
}

export interface Match {
  id: string;
  candidate_a: string;
  candidate_b: string;
  source: MatchSource;
  algo_version: string | null;
  score: number | null;
  reason: string | null;
  status_a: MatchStatus;
  status_b: MatchStatus;
  stage: MatchStage;
  created_at: string;
}

export interface Photo {
  id: string;
  candidate_id: string;
  url: string;
  visibility: PhotoVisibility;
  is_primary: boolean;
  uploaded_at: string;
}
