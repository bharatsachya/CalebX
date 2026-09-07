/**
 * Questions backed by `contact_details` (`003_contact_details.sql`).
 *
 * SENSITIVE. These values are never shown in any match payload — released only on
 * mutual interest as a manual admin step.
 */

import type { FormField } from "./types.ts";

export const CONTACT_FIELDS: readonly FormField[] = [
  {
    id: "phone",
    section: "contact",
    table: "contact_details",
    kind: "text",
    prompt: "Best phone number to reach you on?",
    required: true,
  },
  {
    id: "email",
    section: "contact",
    table: "contact_details",
    kind: "text",
    prompt: "And an email address?",
    required: false,
  },
] as const;
