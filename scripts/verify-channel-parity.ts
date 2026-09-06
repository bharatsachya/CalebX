/**
 * Guards the byte-identity contract of `@calebx/channel`.
 *
 * The consent copy, onboarding questions, option ids and — most importantly —
 * the persisted option values and the memory summary were extracted verbatim
 * out of the Telegram bot. Records already on disk and memories already in mem0
 * contain those exact strings, so a well-meaning copy edit can silently orphan
 * a user's answers or make the same fact read two ways to the model.
 *
 * The golden values below are transcribed from the pre-extraction source. They
 * are not derived from the implementation, so this catches drift rather than
 * agreeing with it.
 *
 *   bun run scripts/verify-channel-parity.ts
 */
import * as copy from "../packages/channel/src/copy.ts";
import {
  advance,
  promptForStep,
} from "../packages/channel/src/onboarding.fsm.ts";
import {
  AGE_OPTIONS,
  PURPOSE_OPTIONS,
  matchChoice,
} from "../packages/channel/src/options.ts";
import type { OnboardingRecord } from "../packages/channel/src/onboarding.store.ts";

const HINTS = copy.TELEGRAM_HINTS;
let failures = 0;

function check(name: string, actual: unknown, expected: unknown): void {
  if (actual === expected) {
    console.log(`  ok   ${name}`);
    return;
  }
  failures++;
  console.log(`  FAIL ${name}`);
  console.log(`       expected: ${JSON.stringify(expected)}`);
  console.log(`       actual:   ${JSON.stringify(actual)}`);
}

function section(title: string): void {
  console.log(`\n== ${title} ==`);
}

section("Copy renders byte-identically with Telegram's command hints");
check(
  "privacyNotice",
  copy.privacyNotice(HINTS),
  `👋 Hi, I'm Bettle.

I'm your matchmaking platform designed to help you find your ideal partner.

We're currently in our onboarding phase to gather your details, preferences, and what you value in a partner before matching goes live.

Before we start:
• We store your details and preferences securely.
• They are used solely to curate and identify the best matches for you.
• You're in control: send /forget anytime to erase your details and revoke this.

Tap below to start your onboarding.`,
);
check(
  "ACCEPTED_MESSAGE",
  copy.ACCEPTED_MESSAGE,
  "Great — let me ask you a few quick things first.",
);
check(
  "declinedMessage",
  copy.declinedMessage(HINTS),
  "No problem — I won't store anything. If you change your mind, just send /start.",
);
check(
  "WELCOME_BACK",
  copy.WELCOME_BACK,
  "Welcome back. Pick up wherever you like — what's new?",
);
check(
  "forgottenMessage",
  copy.forgottenMessage(HINTS),
  "Done. I've erased what I'd learned and revoked your consent. Send /start if you ever want to begin again.",
);
check(
  "NEEDS_CONSENT_NUDGE",
  copy.NEEDS_CONSENT_NUDGE,
  "Before I can chat, I need your okay to learn from our conversation.",
);
check(
  "ONBOARDING_NAME_QUESTION",
  copy.ONBOARDING_NAME_QUESTION,
  "What should I call you?",
);
check(
  "onboardingCityQuestion",
  copy.onboardingCityQuestion("Caleb"),
  "Nice to meet you, Caleb! Which city are you based in?",
);
check(
  "ONBOARDING_AGE_QUESTION",
  copy.ONBOARDING_AGE_QUESTION,
  "And roughly how old are you?",
);
check(
  "ONBOARDING_PURPOSE_QUESTION",
  copy.ONBOARDING_PURPOSE_QUESTION,
  "Last one — what kind of connection are you looking for on Bettle?",
);
check(
  "ONBOARDING_SUMMARY_ACK",
  copy.ONBOARDING_SUMMARY_ACK,
  "Got it — I'll keep that in mind.",
);

section("Every onboardingComplete branch");
const expectedComplete =
  "You're all set, Caleb! 🎉 We've saved your profile and partner preferences.\n\nDirect chatting and matching aren't open quite yet, but we're actively reviewing profiles and will notify you as soon as your best matches are ready. Stay tuned!";
check(
  "complete",
  copy.onboardingComplete("Caleb", "meet people"),
  expectedComplete,
);

