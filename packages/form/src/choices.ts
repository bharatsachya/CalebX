/**
 * Option tables for every multiple-choice question.
 *
 * `id` is what Telegram round-trips as `callback_data`; `value` is what lands in
 * the sheet cell. The `form:<field>:<value>` id convention matches
 * `packages/channel/src/options.ts`, and the same warning applies: both fields
 * are load-bearing across a data migration. Changing a `value` orphans every
 * answer already in the sheet.
 */

import type { ChoiceOption } from "@calebx/channel";

/** Who is filling this profile in. */
export const OWNER_TYPE_OPTIONS: readonly ChoiceOption[] = [
  { id: "form:owner_type:self", label: "Myself", value: "self" },
  { id: "form:owner_type:child", label: "My child", value: "child" },
  { id: "form:owner_type:sibling", label: "My sibling", value: "sibling" },
  { id: "form:owner_type:other", label: "Friend or other", value: "other" },
] as const;

export const GENDER_OPTIONS: readonly ChoiceOption[] = [
  { id: "form:gender:male", label: "Male", value: "male" },
  { id: "form:gender:female", label: "Female", value: "female" },
] as const;

export const MARITAL_STATUS_OPTIONS: readonly ChoiceOption[] = [
  {
    id: "form:marital_status:never_married",
    label: "Never married",
    value: "never_married",
  },
  { id: "form:marital_status:divorced", label: "Divorced", value: "divorced" },
  { id: "form:marital_status:widowed", label: "Widowed", value: "widowed" },
  {
    id: "form:marital_status:awaiting_divorce",
    label: "Awaiting divorce",
    value: "awaiting_divorce",
  },
] as const;

export const OCCUPATION_OPTIONS: readonly ChoiceOption[] = [
  { id: "form:occupation:employee", label: "Employee", value: "employee" },
  {
    id: "form:occupation:professional",
    label: "Professional",
    value: "professional",
  },
  {
    id: "form:occupation:business_owner",
    label: "Business owner",
    value: "business_owner",
  },
  {
    id: "form:occupation:entrepreneur",
    label: "Entrepreneur",
    value: "entrepreneur",
  },
  {
    id: "form:occupation:family_business",
    label: "Family business",
    value: "family_business",
  },
  {
    id: "form:occupation:freelancer_self_employed",
    label: "Freelancer or self-employed",
    value: "freelancer_self_employed",
  },
  { id: "form:occupation:student", label: "Student", value: "student" },
  { id: "form:occupation:other", label: "Other", value: "other" },
] as const;

export const INCOME_BAND_OPTIONS: readonly ChoiceOption[] = [
  { id: "form:income_band:under_5l", label: "<₹5L", value: "under_5l" },
  { id: "form:income_band:5_10l", label: "₹5–10L", value: "5_10l" },
  { id: "form:income_band:10_20l", label: "₹10–20L", value: "10_20l" },
  { id: "form:income_band:20_50l", label: "₹20–50L", value: "20_50l" },
  { id: "form:income_band:50l_plus", label: "₹50L+", value: "50l_plus" },
] as const;

export const LOCATION_PREF_OPTIONS: readonly ChoiceOption[] = [
  {
    id: "form:location_pref:same_city",
    label: "Same city",
    value: "same_city",
  },
  {
    id: "form:location_pref:specific_cities",
    label: "Specific cities",
    value: "specific_cities",
  },
  {
    id: "form:location_pref:anywhere_india",
    label: "Anywhere in India",
    value: "anywhere_india",
  },
  {
    id: "form:location_pref:open_to_relocation",
    label: "Open to relocation",
    value: "open_to_relocation",
  },
  { id: "form:location_pref:other", label: "Other", value: "other" },
] as const;

export const COMMUNITY_REGION_EXCLUSION_OPTIONS: readonly ChoiceOption[] = [
  {
    id: "form:community_region_exclusion:no_exclusions",
    label: "No exclusions",
    value: "no_exclusions",
  },
  {
    id: "form:community_region_exclusion:select_exclusions",
    label: "Select community or region(s)",
    value: "select_exclusions",
  },
  {
    id: "form:community_region_exclusion:other",
    label: "Other",
    value: "other",
  },
] as const;

export const INCOME_MIN_OPTIONS: readonly ChoiceOption[] = [
  {
    id: "form:income_min:no_preference",
    label: "No preference",
    value: "no_preference",
  },
  { id: "form:income_min:5l_plus", label: "₹5L+", value: "5l_plus" },
  { id: "form:income_min:10l_plus", label: "₹10L+", value: "10l_plus" },
  { id: "form:income_min:20l_plus", label: "₹20L+", value: "20l_plus" },
  { id: "form:income_min:50l_plus", label: "₹50L+", value: "50l_plus" },
] as const;

export const EDUCATION_PREF_OPTIONS: readonly ChoiceOption[] = [
  {
    id: "form:education_pref:no_preference",
    label: "No preference",
    value: "no_preference",
  },
  {
    id: "form:education_pref:bachelors_plus",
    label: "Bachelor's+",
    value: "bachelors_plus",
  },
  {
    id: "form:education_pref:masters_plus",
    label: "Master's+",
    value: "masters_plus",
  },
  {
    id: "form:education_pref:specific_field",
    label: "Specific field",
    value: "specific_field",
  },
  { id: "form:education_pref:other", label: "Other", value: "other" },
] as const;

export const DIET_PREF_OPTIONS: readonly ChoiceOption[] = [
  {
    id: "form:diet_pref:no_preference",
    label: "No preference",
    value: "no_preference",
  },
  {
    id: "form:diet_pref:vegetarian",
    label: "Vegetarian",
    value: "vegetarian",
  },
  {
    id: "form:diet_pref:eggetarian",
    label: "Eggetarian",
    value: "eggetarian",
  },
  {
    id: "form:diet_pref:non_vegetarian",
    label: "Non-vegetarian",
    value: "non_vegetarian",
  },
  { id: "form:diet_pref:vegan", label: "Vegan", value: "vegan" },
  { id: "form:diet_pref:jain", label: "Jain", value: "jain" },
  { id: "form:diet_pref:other", label: "Other", value: "other" },
] as const;
