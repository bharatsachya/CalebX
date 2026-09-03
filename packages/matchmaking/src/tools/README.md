# matchmaking/tools

One file per tool, plus `shared.ts` for result helpers, argument coercion, and the
"has this person got a profile yet?" precondition.

| File                  | Tool                                                                                    |
| --------------------- | --------------------------------------------------------------------------------------- |
| `profile.tool.ts`     | `get_my_matrimonial_profile`                                                            |
| `preferences.tool.ts` | `update_partner_preferences` — **two-step**; nothing is written until the user confirms |
| `search.tool.ts`      | `search_matrimonial_candidates` — hard SQL filters, vector over interest text only      |
| `interest.tool.ts`    | `express_match_interest` — files a coordinator review when both sides say yes           |
| `matches.tool.ts`     | `list_my_matches`                                                                       |

Two rules hold across all of them:

- **Every payload is scanned before it leaves.** `assertNoContactLeak` fails closed on a
  phone number, email, invite link or handle, because the model repeats what it is given.
- **A pair record is never written as one of the two people.** `expressInterest` uses
  `context.pairWriter`; a match belongs to neither side alone.
