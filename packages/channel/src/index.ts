export * as copy from "./copy.ts";

export {
  CHANNEL_LABELS,
  LEGACY_NUMERIC,
  channelLabel,
  parseUserId,
  telegramUserId,
  whatsappUserId,
  type Channel,
  type UserId,
} from "./user-id.ts";

export type { ConsentStatus, ConsentStore } from "./consent.store.ts";
export {
  DEFAULT_ONBOARDING_RECORD,
  type OnboardingRecord,
  type OnboardingStep,
  type OnboardingStore,
} from "./onboarding.store.ts";

export { JsonLedger } from "./json-ledger.ts";
export { FileConsentStore } from "./file-consent.store.ts";
export { FileOnboardingStore } from "./file-onboarding.store.ts";

export {
  AGE_OPTIONS,
  PURPOSE_OPTIONS,
  matchChoice,
  optionById,
  type ChoiceOption,
} from "./options.ts";

export {
  advance,
  optionsForStep,
  promptForStep,
  type Advance,
  type ChoiceGroup,
  type Input,
  type MemoryWrite,
  type Prompt,
} from "./onboarding.fsm.ts";

export {
  isPhoneMatch,
  isValidPhone,
  maskPhone,
  normalizePhone,
} from "./phone.ts";
