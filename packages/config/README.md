# @calebx/config

The one place that knows where the repo root is, that the root `.env` exists, and
that dotenv exists. Every other package reads environment variables through here.

```ts
import { env, dataPath } from "@calebx/config";

const e = env("sheets"); // scope tag — it prefixes error messages

export const config = {
  spreadsheetId: e.required("GOOGLE_SHEETS_SPREADSHEET_ID"),
  port: e.number("WHATSAPP_PORT", 8787),
  dryRun: e.boolean("WHATSAPP_DRY_RUN"),
  consentStorePath: e.optional("CONSENT_STORE_PATH", dataPath("consent.json")),
};
```

Importing anything from this package loads `.env` as a side effect, once.

## What this replaced

Every package used to open each of its config files with:

```ts
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });
```

That counts each file's depth from the root, so it breaks silently the moment a
file moves into a subdirectory — and it re-parses `.env` once per importing
module. Here the root is **discovered**, not counted: walk up from this module
until a directory holds `bun.lock` or a `package.json` with `workspaces`.

The explicit path was there for a real reason — `bun --cwd packages/telegram-bot`
makes the package the cwd, so a bare `dotenv.config()` looks in the wrong
directory. Root discovery solves that without hard-coding a depth.

`CALEBX_ROOT` overrides the search, for containers that copy only `dist/` and
leave no workspace markers behind.

## The API

| Export                      | Purpose                                                                  |
| --------------------------- | ------------------------------------------------------------------------ |
| `env(scope?)`               | Reader bound to a package name, for error messages.                      |
| `.required(name)`           | Throws `MissingEnvError`. For lazy getters inside a running process.     |
| `.requiredOrExit(name)`     | Prints one line and exits. For boot-time reads in an entry point.        |
| `.optional(name, fallback)` | String with a default.                                                   |
| `.number(name, fallback)`   | Falls back on a non-finite value rather than yielding `NaN`.             |
| `.boolean(name, fallback?)` | `true` / `1` / `yes`, case-insensitive.                                  |
| `repoRoot`, `rootPath(...)` | The discovered root, and paths relative to it.                           |
| `dataPath(...)`             | Paths inside the gitignored `.data/` directory.                          |
| `loadConfig()`              | Validates the whole environment against `ConfigSchema` (Zod), fail-fast. |

### `required` vs `requiredOrExit`

A missing variable at boot is a config mistake, not an exception worth a stack
trace — the user needs the one-line fix. So entry-point config objects use
`requiredOrExit`. Library code that is called mid-process (`getDbConfig`,
`getSheetsConfig`) throws instead, so a caller can catch it and a running bot
does not vanish.

### A value is "unset" if it is blank _or_ still `YOUR_X_HERE`

Pasting `.env.example` verbatim is the most common misconfiguration. It should
fail like an empty value, not like a valid credential.

## Precedence

dotenv never overwrites a variable that is already set, so a real environment
(CI, Docker, systemd) always beats the checked-out `.env`.

## Why `loadConfig()` is a function

`ConfigSchema` requires `TELEGRAM_BOT_TOKEN`. Validating it at module load would
mean any process that imports _anything_ from `@calebx/config` — the WhatsApp
bot, the sheets CLI, the importer — exits when a Telegram token is absent. Only
an entry point that actually wants the whole schema calls it.
