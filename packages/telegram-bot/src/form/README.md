# telegram-bot — form

Transport and rendering for the form prototype. Entry point is
`../form-bot.ts`; run it with `bun run bot:form`.

Every question, option id, and user-facing string comes from `@calebx/form`. A
string literal shown to a user in this directory would be a bug (CLAUDE.md
rule 11) — it is the drift that makes a second channel diverge.

| File             | Responsibility                                                  |
| ---------------- | --------------------------------------------------------------- |
| `handlers.ts`    | Registration table: commands, callback dispatch, typed answers. |
| `commands.ts`    | `/start`, `/skip`, `/match`, `/forget` as plain functions.      |
| `answer.flow.ts` | Applying one answer — shared by typed replies and taps.         |
| `update.flow.ts` | Re-asking a question during `/update`.                          |
| `profile.ts`     | Reads/writes answers across the two tabs they live in.          |
| `keyboards.ts`   | Inline keyboards, built from the shared option tables.          |
| `render.ts`      | `Prompt` → Telegram message. HTML parse mode.                   |
| `session.ts`     | In-memory `/update` edit mode.                                  |
| `queue.ts`       | Per-user serialisation.                                         |

## Why the queue

Sheets is read-modify-write over a network round-trip of a few hundred
milliseconds. Two taps in quick succession would both read the same answers and
one would be lost. `../telegram.ts` has no equivalent because its file ledger
settles in microseconds. Copied from `packages/whatsapp-bot/src/queue.ts`.

## Why HTML and not Markdown

Telegram rejects malformed entities with a 400, which the user experiences as
the bot going silent. Markdown breaks on any answer containing `_` or `*` — a
real name or address eventually will. `@calebx/form`'s `copy.ts` emits HTML and
escapes every interpolated value.

## Contact details

`profile.ts` writes phone, email, and address to a separate tab, per
`003_contact_details.sql`. `commands.ts`'s `matchCommand` is handed a
`MatchStore` and nothing else, so there is no route from the `/match` path to a
contact detail — the guarantee is structural, not a matter of remembering.
