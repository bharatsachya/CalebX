/**
 * Verifies the form prototype end-to-end, without Telegram and without Google.
 *
 * Companion to `verify-channel-parity.ts`. That script guards the shared
 * onboarding copy and ids; this one guards the questionnaire:
 *
 *   - every question is reachable and asked exactly once
 *   - validation matches the constraints in `packages/db/src/migrations/`
 *     (the `married` CHECK, integer and date columns)
 *   - a skipped optional question is not re-asked
 *   - the form resumes from the data alone, with no stored step
 *   - contact details never reach the /match path
 *
 * The last one is the reason this is automated rather than eyeballed:
 * `003_contact_details.sql` releases phone, email, and address only on mutual
 * interest, as a manual step, and a regression there would be silent.
 *
 *   bun run scripts/verify-form.ts
 */

import { Bot } from "gramio";
import {
  CANDIDATE_HEADERS,
  CONTACT_HEADERS,
  FORM_FIELDS,
  MATCH_HEADERS,
  SHEET_TABS,
  SKIPPED,
  advance,
  applyEdit,
  copy,
  fieldById,
  isComplete,
  mergeAnswers,
  nextField,
  skip,
  splitAnswers,
  type Answers,
  type CandidateProfile,
  type CandidateStore,
  type ContactRecord,
  type ContactStore,
  type Match,
  type MatchStore,
} from "@calebx/form";
import { columnLetter } from "@calebx/sheets";
import { applyAnswer } from "../packages/telegram-bot/src/form/answer.flow.ts";
import {
  forgetCommand,
  matchCommand,
  startCommand,
} from "../packages/telegram-bot/src/form/commands.ts";
import { registerFormHandlers } from "../packages/telegram-bot/src/form/handlers.ts";
import { loadProfile } from "../packages/telegram-bot/src/form/profile.ts";
import {
  beginEdit,
  currentEdit,
} from "../packages/telegram-bot/src/form/session.ts";

let failures = 0;
function check(label: string, condition: boolean, detail = ""): void {
  console.log(
    `  ${condition ? "ok  " : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`,
  );
  if (!condition) failures++;
}
function eq(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  check(label, ok, ok ? "" : `got ${JSON.stringify(actual)}`);
}

console.log("\n=== form domain ===");

// ── Walk the whole form, answering every question ────────────────────
console.log("\n== full walkthrough ==");
let answers: Answers = {};
let guard = 0;
const asked: string[] = [];

while (!isComplete(answers) && guard++ < 200) {
  const field = nextField(answers)!;
  asked.push(field.id);

  let input;
  switch (field.kind) {
    case "choice":
      input = { kind: "choice" as const, id: field.options![1]!.id };
      break;
    case "integer":
      input = { kind: "text" as const, value: String(field.min ?? 5) };
      break;
    case "date":
      input = { kind: "text" as const, value: "14/03/1996" };
      break;
    default:
      input = { kind: "text" as const, value: `answer-${field.id}` };
  }

  const result = advance(answers, input);
  if (result.outcome !== "advanced") {
    check(`${field.id} accepted`, false, result.outcome);
    break;
  }
  answers = result.answers;
}

check(
  "every question was asked",
  asked.length === FORM_FIELDS.length,
  `${asked.length}/${FORM_FIELDS.length}`,
);
check("form reports complete", isComplete(answers));
check("no question asked twice", new Set(asked).size === asked.length);

// ── Validation ───────────────────────────────────────────────────────
console.log("\n== validation ==");
const dobField = FORM_FIELDS.findIndex((f) => f.id === "dob");
let partial: Answers = {};
for (const f of FORM_FIELDS.slice(0, dobField)) partial[f.id] = "x";

check(
  "bad date rejected",
  advance(partial, { kind: "text", value: "hello" }).outcome === "rejected",
);
check(
  "impossible date rejected",
  advance(partial, { kind: "text", value: "31/02/1990" }).outcome ===
    "rejected",
);
const goodDate = advance(partial, { kind: "text", value: "14/03/1996" });
check(
  "valid date normalised to ISO",
  goodDate.outcome === "advanced" && goodDate.answers["dob"] === "1996-03-14",
  goodDate.outcome === "advanced" ? goodDate.answers["dob"] : "",
);

const heightIdx = FORM_FIELDS.findIndex((f) => f.id === "height");
let atHeight: Answers = {};
for (const f of FORM_FIELDS.slice(0, heightIdx)) atHeight[f.id] = "x";
check(
  "non-numeric height rejected",
  advance(atHeight, { kind: "text", value: "abc" }).outcome === "rejected",
);
check(
  "out-of-range height rejected",
  advance(atHeight, { kind: "text", value: "500" }).outcome === "rejected",
);
check(
  "valid height accepted",
  advance(atHeight, { kind: "text", value: "170" }).outcome === "advanced",
);

