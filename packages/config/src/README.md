# @calebx/config — src

| File        | Responsibility                                                                   |
| ----------- | -------------------------------------------------------------------------------- |
| `env.ts`    | Repo-root discovery, the single `dotenv.config()` call, and the `env()` reader.  |
| `schema.ts` | The Zod `ConfigSchema` and `loadConfig()` — full-environment validation, opt-in. |
| `index.ts`  | Public surface. Importing it is what loads `.env`.                               |

## Invariants

- **`env.ts` holds the only `dotenv` import in the monorepo.** If a package
  reaches for dotenv again, the root-path duplication is growing back.
- **The root is discovered, never counted.** Walk up for `bun.lock` or a
  `package.json` with `workspaces`; `CALEBX_ROOT` overrides. No `../../../`.
- **Loading is a module-load side effect, and idempotent.** ES modules evaluate
  once, so `.env` is parsed once per process no matter how many packages import
  it.
- **`schema.ts` has no module-load side effect beyond loading `.env`.**
  `loadConfig()` is a function precisely so its `process.exit(1)` cannot fire in
  a process that only wanted `env()`.
- **Reads are trimmed, and `YOUR_X_HERE` counts as unset.**
