/**
 * The multiple-choice onboarding answers, shared by every channel.
 *
 * `id` is what a platform round-trips through its own UI (Telegram
 * `callback_data`, WhatsApp interactive-reply `id`). `value` is what gets
 * persisted and written to memory.
 *
 * IMPORTANT: `id` and `value` are load-bearing across a data migration. Records
 * already on disk contain values like `"18-24"` and
 * `"meet people, discover places, and find communities"`. Changing either field
 * silently orphans existing users' answers.
 */
export interface ChoiceOption {
  /** Stable identifier echoed back by the platform when the user picks this. */
  id: string;
  /** Text shown on the button/row. */
  label: string;
  /** What gets persisted to the onboarding record. */
  value: string;
}

export const AGE_OPTIONS: readonly ChoiceOption[] = [
  { id: "onboarding:age:18-24", label: "18–24", value: "18-24" },
  { id: "onboarding:age:25-34", label: "25–34", value: "25-34" },
  { id: "onboarding:age:35-44", label: "35–44", value: "35-44" },
  { id: "onboarding:age:45+", label: "45+", value: "45+" },
] as const;

export const PURPOSE_OPTIONS: readonly ChoiceOption[] = [
  {
    id: "onboarding:purpose:meet",
    label: "Meet people",
    value: "meet people",
  },
  {
    id: "onboarding:purpose:places",
    label: "Discover places",
    value: "discover places",
  },
  {
    id: "onboarding:purpose:communities",
    label: "Find communities",
    value: "find communities",
  },
  {
    id: "onboarding:purpose:all",
    label: "All of the above ✨",
    value: "meet people, discover places, and find communities",
  },
] as const;

/** Looks up an option by the id a platform echoed back. */
export function optionById(
  options: readonly ChoiceOption[],
  id: string,
): ChoiceOption | null {
  return options.find((option) => option.id === id) ?? null;
}

/**
 * Resolves free text to an option, so a user can type instead of tapping.
 *
 * WhatsApp needs this: its interactive list costs two taps and some clients
 * render it poorly, so typing must always work. Telegram never calls this — its
 * inline keyboard always produces a real `id`, and accepting typed answers there
 * would change long-standing behaviour.
 *
 * Accepts, in order: a 1-based position ("2"), the persisted value ("18-24"),
 * or the visible label ("18–24"). Dashes are normalised because the label uses
 * an en dash while the value uses a hyphen.
 */
export function matchChoice(
  text: string,
  options: readonly ChoiceOption[],
): ChoiceOption | null {
  const normalized = normalize(text);
  if (normalized === "") return null;

  const position = Number(normalized);
  if (
    Number.isInteger(position) &&
    position >= 1 &&
    position <= options.length
  ) {
    return options[position - 1] ?? null;
  }

  return (
    options.find((option) => normalize(option.value) === normalized) ??
    options.find((option) => normalize(option.label) === normalized) ??
    null
  );
}

/** Lowercase, collapse whitespace, and fold en/em dashes down to a hyphen. */
function normalize(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[‒-―]/g, "-") // figure/en/em/horizontal dash → hyphen
    .replace(/\s+/g, " ");
}
