/**
 * Questions backed by `partner_prefs` (`005_partner_prefs.sql`).
 *
 * Match requirements and hard filters.
 */

import {
  COMMUNITY_REGION_EXCLUSION_OPTIONS,
  DIET_PREF_OPTIONS,
  EDUCATION_PREF_OPTIONS,
  INCOME_MIN_OPTIONS,
  LOCATION_PREF_OPTIONS,
} from "./choices.ts";
import type { FormField } from "./types.ts";

export const PREFERENCE_FIELDS: readonly FormField[] = [
  {
    id: "age_min",
    section: "preferences",
    table: "partner_prefs",
    kind: "integer",
    prompt: "What's the youngest age you'd consider in a partner?",
    hint: "Enter an age (e.g. 24), or /skip if no preference",
    required: false,
    min: 18,
    max: 100,
  },
  {
    id: "age_max",
    section: "preferences",
    table: "partner_prefs",
    kind: "integer",
    prompt: "And the oldest?",
    hint: "Enter an age (e.g. 30), or /skip if no preference",
    required: false,
    min: 18,
    max: 100,
  },
  {
    id: "location_pref",
    section: "preferences",
    table: "partner_prefs",
    kind: "choice",
    prompt: "Where would you be comfortable with your partner being based?",
    options: LOCATION_PREF_OPTIONS,
    required: false,
  },
  {
    id: "community_region_exclusion",
    section: "preferences",
    table: "partner_prefs",
    kind: "choice",
    prompt: "Are there any communities or regions you would not consider?",
    options: COMMUNITY_REGION_EXCLUSION_OPTIONS,
    required: false,
  },
  {
    id: "income_min",
    section: "preferences",
    table: "partner_prefs",
    kind: "choice",
    prompt: "Is there a minimum income you would prefer for your partner?",
    options: INCOME_MIN_OPTIONS,
    required: false,
  },
  {
    id: "education_pref",
    section: "preferences",
    table: "partner_prefs",
    kind: "choice",
    prompt: "Is there an education level you prefer in your partner?",
    options: EDUCATION_PREF_OPTIONS,
    required: false,
  },
  {
    id: "diet_pref",
    section: "preferences",
    table: "partner_prefs",
    kind: "choice",
    prompt: "Do you have a preference regarding your partner's diet?",
    options: DIET_PREF_OPTIONS,
    required: false,
  },
] as const;
