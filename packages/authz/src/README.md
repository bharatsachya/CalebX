# @calebx/authz

The authorization layer. **No code path reads user data without a `Principal`.**

Two independent mechanisms, on purpose:

1. **Policy** (`policy.ts`) — guards code paths. `authorize(principal, action, resource)`
   returns `{ allowed, reason, projection }`. Deny by default; there is no
   `else return true` in the file.
2. **Query scope** (`scope.ts`) — guards the queries. A `SELECT` that forgot its
   `WHERE user_id = $1` is the failure that actually leaks data, and a policy check
   cannot see it. `scopedSql`/`scopedCypher` make an unscoped query impossible to run.

## Why a decision is not a boolean

`{ allowed: true, projection: "anonymized" }` is the most common answer in this system —
peer discovery is _allowed_, but only ever as an anonymized card. Collapsing that to
`true` is exactly how a phone number leaks, so `Projection` is part of every decision and
`project()` is what applies it.

## Principals

| Kind     | Who                                        | May                                                                                                                     |
| -------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `user`   | a conversing end user, in exactly one mode | own records fully; discoverable peers anonymized; contact only after mutual interest                                    |
| `admin`  | a human coordinator                        | matchmaking records + contact details, resolve review tasks. **Not** community persona chunks, **not** editing profiles |
| `system` | a background job, named                    | bulk graph reads, anonymized. **Nothing** else — a clustering job needs edges, never names                              |

## Mode isolation

A principal acts in one mode. A cross-mode access is denied **even when the principal owns
the resource** — the mode check runs before the ownership check, so being enrolled in both
modes is not a bypass. See `assumptions.md` A8.

## Usage

```ts
import {
  assertAuthorized,
  ownedBy,
  project,
  scopedSql,
  userPrincipal,
} from "@calebx/authz";

const principal = userPrincipal(userId, "matchmaker", enrolledModes);

// path guard
const { projection } = assertAuthorized(
  principal,
  "read_anonymized",
  ownedBy("candidate", candidateOwnerId, "matchmaker", { discoverable: true }),
);

// query guard — throws before touching the database if the SQL is unscoped
const sql = scopedSql(pool, principal);
const rows = await sql.query("SELECT * FROM candidates WHERE user_id = $1", [
  userId,
]);

// projection — actually apply what the decision allowed
return rows.map((row) => project(row, projection));
```

## Deliberate bulk access

```sql
/* authz:bulk */ SELECT user_id, community_id FROM ...
```

```cypher
// authz:bulk
MATCH (a:User)-[:KNOWS]->(b:User) RETURN a.userId, b.userId
```

The marker says the query intends to cross users; `assertBulkAllowed` says the caller is
allowed to intend it (system principals only). Both are required.
