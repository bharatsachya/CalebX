# @calebx/matchmaking

The matchmaker subagent: its tools, its persona, and its guardrails. Postgres and
pgvector only — no graph.

## Tools

| Tool                            | Notes                                                                              |
| ------------------------------- | ---------------------------------------------------------------------------------- |
| `get_my_matrimonial_profile`    | Own profile and stated preferences                                                 |
| `update_partner_preferences`    | **Two-step.** Returns `needsConfirmation` first; only writes after the user agrees |
| `search_matrimonial_candidates` | Hard SQL filters + pgvector over interest text; anonymous results                  |
| `express_match_interest`        | Records one side; files a coordinator review when both sides say yes               |
| `list_my_matches`               | Stage and whether contact has been unlocked                                        |

## Why the search is split

Age, city, marital status, community and diet are **constraints**, not hints. A user who
says "must be in Bengaluru" means it, and embedding that alongside their free text produces
a confident-looking suggestion in Pune. So structured fields are SQL `WHERE` clauses and the
vector only ever compares **interest text against interest text** — same shape, same model,
which is what makes the cosine mean anything.

## Guardrails

- **`assertNoContactLeak`** runs on every tool payload before it reaches the model. It scans
  the serialised result for phone numbers, emails, invite links and social handles, and
  fails closed. The model repeats what it is given, so this boundary is the last place a
  leak can be stopped — and the fields that leak are the ones nobody thought to check.
- **Preferences are never written without confirmation.** The tool enforces it rather than
  trusting the prompt; a model that forgets produces a silently rewritten profile.
- **Off-mode requests refuse.** A matchmaker tool asked for a cafe says so instead of
  running a nonsense candidate search.
- **Contact details are only ever revealed by a human.** Mutual interest files a
  `mutual_interest` review task; nothing is unlocked until a coordinator advances the stage.