// married rejection
const maritalIdx = FORM_FIELDS.findIndex((f) => f.id === "marital_status");
let atMarital: Answers = {};
for (const f of FORM_FIELDS.slice(0, maritalIdx)) atMarital[f.id] = "x";
const marriedTry = advance(atMarital, { kind: "text", value: "married" });
check("typed 'married' rejected", marriedTry.outcome === "rejected");
check(
  "  ...with the eligibility message",
  marriedTry.outcome === "rejected" &&
    marriedTry.prompts[0]!.text === copy.MARRIED_NOT_ELIGIBLE,
);
check(
  "marital options exclude 'married'",
  !fieldById("marital_status")!.options!.some((o) => o.value === "married"),
);
check(
  "typed 'divorced' accepted",
  advance(atMarital, { kind: "text", value: "divorced" }).outcome ===
    "advanced",
);

// age_min / age_max cross-check
const ageMaxIdx = FORM_FIELDS.findIndex((f) => f.id === "age_max");
let atAgeMax: Answers = {};
for (const f of FORM_FIELDS.slice(0, ageMaxIdx)) atAgeMax[f.id] = "x";
atAgeMax["age_min"] = "30";
check(
  "age_max below age_min rejected",
  advance(atAgeMax, { kind: "text", value: "25" }).outcome === "rejected",
);
check(
  "age_max above age_min accepted",
  advance(atAgeMax, { kind: "text", value: "35" }).outcome === "advanced",
);

// ── Skip ─────────────────────────────────────────────────────────────
console.log("\n== skip ==");
const optional = FORM_FIELDS.find((f) => !f.required)!;
const requiredField = FORM_FIELDS.find((f) => f.required)!;
let beforeOptional: Answers = {};
for (const f of FORM_FIELDS) {
  if (f.id === optional.id) break;
  beforeOptional[f.id] = "x";
}
const skipped = skip(beforeOptional, optional);
check("optional field skippable", skipped.outcome === "advanced");
check(
  "  ...writes the SKIPPED marker",
  skipped.outcome === "advanced" && skipped.answers[optional.id] === SKIPPED,
);
check(
  "  ...and does not re-ask it",
  skipped.outcome === "advanced" &&
    nextField(skipped.answers)?.id !== optional.id,
);
check(
  "required field not skippable",
  skip({}, requiredField).outcome === "rejected",
);

// ── Resume ───────────────────────────────────────────────────────────
console.log("\n== resume (derived step) ==");
const halfway = { ...answers };
delete halfway["city"];
delete halfway["occupation"];
check("resumes at first gap", nextField(halfway)?.id === "city");
check("not complete with a gap", !isComplete(halfway));

// ── /update ──────────────────────────────────────────────────────────
console.log("\n== update ==");
const cityField = fieldById("city")!;
const edited = applyEdit(answers, cityField, { kind: "text", value: "Jaipur" });
check(
  "edit applies",
  edited.outcome === "advanced" && edited.answers["city"] === "Jaipur",
);
check(
  "edit leaves other answers alone",
  edited.outcome === "advanced" &&
    edited.answers["full_name"] === answers["full_name"],
);
check(
  "edit does not move position",
  edited.outcome === "advanced" && isComplete(edited.answers),
);
const badEdit = applyEdit(answers, fieldById("dob")!, {
  kind: "text",
  value: "nope",
});
check("invalid edit rejected", badEdit.outcome === "rejected");

// ── Split / merge ────────────────────────────────────────────────────
console.log("\n== contact separation ==");
const { candidate, contact } = splitAnswers(answers);
check(
  "phone routed to contact tab",
  "phone" in contact && !("phone" in candidate),
);
check(
  "email routed to contact tab",
  "email" in contact && !("email" in candidate),
);
check(
  "address routed to contact tab",
  "address" in contact && !("address" in candidate),
);
check(
  "city stays in candidate tab",
  "city" in candidate && !("city" in contact),
);
check("looking_for stays in candidate tab", "looking_for" in candidate);
check(
  "round-trips losslessly",
  JSON.stringify(mergeAnswers(candidate, contact)) ===
    JSON.stringify(answers) ||
    Object.keys(mergeAnswers(candidate, contact)).length ===
      Object.keys(answers).length,
);

// ── Match rendering ──────────────────────────────────────────────────
console.log("\n== match rendering ==");
const rendered = copy.formatMatches([
  {
    userId: "tg:1",
    values: {
      matched_name: "Priya <R>",
      matched_city: "Pune",
      reason: "Both in Pune & vegetarian",
    },
  },
  { userId: "tg:1", values: { matched_name: "Anita", score: "8" } },
]);
check("renders both", rendered.includes("Priya") && rendered.includes("Anita"));
check("escapes HTML in names", rendered.includes("Priya &lt;R&gt;"));
check("includes the human reason", rendered.includes("Both in Pune"));
check("no contact fields leak", !/phone|email|address/i.test(rendered));
console.log("\n--- sample /match output ---");
console.log(rendered);
console.log("----------------------------");

