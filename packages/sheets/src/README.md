# @calebx/sheets — src

| File                        | Responsibility                                                                                    |
| --------------------------- | ------------------------------------------------------------------------------------------------- |
| `config.ts`                 | `getSheetsConfig()` — lazy, cached, throws on a missing var. Mirrors `packages/db/src/config.ts`. |
| `client.ts`                 | JWT auth + the Sheets v4 REST calls. The analogue of `db.ts`'s pool.                              |
| `table.ts`                  | Header-mapped row access: read, upsert, remove, index by `user_id`.                               |
| `sheets.candidate.store.ts` | `CandidateStore` over the `Candidates` tab.                                                       |
| `sheets.contact.store.ts`   | `ContactStore` over the `Contacts` tab. **Sensitive.**                                            |
| `sheets.match.store.ts`     | `MatchStore` over the `Matches` tab. **Read-only.**                                               |
| `init.ts`                   | `bun run sheets:init` — creates tabs, syncs header rows.                                          |

## Invariants

- **Columns are addressed by header name, never by position.** Reordering columns
  by hand cannot corrupt data, and a column the code doesn't know about is left
  untouched on write — that is what lets you keep your own notes columns.
- **`RAW` on every write.** `USER_ENTERED` would let Sheets reinterpret answers:
  a phone number becomes a float, a name starting with `=` becomes a formula.
- **An empty cell means "not asked yet".** A skipped question stores the literal
  `SKIPPED` marker instead, because the FSM derives the current question from the
  first empty cell.
- **`sheets.match.store.ts` only reads, and only through an allow-list of
  columns.** Adding a write path here is the one change that would let a user
  edit curated match data.
