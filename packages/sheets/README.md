# @calebx/sheets

Google Sheets as the database for the form prototype. Implements the three
storage ports declared in `@calebx/form`.

Modelled on `packages/db`: a lazy client singleton, a local `getSheetsConfig()`
reading through `@calebx/config`, and no-arg store classes wired at the bot's
composition root.

## Why not `googleapis`

That package is tens of megabytes of generated surface. This one uses
`google-auth-library` to mint a JWT and plain `fetch` for the five REST calls it
needs. `google-auth-library` is already in `bun.lock` as a transitive dependency.

## Setup

1. Create a spreadsheet. Its id is the long string in the URL between
   `/d/` and `/edit`.
2. In Google Cloud, create a service account, enable the **Google Sheets API**,
   and download a JSON key.
3. Share the spreadsheet with the service account's email as **Editor**. This is
   the step people miss — without it every call returns 403.
4. Fill in `.env`:

   ```
   GOOGLE_SHEETS_SPREADSHEET_ID=...
   GOOGLE_SERVICE_ACCOUNT_EMAIL=...@...iam.gserviceaccount.com
   GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
   ```

   Keep the quotes and the literal `\n`. The config unescapes them; an
   un-unescaped key fails later as an opaque `invalid_grant`.

5. `bun run sheets:init` — creates the three tabs and their header rows.

## Tabs

| Tab          | Written by       | Contents                                |
| ------------ | ---------------- | --------------------------------------- |
| `Candidates` | the bot          | biodata, family, partner preferences    |
| `Contacts`   | the bot          | phone, email, address — **sensitive**   |
| `Matches`    | **you, by hand** | curated suggestions; the bot only reads |

After `sheets:init`, protect the `Contacts` and `Matches` ranges in the Sheets UI
(Data → Protect sheets and ranges). The code cannot write to `Matches` — the port
has no write method — but a protected range also stops accidents from your side.

## Adding a question

Append a `FormField` in `@calebx/form`, then re-run `bun run sheets:init`. The
header row is extended; existing columns are never reordered or removed, and
unrecognised columns you added yourself are left alone.

## Caching and limits

`SheetTable` caches the header row and a `user_id → row number` index per tab,
invalidated on every write, because Sheets allows 60 reads/minute/user. Match
rows are deliberately **not** cached, so a match you add lands on the next
`/match` with no restart.

Last-write-wins, single process. Don't run two bots against one spreadsheet.
