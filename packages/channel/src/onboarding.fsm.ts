import * as copy from "./copy.ts";
import {
  AGE_OPTIONS,
  PURPOSE_OPTIONS,
  optionById,
  type ChoiceOption,
} from "./options.ts";
import type { OnboardingRecord } from "./onboarding.store.ts";

/**
 * The onboarding state machine — pure, no I/O, no platform types.
 *
 * `advance()` takes the current record and one user input and returns the next
 * record plus what to say. It never persists anything and never writes memory;
 * it *describes* those effects and the adapter performs them. That is what lets
 * Telegram render a `Prompt` as an inline keyboard and WhatsApp render the same
 * `Prompt` as an interactive list, from one implementation.
 */

/** Which multiple-choice question a prompt belongs to. */
export type ChoiceGroup = "age" | "purpose";

/** What to ask next. The adapter decides how to render it. */
export type Prompt =
  | { kind: "text"; text: string }
  | {
      kind: "choice";
      text: string;
      group: ChoiceGroup;
      options: readonly ChoiceOption[];
    };

/** One user answer. Adapters map typed text to `choice` themselves. */
export type Input =
  { kind: "text"; value: string } | { kind: "choice"; id: string };

/** A memory the adapter should write after applying the new record. */
export interface MemoryWrite {
  message: string;
  response: string;
}

export type Advance =
  /** Onboarding is done; this input belongs to the conversation handler. */
  | { outcome: "pass_through" }
  /** Wrong input shape for this step — say nothing, change nothing. */
  | { outcome: "ignored" }
  | {
      outcome: "advanced";
      record: OnboardingRecord;
      prompts: Prompt[];
      memory?: MemoryWrite;
    };

/** The question for a record's current step, or null once complete. */
export function promptForStep(record: OnboardingRecord): Prompt | null {
  switch (record.step) {
    case "pending_name":
      return { kind: "text", text: copy.ONBOARDING_NAME_QUESTION };
    case "pending_city":
      return {
        kind: "text",
        text: copy.onboardingCityQuestion(record.name ?? "there"),
      };
    case "pending_age":
      return {
        kind: "choice",
        text: copy.ONBOARDING_AGE_QUESTION,
        group: "age",
        options: AGE_OPTIONS,
      };
    case "pending_purpose":
      return {
        kind: "choice",
        text: copy.ONBOARDING_PURPOSE_QUESTION,
        group: "purpose",
        options: PURPOSE_OPTIONS,
      };
    case "complete":
      return null;
  }
}

/** The options offered at a step, or null if it isn't a multiple-choice step. */
export function optionsForStep(
  record: OnboardingRecord,
): readonly ChoiceOption[] | null {
  const prompt = promptForStep(record);
  return prompt?.kind === "choice" ? prompt.options : null;
}

export function advance(record: OnboardingRecord, input: Input): Advance {
  switch (record.step) {
    case "complete":
      return { outcome: "pass_through" };

    case "pending_name": {
      if (input.kind !== "text") return { outcome: "ignored" };
      // Empty input still advances, with a friendly placeholder — long-standing behaviour.
      const name = input.value.trim() || "friend";
      return advanced({ ...record, name, step: "pending_city" });
    }

    case "pending_city": {
      if (input.kind !== "text") return { outcome: "ignored" };
      const city = input.value.trim() || "your city";
      return advanced({ ...record, city, step: "pending_age" });
    }

    case "pending_age": {
      if (input.kind !== "choice") return { outcome: "ignored" };
      const age = optionById(AGE_OPTIONS, input.id);
      if (!age) return { outcome: "ignored" };
      return advanced({ ...record, age: age.value, step: "pending_purpose" });
    }

    case "pending_purpose": {
      if (input.kind !== "choice") return { outcome: "ignored" };
      const purpose = optionById(PURPOSE_OPTIONS, input.id);
      if (!purpose) return { outcome: "ignored" };

      const next: OnboardingRecord = {
        ...record,
        purpose: purpose.value,
        step: "complete",
      };
      return {
        outcome: "advanced",
        record: next,
        prompts: [
          {
            kind: "text",
            text: copy.onboardingComplete(next.name ?? "friend", purpose.value),
          },
        ],
        memory: {
          message: copy.onboardingSummary(next),
          response: copy.ONBOARDING_SUMMARY_ACK,
        },
      };
    }
  }
}

/** Advances to a record whose prompt is simply that step's question. */
function advanced(record: OnboardingRecord): Advance {
  const prompt = promptForStep(record);
  return {
    outcome: "advanced",
    record,
    prompts: prompt ? [prompt] : [],
  };
}
