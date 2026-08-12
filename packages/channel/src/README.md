# packages/channel/src

Platform-agnostic conversation logic. No runtime dependencies, no I/O beyond the
local JSON ledgers, no imports from other `@calebx/*` packages.

- `user-id.ts` — namespaced `UserId` (`tg:` / `wa:`) plus constructors and parser
- `consent.store.ts` — `ConsentStatus` and the `ConsentStore` port
- `onboarding.store.ts` — `OnboardingStep` / `OnboardingRecord` and the `OnboardingStore` port
- `json-ledger.ts` — generic atomic file-backed key/value ledger; also performs
  the one-time legacy bare-numeric key migration
- `file-consent.store.ts` — `ConsentStore` over a `JsonLedger`
- `file-onboarding.store.ts` — `OnboardingStore` over a `JsonLedger`
- `options.ts` — `ChoiceOption`, `AGE_OPTIONS`, `PURPOSE_OPTIONS`, `matchChoice()`
- `copy.ts` — every user-facing string
- `onboarding.fsm.ts` — pure `promptForStep()` / `advance()`; returns prompts and
  memory writes for the adapter to perform
- `index.ts` — public re-export
