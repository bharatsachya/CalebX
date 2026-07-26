# migrations

Numbered, immutable `.sql` files, applied once each in filename order by
`../migrate.ts`. Never edit a file after it has run anywhere — add a new
numbered file instead, the same rule as any other production migration tool.

| File                           | Table(s)                      |
| ------------------------------ | ----------------------------- |
| `001_extensions_and_enums.sql` | `pgcrypto`, all enum types    |
| `002_candidates.sql`           | `candidates`                  |
| `003_contact_details.sql`      | `contact_details` (sensitive) |
| `004_messages.sql`             | `messages`                    |
| `005_partner_prefs.sql`        | `partner_prefs`               |
| `006_matches.sql`              | `matches`                     |
| `007_photos.sql`               | `photos`                      |
| `008_candidate_consent.sql`    | `candidates` (consent cols)   |