section("Option ids (platform round-trip) and values (persisted)");
check(
  "age ids",
  AGE_OPTIONS.map((o) => o.id).join("|"),
  "onboarding:age:18-24|onboarding:age:25-34|onboarding:age:35-44|onboarding:age:45+",
);
check(
  "age values",
  AGE_OPTIONS.map((o) => o.value).join("|"),
  "18-24|25-34|35-44|45+",
);
check(
  "purpose ids",
  PURPOSE_OPTIONS.map((o) => o.id).join("|"),
  "onboarding:purpose:meet|onboarding:purpose:places|onboarding:purpose:communities|onboarding:purpose:all",
);
check(
  "purpose values",
  PURPOSE_OPTIONS.map((o) => o.value).join("|"),
  "meet people|discover places|find communities|meet people, discover places, and find communities",
);

section("A full FSM walk produces the expected record and memory");
let record: OnboardingRecord = { step: "pending_name" };
const visited: string[] = [];
for (const input of [
  { kind: "text", value: "Caleb" },
  { kind: "text", value: "Bhiwadi" },
  { kind: "choice", id: "onboarding:age:18-24" },
  { kind: "choice", id: "onboarding:purpose:all" },
] as const) {
  const result = advance(record, input);
  if (result.outcome !== "advanced") {
    failures++;
    console.log(`  FAIL unexpected outcome "${result.outcome}"`);
    break;
  }
  record = result.record;
  visited.push(record.step);
  if (result.memory) {
    check(
      "memory summary",
      result.memory.message,
      "My name is Caleb, I'm 18-24 years old, based in Bhiwadi. I joined Bettle to: meet people, discover places, and find communities.",
    );
    check(
      "memory ack",
      result.memory.response,
      "Got it — I'll keep that in mind.",
    );
  }
}
check(
  "step sequence",
  visited.join(" → "),
  "pending_city → pending_age → pending_purpose → complete",
);
check(
  "final record",
  JSON.stringify(record),
  JSON.stringify({
    step: "complete",
    name: "Caleb",
    city: "Bhiwadi",
    age: "18-24",
    purpose: "meet people, discover places, and find communities",
  }),
);

section("Telegram behaviour preserved exactly");
const at = (step: OnboardingRecord["step"]): OnboardingRecord => ({ step });
check(
  "free text at the age step is swallowed",
  advance(at("pending_age"), { kind: "text", value: "25" }).outcome,
  "ignored",
);
check(
  "free text at the purpose step is swallowed",
  advance(at("pending_purpose"), { kind: "text", value: "x" }).outcome,
  "ignored",
);
check(
  "a stale keyboard tap after completion passes through",
  advance(at("complete"), { kind: "choice", id: "onboarding:age:18-24" })
    .outcome,
  "pass_through",
);
check(
  "an unknown option id is ignored",
  advance(at("pending_age"), { kind: "choice", id: "nope" }).outcome,
  "ignored",
);
check("no prompt once complete", promptForStep(at("complete")), null);

const named = advance(at("pending_name"), { kind: "text", value: "   " });
check(
  "an empty name falls back to 'friend'",
  named.outcome === "advanced" ? named.record.name : undefined,
  "friend",
);
const cityed = advance(at("pending_city"), { kind: "text", value: "" });
check(
  "an empty city falls back to 'your city'",
  cityed.outcome === "advanced" ? cityed.record.city : undefined,
  "your city",
);

section("matchChoice — WhatsApp's typed fallback (never used by Telegram)");
const age = (text: string) => matchChoice(text, AGE_OPTIONS)?.value ?? null;
check("position '2'", age("2"), "25-34");
check("en-dash label '18–24'", age("18–24"), "18-24");
check("hyphen value '35-44'", age("35-44"), "35-44");
check("'45+'", age("45+"), "45+");
check(
  "case-insensitive label",
  matchChoice("Meet People", PURPOSE_OPTIONS)?.value ?? null,
  "meet people",
);
check("out of range low", age("0"), null);
check("out of range high", age("5"), null);
check("gibberish", age("banana"), null);
check("whitespace", age("   "), null);

console.log(
  failures === 0
    ? "\n✅ channel parity verified\n"
    : `\n❌ ${failures} parity failure(s)\n`,
);
process.exitCode = failures === 0 ? 0 : 1;
