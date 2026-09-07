/**
 * Questions backed by the `candidates` table (`002_candidates.sql`) — the
 * account preamble, biodata, and family background columns.
 */

import {
  GENDER_OPTIONS,
  INCOME_BAND_OPTIONS,
  MARITAL_STATUS_OPTIONS,
  OCCUPATION_OPTIONS,
  OWNER_TYPE_OPTIONS,
} from "./choices.ts";
import type { FormField } from "./types.ts";

export const CANDIDATE_FIELDS: readonly FormField[] = [
  // ── Getting started ────────────────────────────────────────────────
  {
    id: "owner_type",
    section: "account",
    table: "candidates",
    kind: "choice",
    prompt: "Who are you filling this profile for?",
    options: OWNER_TYPE_OPTIONS,
    required: true,
  },

  // ── About you ──────────────────────────────────────────────────────
  {
    id: "full_name",
    section: "biodata",
    table: "candidates",
    kind: "text",
    prompt: "What should we call you?",
    required: true,
  },
  {
    id: "gender",
    section: "biodata",
    table: "candidates",
    kind: "choice",
    prompt: "What is your gender?",
    options: GENDER_OPTIONS,
    required: true,
  },
  {
    id: "dob",
    section: "biodata",
    table: "candidates",
    kind: "date",
    prompt: "What is your date of birth?",
    hint: "Format: DD/MM/YYYY — for example 14/03/1996",
    required: true,
  },
  {
    id: "city",
    section: "biodata",
    table: "candidates",
    kind: "text",
    prompt: "Which city are you based in?",
    required: true,
  },
  {
    id: "height",
    section: "biodata",
    table: "candidates",
    kind: "integer",
    prompt: "What is your height, in centimetres?",
    hint: "Just the number — for example 170",
    required: false,
    min: 120,
    max: 230,
  },
  {
    id: "marital_status",
    section: "biodata",
    table: "candidates",
    kind: "choice",
    prompt: "What is your marital status?",
    options: MARITAL_STATUS_OPTIONS,
    required: true,
  },
  {
    id: "occupation",
    section: "biodata",
    table: "candidates",
    kind: "choice",
    prompt: "What do you do?",
    options: OCCUPATION_OPTIONS,
    required: true,
  },
  {
    id: "highest_education",
    section: "biodata",
    table: "candidates",
    kind: "text",
    prompt: "What is your highest level of education?",
    hint: "For example: B.Tech, MBA, B.Com, MS",
    required: true,
  },
  {
    id: "income_band",
    section: "biodata",
    table: "candidates",
    kind: "choice",
    prompt: "What is your personal annual income?",
    options: INCOME_BAND_OPTIONS,
    required: false,
  },

  // ── Family ─────────────────────────────────────────────────────────
  {
    id: "family_background",
    section: "family",
    table: "candidates",
    kind: "long_text",
    prompt: "Tell us a little about your family background.",
    hint: "For example, what your family does, business/profession, or anything else relevant.",
    required: false,
  },
] as const;
