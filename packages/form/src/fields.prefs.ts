/**
 * Questions backed by `partner_prefs` (`005_partner_prefs.sql`).
 *
 * The structured columns are described there as hard gates a match must
 * satisfy; `looking_for` is a soft signal. In this prototype nothing filters
 * automatically — you read these while curating the Matches tab by hand.
 */

import { DIET_PREF_OPTIONS } from "./choices.ts";
import type { FormField } from "./types.ts";

export const PREFERENCE_FIELDS: readonly FormField[] = [
  {
    id: "age_min",
    section: "preferences",
    table: "partner_prefs",
    kind: "integer",
    prompt: "What's the youngest age you'd consider in a partner?",
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
    required: false,
    min: 18,
    max: 100,
  },
  {
    id: "community_pref",
    section: "preferences",
    table: "partner_prefs",
    kind: "text",
    prompt: "Any community preference?",
    hint: "For example: Garg (Mangal) — community name, gotra in brackets. Type 'any' if it doesn't matter",
    required: false,
  },
  {
    id: "income_min",
    section: "preferences",
    table: "partner_prefs",
    kind: "integer",
    prompt: "Minimum annual income you'd expect, in lakhs?",
    hint: "Just the number — for example 10. Enter 0 for no minimum",
    required: false,
    min: 0,
    max: 10000,
  },
  {
    id: "education_pref",
    section: "preferences",
    table: "partner_prefs",
    kind: "text",
    prompt: "Any education preference?",
    hint: "Type 'any' if it doesn't matter",
    required: false,
  },
  {
    id: "diet_pref",
    section: "preferences",
    table: "partner_prefs",
    kind: "choice",
    prompt: "Diet preference for a partner?",
    options: DIET_PREF_OPTIONS,
    required: false,
  },
  {
    id: "looking_for",
    section: "preferences",
    table: "partner_prefs",
    kind: "long_text",
    prompt: "Last one — in your own words, who are you hoping to meet?",
    hint: "A sentence or two is plenty",
    required: false,
  },
] as const;