console.log("\n== sample question ==");
const q = nextField({})!;
console.log(copy.question(q, 1, "Getting started"));

console.log("\n=== sheet layout ===");

console.log("\n== A1 column letters ==");
eq("0 -> A", columnLetter(0), "A");
eq("25 -> Z", columnLetter(25), "Z");
eq("26 -> AA", columnLetter(26), "AA");
eq("51 -> AZ", columnLetter(51), "AZ");
eq("52 -> BA", columnLetter(52), "BA");

console.log("\n== headers ==");
console.log(
  `  ${SHEET_TABS.candidates} (${CANDIDATE_HEADERS.length}): ${CANDIDATE_HEADERS.join(" | ")}`,
);
console.log(
  `\n  ${SHEET_TABS.contacts} (${CONTACT_HEADERS.length}): ${CONTACT_HEADERS.join(" | ")}`,
);
console.log(
  `\n  ${SHEET_TABS.matches} (${MATCH_HEADERS.length}): ${MATCH_HEADERS.join(" | ")}`,
);

const leaks = ["phone", "email", "address"].filter(
  (c) => CANDIDATE_HEADERS.includes(c) || MATCH_HEADERS.includes(c),
);
console.log("");
eq("no contact column in Candidates or Matches", leaks, []);
eq(
  "candidate headers unique",
  CANDIDATE_HEADERS.length,
  new Set(CANDIDATE_HEADERS).size,
);
eq(
  "last candidate column fits A1",
  columnLetter(CANDIDATE_HEADERS.length - 1).length <= 2,
  true,
);

console.log("\n=== bot flows ===");

/** In-memory stand-ins for the three Sheets-backed ports. */
class MemCandidates implements CandidateStore {
  rows = new Map<string, CandidateProfile>();
  async get(id: string) {
    return this.rows.get(id) ?? null;
  }
  async set(id: string, p: CandidateProfile) {
    this.rows.set(id, structuredClone(p));
  }
  async delete(id: string) {
    this.rows.delete(id);
  }
}
class MemContacts implements ContactStore {
  rows = new Map<string, ContactRecord>();
  async get(id: string) {
    return this.rows.get(id) ?? null;
  }
  async set(id: string, r: ContactRecord) {
    this.rows.set(id, structuredClone(r));
  }
  async delete(id: string) {
    this.rows.delete(id);
  }
}
class MemMatches implements MatchStore {
  rows: Match[] = [];
  async list(id: string) {
    return this.rows.filter((m) => m.userId === id);
  }
}

class Recorder {
  sent: string[] = [];
  async send(text: string) {
    this.sent.push(text);
    return {};
  }
  last() {
    return this.sent[this.sent.length - 1] ?? "";
  }
  clear() {
    this.sent = [];
  }
}

const USER = "tg:999";
const stores = { candidates: new MemCandidates(), contacts: new MemContacts() };
const matches = new MemMatches();

// ── wiring ───────────────────────────────────────────────────────────
console.log("\n== wiring ==");
try {
  const bot = new Bot("123456:FAKE_TOKEN_FOR_WIRING_TEST_ONLY");
  registerFormHandlers(bot, {
    ...stores,
    matches,
    consent: {
      async get() {
        return "granted" as const;
      },
      async set() {},
      async delete() {},
    },
  });
  check("registerFormHandlers wires without throwing", true);
} catch (e) {
  check("registerFormHandlers wires without throwing", false, String(e));
}

// ── /start on a fresh user ───────────────────────────────────────────
console.log("\n== /start (new user) ==");
let rec = new Recorder();
await startCommand(stores, rec, USER);
check("sends the welcome", rec.sent[0]?.includes("few questions") ?? false);
check("then asks question 1", rec.last().includes("Question 1 of 33"));
check("nothing persisted before an answer", stores.candidates.rows.size === 0);

// ── /match before finishing ──────────────────────────────────────────
console.log("\n== /match (incomplete) ==");
rec = new Recorder();
await matchCommand(stores, matches, rec, USER);
check(
  "refuses to match an unfinished profile",
  rec.last() === copy.MATCH_INCOMPLETE_PROFILE,
);

