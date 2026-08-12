/**
 * Questions backed by `contact_details` (`003_contact_details.sql`).
 *
 * SENSITIVE. That migration is explicit: these values "must never appear in any
 * candidate or match payload sent to another user — released only on mutual
 * interest, and that release is a manual admin step, never automatic."
 *
 * Two structural consequences, both deliberate:
 *   - they are stored in their own sheet tab, not alongside the biodata;
 *   - `MatchStore` has no way to reach them, so the `/match` renderer cannot
 *     leak them even by mistake.
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
  {
    id: "address",
    section: "contact",
    table: "contact_details",
    kind: "long_text",
    prompt: "What's your address?",
    required: false,
  },
] as const;
