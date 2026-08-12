# @calebx/form — src

| File                   | Responsibility                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------ |
| `form.config.ts`       | The single import site. Re-exports questions, options, sheet layout, commands, copy. |
| `fields.ts`            | Assembles `FORM_FIELDS` from the three per-table files; section and lookup helpers.  |
| `fields.candidates.ts` | Questions destined for the `candidates` table.                                       |
| `fields.contact.ts`    | Questions destined for `contact_details`. **Sensitive.**                             |
| `fields.prefs.ts`      | Questions destined for `partner_prefs`.                                              |
| `choices.ts`           | Option tables for multiple-choice questions.                                         |
| `sheet.ts`             | Tab names, header rows, Matches columns. No Google API here.                         |
| `copy.ts`              | Every user-facing string.                                                            |
| `form.fsm.ts`          | The pure state machine.                                                              |
| `validate.ts`          | Per-field and cross-field answer validation.                                         |
| `ports.ts`             | `CandidateStore`, `ContactStore`, `MatchStore`.                                      |
| `types.ts`             | Shared types, mirroring `packages/db/src/types.ts`.                                  |

Relative imports end in `.ts` (`allowImportingTsExtensions`), matching the rest
of the monorepo.

`choices.ts` and `fields.*.ts` hold values that are load-bearing across a data
migration. A `FormField.id` is simultaneously the sheet column header and the
Postgres column name; a `ChoiceOption.value` is what sits in the cell. Renaming
either orphans data already in the sheet.