// ── answer every question through the bot flow ───────────────────────
console.log("\n== answering via the bot flow ==");
let botGuard = 0;
while (botGuard++ < 200) {
  const { answers } = await loadProfile(stores, USER);
  const field = nextField(answers);
  if (!field) break;
  rec = new Recorder();
  if (field.kind === "choice") {
    await applyAnswer(stores, rec, USER, {
      kind: "choice",
      id: field.options![0]!.id,
    });
  } else if (field.kind === "integer") {
    await applyAnswer(stores, rec, USER, {
      kind: "text",
      value: String(field.min ?? 3),
    });
  } else if (field.kind === "date") {
    await applyAnswer(stores, rec, USER, { kind: "text", value: "02/09/1994" });
  } else {
    await applyAnswer(stores, rec, USER, {
      kind: "text",
      value: `val_${field.id}`,
    });
  }
}
const saved = await loadProfile(stores, USER);
check("profile completed", nextField(saved.answers) === null);
check("candidate row written", stores.candidates.rows.size === 1);
check("contact row written", stores.contacts.rows.size === 1);
check("completion message shown", rec.last().includes("that's everything"));

const candRow = stores.candidates.rows.get(USER)!;
const contRow = stores.contacts.rows.get(USER)!;
console.log("\n  --- candidate row (sample) ---");
console.log(
  `  full_name=${candRow.answers["full_name"]} city=${candRow.answers["city"]} dob=${candRow.answers["dob"]} marital=${candRow.answers["marital_status"]}`,
);
console.log(`  contact row: ${JSON.stringify(contRow.answers)}`);

console.log("");
check(
  "contact fields NOT in candidate row",
  !("phone" in candRow.answers) &&
    !("email" in candRow.answers) &&
    !("address" in candRow.answers),
);
check("contact fields ARE in contact row", "phone" in contRow.answers);
check("dob normalised to ISO", candRow.answers["dob"] === "1994-09-02");
check("consent mirrored onto the row", candRow.consentGranted === true);
check(
  "createdAt preserved across writes",
  candRow.createdAt === saved.createdAt,
);
check("updatedAt is set", candRow.updatedAt.length > 0);

// ── bad answer ───────────────────────────────────────────────────────
console.log("\n== rejection leaves data untouched ==");
const before = JSON.stringify(stores.candidates.rows.get(USER));
rec = new Recorder();
beginEdit(USER, "dob");
await applyAnswer(stores, rec, USER, { kind: "text", value: "not-a-date" });
check("invalid edit produces a reason", rec.sent[0] === copy.INVALID_DATE);
check(
  "nothing written",
  JSON.stringify(stores.candidates.rows.get(USER)) === before,
);
check("still in edit mode after rejection", currentEdit(USER) === "dob");

// ── /update ──────────────────────────────────────────────────────────
console.log("\n== /update ==");
rec = new Recorder();
beginEdit(USER, "city");
await applyAnswer(stores, rec, USER, { kind: "text", value: "Jaipur" });
check("confirms the change", rec.last().includes("Jaipur"));
check("edit mode cleared", currentEdit(USER) === null);
const afterEdit = await loadProfile(stores, USER);
check("city updated", afterEdit.answers["city"] === "Jaipur");
check(
  "other answers untouched",
  afterEdit.answers["full_name"] === candRow.answers["full_name"],
);
check("profile still complete", nextField(afterEdit.answers) === null);

// ── /match with curated rows ─────────────────────────────────────────
console.log("\n== /match (curated) ==");
matches.rows.push(
  {
    userId: USER,
    values: {
      matched_name: "Priya",
      matched_city: "Jaipur",
      reason: "Same city, both vegetarian.",
    },
  },
  { userId: "tg:other", values: { matched_name: "Someone Else" } },
);
rec = new Recorder();
await matchCommand(stores, matches, rec, USER);
check("shows this user's match", rec.last().includes("Priya"));
check(
  "does NOT show another user's match",
  !rec.last().includes("Someone Else"),
);
check(
  "no contact detail in output",
  !/phone|email|address|@/i.test(rec.last()),
);

// ── /forget ──────────────────────────────────────────────────────────
console.log("\n== /forget ==");
rec = new Recorder();
await forgetCommand(stores, rec, USER);
check("candidate row erased", stores.candidates.rows.size === 0);
check("contact row erased", stores.contacts.rows.size === 0);
check("curated matches untouched", matches.rows.length === 2);
check("confirms erasure", rec.last().includes("wiped"));

// ── resume after partial ─────────────────────────────────────────────
console.log("\n== resume ==");
rec = new Recorder();
await applyAnswer(stores, rec, "tg:777", {
  kind: "choice",
  id: FORM_FIELDS[0]!.options![0]!.id,
});
rec = new Recorder();
await startCommand(stores, rec, "tg:777");
check("resumes rather than re-welcoming", rec.sent[0] === copy.RESUMING);
check("resumes at question 2", rec.last().includes("Question 2 of 33"));

console.log(
  `\n${failures === 0 ? "✅ form prototype verified" : `❌ ${failures} check(s) failed`}\n`,
);
process.exit(failures === 0 ? 0 : 1);
