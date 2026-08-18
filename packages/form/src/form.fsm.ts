/**
 * The form state machine — pure, no I/O, no platform types.
 *
 * Same contract as `packages/channel/src/onboarding.fsm.ts`: `advance()` takes
 * the answers so far plus one input and returns the next answers and what to
 * say. It never persists and never renders; it *describes* the effect and the
 * adapter performs it. That is what lets Telegram draw a `Prompt` as an inline
 * keyboard while the engine stays ignorant of Telegram.
 *
 * There is no stored step. The current question is the first field with no
 * answer, so progress is a function of the data — a restart mid-form resumes
 * exactly where it left off, with no bookkeeping column to fall out of sync.
 */

import { matchChoice, optionById } from "@calebx/channel";
import * as copy from "./copy.ts";
import { FORM_FIELDS, SKIPPED, positionOf, sectionLabel } from "./fields.ts";
import { crossValidate, validate } from "./validate.ts";
import type { Answers, FormField } from "./types.ts";

/** What to ask next. The adapter decides how to render it. */
export type Prompt =
  | { kind: "text"; text: string }
  | { kind: "choice"; text: string; field: FormField };

/** One user answer. Adapters map their own payloads onto this. */
export type Input =
  | { kind: "text"; value: string }
  | { kind: "choice"; id: string }
  | { kind: "skip" };

export type Advance =
  /** Every question is answered; this input belongs to a command handler. */
  | { outcome: "complete"; prompts: Prompt[] }
  /** Answer rejected. Nothing changed; re-ask with the reason. */
  | { outcome: "rejected"; prompts: Prompt[] }
  | { outcome: "advanced"; answers: Answers; prompts: Prompt[] };

/** The first unanswered question, or null once the form is finished. */
export function nextField(answers: Answers): FormField | null {
  return FORM_FIELDS.find((field) => answers[field.id] === undefined) ?? null;
}

export function isComplete(answers: Answers): boolean {
  return nextField(answers) === null;
}

/** How many questions have an answer, counting skips. Drives progress copy. */
export function answeredCount(answers: Answers): number {
  return FORM_FIELDS.filter((field) => answers[field.id] !== undefined).length;
}

/** The question for a field, with its progress prefix. */
export function promptForField(field: FormField): Prompt {
  const text = copy.question(
    field,
    positionOf(field),
    sectionLabel(field.section),
  );
  return field.kind === "choice"
    ? { kind: "choice", text, field }
    : { kind: "text", text };
}

/**
 * Applies one input to the current question.
 *
 * A rejected answer returns `rejected` rather than throwing, so the adapter's
 * only job is to send the prompts it is given.
 */
export function advance(answers: Answers, input: Input): Advance {
  const field = nextField(answers);
  if (!field) return { outcome: "complete", prompts: [] };

  if (input.kind === "skip") return skip(answers, field);

  const resolved = resolveValue(field, input);
  if (!resolved.ok) {
    return {
      outcome: "rejected",
      prompts: [
        { kind: "text", text: resolved.message },
        promptForField(field),
      ],
    };
  }

  const checked = crossValidate(field, resolved.value, answers);
  if (!checked.ok) {
    return {
      outcome: "rejected",
      prompts: [{ kind: "text", text: checked.message }, promptForField(field)],
    };
  }

  return applied({ ...answers, [field.id]: checked.value });
}

/** Passes over an optional question, marking the cell so it isn't re-asked. */
export function skip(answers: Answers, field: FormField): Advance {
  if (field.required) {
    return {
      outcome: "rejected",
      prompts: [
        { kind: "text", text: copy.CANNOT_SKIP_REQUIRED },
        promptForField(field),
      ],
    };
  }
  return applied({ ...answers, [field.id]: SKIPPED });
}

/**
 * The `/update` path: rewrite one already-answered field, wherever the user is.
 *
 * Deliberately separate from `advance` — an edit must not move the form's
 * position, and it has to work on a completed profile where `nextField` is null.
 */
export function applyEdit(
  answers: Answers,
  field: FormField,
  input: Input,
): Advance {
  if (input.kind === "skip") {
    return field.required
      ? {
          outcome: "rejected",
          prompts: [
            { kind: "text", text: copy.CANNOT_SKIP_REQUIRED },
            { kind: "text", text: copy.updateAsk(field) },
          ],
        }
      : {
          outcome: "advanced",
          answers: { ...answers, [field.id]: SKIPPED },
          prompts: [{ kind: "text", text: copy.updated(field, SKIPPED) }],
        };
  }

  const resolved = resolveValue(field, input);
  if (!resolved.ok) {
    return {
      outcome: "rejected",
      prompts: [{ kind: "text", text: resolved.message }, editPrompt(field)],
    };
  }

  const checked = crossValidate(field, resolved.value, answers);
  if (!checked.ok) {
    return {
      outcome: "rejected",
      prompts: [{ kind: "text", text: checked.message }, editPrompt(field)],
    };
  }

  return {
    outcome: "advanced",
    answers: { ...answers, [field.id]: checked.value },
    prompts: [{ kind: "text", text: copy.updated(field, checked.value) }],
  };
}

/** The bare question, without the progress prefix an edit shouldn't show. */
export function editPrompt(field: FormField): Prompt {
  const text = copy.updateAsk(field);
  return field.kind === "choice"
    ? { kind: "choice", text, field }
    : { kind: "text", text };
}

/**
 * Turns a platform input into a stored value.
 *
 * Choice fields accept a tapped option id or typed text, the latter via
 * `matchChoice` from `@calebx/channel` — which already handles 1-based
 * positions, persisted values, labels, and en/em dash folding. Unlike the
 * onboarding FSM, typing is accepted here on both channels: a 30-question form
 * is tedious enough without forcing a tap for every choice.
 */
function resolveValue(
  field: FormField,
  input: Extract<Input, { kind: "text" | "choice" }>,
): { ok: true; value: string } | { ok: false; message: string } {
  if (field.kind !== "choice") {
    return input.kind === "text"
      ? validate(field, input.value)
      : { ok: false, message: copy.INVALID_CHOICE };
  }

  const options = field.options ?? [];

  if (input.kind === "choice") {
    const option = optionById(options, input.id);
    return option
      ? { ok: true, value: option.value }
      : { ok: false, message: copy.INVALID_CHOICE };
  }

  const typed = matchChoice(input.value, options);
  return typed
    ? { ok: true, value: typed.value }
    : validate(field, input.value);
}

/** Advances to the next question, or reports completion. */
function applied(answers: Answers): Advance {
  const upcoming = nextField(answers);
  if (!upcoming) {
    return {
      outcome: "advanced",
      answers,
      prompts: [
        { kind: "text", text: copy.completed(answers["full_name"] ?? "") },
      ],
    };
  }

  const prompts: Prompt[] = [];
  if (startsSensitiveSection(answers, upcoming)) {
    prompts.push({ kind: "text", text: copy.CONTACT_SECTION_NOTICE });
  }
  prompts.push(promptForField(upcoming));

  return { outcome: "advanced", answers, prompts };
}

/**
 * True on the transition into the contact section, so the user is told why the
 * bot is asking for a phone number before it asks.
 */
function startsSensitiveSection(
  answers: Answers,
  upcoming: FormField,
): boolean {
  if (upcoming.section !== "contact") return false;
  const index = FORM_FIELDS.findIndex((field) => field.id === upcoming.id);
  const previous = FORM_FIELDS[index - 1];
  return previous === undefined || previous.section !== "contact";
}
