# @calebx/form

The matchmaking questionnaire as a pure domain package: field definitions, a
deterministic state machine, validation, copy, and storage ports.

No I/O, no platform SDKs, no LLM. Its only dependency is `@calebx/channel`, for
the `ChoiceOption` shape and the `matchChoice`/`optionById` matchers.

## What this is for

`packages/agent` builds a persona through open conversation. This package is the
opposite experiment: a fixed form, asked one question at a time, so the UX can be
tested without a model in the loop. Answers are curated into matches by hand —
`006_matches.sql` is explicit that v1 has no algorithmic matcher.

## Where the questions come from

Every field mirrors a column in `packages/db/src/migrations/`, and carries
`table` metadata naming its destination:

| File                   | Table             | Migration                 |
| ---------------------- | ----------------- | ------------------------- |
| `fields.candidates.ts` | `candidates`      | `002_candidates.sql`      |
| `fields.contact.ts`    | `contact_details` | `003_contact_details.sql` |
| `fields.prefs.ts`      | `partner_prefs`   | `005_partner_prefs.sql`   |

Enum-valued options (`owner_type`, `marital_status`) copy their `value` strings
verbatim from `packages/db/src/types.ts`, so importing a filled sheet into
Postgres is a column mapping and not a translation.

## Start here

`src/form.config.ts` is the single import site for everything configurable — the
questions, options, sheet layout, commands, and all copy. It re-exports from four
small files only because the repo caps source files at 300 lines.

To add a question: append a `FormField` to the right `fields.*.ts`, then run
`bun run sheets:init` to extend the sheet's header row.

## Two rules the types enforce

- **`MatchStore` has no write method.** Match data is curated by hand and users
  must not be able to change it. There is no code path that could.
- **`ContactStore` is a separate port.** `003_contact_details.sql` releases phone,
  email, and address only on mutual interest, as a manual admin step. The
  `/match` renderer is handed a `MatchStore` and nothing else, so it has no route
  to a contact detail even by mistake.

## No stored step

The current question is the first field with no answer. Progress is a function of
the data, so there is no step column to drift out of sync and a restart mid-form
resumes exactly where it stopped. This is why a skipped optional field writes the
literal `-` (`SKIPPED`) rather than leaving the cell empty.

## Contract

```ts
nextField(answers): FormField | null      // null once finished
advance(answers, input): Advance          // apply one answer
applyEdit(answers, field, input): Advance // the /update path
skip(answers, field): Advance
```

`Advance` is `complete` | `rejected` | `advanced`. A rejected answer changes
nothing and returns the reason plus a re-ask, so the adapter only ever has to
send the prompts it is handed.
