/**
 * Option tables for every multiple-choice question.
 *
 * `id` is what Telegram round-trips as `callback_data`; `value` is what lands in
 * the sheet cell. The `form:<field>:<value>` id convention matches
 * `packages/channel/src/options.ts`, and the same warning applies: both fields
 * are load-bearing across a data migration. Changing a `value` orphans every
 * answer already in the sheet.
 *
 * Where the migration defines an enum — `owner_type`, `marital_status` in
 * `001_extensions_and_enums.sql` — the `value` strings are copied verbatim from
 * `packages/db/src/types.ts` so importing the sheet into Postgres needs no
 * translation. The rest are `text` columns, so these lists are a UX choice, not
 * a schema constraint.
 */

import type { ChoiceOption } from "@calebx/channel";

/** Mirrors `OwnerType`. Who is actually filling the form in. */
export const OWNER_TYPE_OPTIONS: readonly ChoiceOption[] = [
  { id: "form:owner_type:self", label: "Myself", value: "self" },
  { id: "form:owner_type:family", label: "A family member", value: "family" },
] as const;

export const GENDER_OPTIONS: readonly ChoiceOption[] = [
  { id: "form:gender:female", label: "Female", value: "female" },
  { id: "form:gender:male", label: "Male", value: "male" },
  { id: "form:gender:other", label: "Other", value: "other" },
] as const;

/**
 * Mirrors `MaritalStatus` — minus `married` and `single`.
 *
 * `002_candidates.sql` has a CHECK constraint rejecting a married candidate and
 * `packages/db/src/candidates.repo.ts:9` mirrors it at the repository layer.
 * Not offering the option is the first line of defence; `validate.ts` rejects it
 * if someone types it anyway.
 *
 * `single` stays a valid value in the `marital_status` enum
 * (`001_extensions_and_enums.sql`) but isn't offered here — it's redundant
 * with `never_married` for this form's purposes, and offering both just makes
 * the same fact answerable two ways.
 */
export const MARITAL_STATUS_OPTIONS: readonly ChoiceOption[] = [
  {
    id: "form:marital_status:never_married",
    label: "Never married",
    value: "never_married",
  },
  { id: "form:marital_status:divorced", label: "Divorced", value: "divorced" },
  { id: "form:marital_status:widowed", label: "Widowed", value: "widowed" },
] as const;

export const COMPLEXION_OPTIONS: readonly ChoiceOption[] = [
  { id: "form:complexion:fair", label: "Fair", value: "fair" },
  { id: "form:complexion:wheatish", label: "Wheatish", value: "wheatish" },
  { id: "form:complexion:medium", label: "Medium", value: "medium" },
  { id: "form:complexion:dusky", label: "Dusky", value: "dusky" },
] as const;

export const INCOME_BAND_OPTIONS: readonly ChoiceOption[] = [
  { id: "form:income_band:under_5l", label: "Under ₹5L", value: "under_5l" },
  { id: "form:income_band:5_10l", label: "₹5L – ₹10L", value: "5_10l" },
  { id: "form:income_band:10_20l", label: "₹10L – ₹20L", value: "10_20l" },
  { id: "form:income_band:20_50l", label: "₹20L – ₹50L", value: "20_50l" },
  { id: "form:income_band:50l_plus", label: "₹50L+", value: "50l_plus" },
  {
    id: "form:income_band:undisclosed",
    label: "Rather not say",
    value: "undisclosed",
  },
] as const;

export const DIET_OPTIONS: readonly ChoiceOption[] = [
  { id: "form:diet:vegetarian", label: "Vegetarian", value: "vegetarian" },
  { id: "form:diet:eggetarian", label: "Eggetarian", value: "eggetarian" },
  {
    id: "form:diet:non_vegetarian",
    label: "Non-vegetarian",
    value: "non_vegetarian",
  },
  { id: "form:diet:vegan", label: "Vegan", value: "vegan" },
  { id: "form:diet:jain", label: "Jain", value: "jain" },
] as const;

/** The same list as `DIET_OPTIONS`, plus an explicit opt-out. */
export const DIET_PREF_OPTIONS: readonly ChoiceOption[] = [
  { id: "form:diet_pref:vegetarian", label: "Vegetarian", value: "vegetarian" },
  { id: "form:diet_pref:eggetarian", label: "Eggetarian", value: "eggetarian" },
  {
    id: "form:diet_pref:non_vegetarian",
    label: "Non-vegetarian",
    value: "non_vegetarian",
  },
  { id: "form:diet_pref:vegan", label: "Vegan", value: "vegan" },
  { id: "form:diet_pref:jain", label: "Jain", value: "jain" },
  {
    id: "form:diet_pref:no_preference",
    label: "No preference",
    value: "no_preference",
  },
] as const;
