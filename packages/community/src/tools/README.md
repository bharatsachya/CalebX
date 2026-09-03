# community/tools

One file per tool, plus `shared.ts` for argument coercion and result helpers.

Every tool follows the same shape: **traverse first, rank second**. The candidate set comes
from the graph — friends of friends, a cohort key, a geo radius — and only then is it
scored. An unconstrained vector search across all users would be both slower and a privacy
boundary violation.

| File              | Tool                                                                           |
| ----------------- | ------------------------------------------------------------------------------ |
| `persona.tool.ts` | `save_persona_chunk` — one durable fact, embedded and appended                 |
| `people.tool.ts`  | `find_like_minded_people` — second-degree `KNOWS`, consent-gated, anonymised   |
| `groups.tool.ts`  | `search_community_groups` — cohort key → a group that exists and can be joined |
| `places.tool.ts`  | `get_curated_places` — Places Nearby Search by interest category               |
| `shared.ts`       | `ok`/`no` results, and coercion that treats `"   "` and `"3"` correctly        |

A tool returns `ok: false` for ordinary emptiness — "nobody has opted in", "no group yet".
That is a normal turn the model narrates, not an error, which is why nothing here throws for
a missing result.
