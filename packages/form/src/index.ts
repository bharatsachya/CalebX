export * from "./form.config.ts";

export {
  advance,
  answeredCount,
  applyEdit,
  editPrompt,
  isComplete,
  nextField,
  promptForField,
  skip,
  type Advance,
  type Input,
  type Prompt,
} from "./form.fsm.ts";

export { crossValidate, validate, type Validation } from "./validate.ts";

export { isSensitive, mergeAnswers, splitAnswers } from "./split.ts";

export { TELEGRAM_USER_ID_COLUMN } from "./sheet.ts";

export type {
  CandidateStore,
  ContactStore,
  IdentityStore,
  MatchStore,
  PhoneMatchResult,
  UserMatchCandidate,
} from "./ports.ts";

export type {
  Answers,
  CandidateProfile,
  ContactRecord,
  FieldKind,
  FormField,
  FormSection,
  FormTable,
  Match,
  SectionId,
} from "./types.ts";
