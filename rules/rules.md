# CalebX Developer Contribution Rules

Welcome! To keep the CalebX codebase maintainable, secure, and clean, please adhere to the following rules when contributing.

## 🏗️ 1. Architecture Rules (Plug-and-Play)

- **Hexagonal Architecture**: Keep the core business logic completely decoupled from frameworks, delivery platforms (like Telegram or WhatsApp), and database engines (like HelixDB).
- **Core Package (`packages/core`)**: Define all domain entities, use-cases, and repository ports (interfaces) here. Do not import database drivers, API frameworks, or platform SDKs inside `core`.
- **Adapters (`packages/*-bot`, `packages/db`)**: Implement external interactions here. They connect to the core ports. Adding support for new databases or chat platforms should only require writing a new adapter package without touching `core`.

## 📦 2. Monorepo Structure

- All code modules must be structured as packages under the `packages/` directory.
- Workspaces are managed using `npm` / `bun` workspaces.
- Every workspace package containing source code **must** have a `README.md` at its package root and nested source directories (e.g., `packages/<pkg-name>/README.md`) describing its contract. This is verified automatically on pre-commit.

## ⚠️ 3. Coding Guidelines

- **File Size Rule**: Individual TypeScript files must not exceed **300 lines of code** (excluding tests and type declarations). Split large classes or files into smaller, single-responsibility files.
- **Top-Level Await**: Allowed in root runner scripts but keep modules inside `packages/` structured with standard export statements.
- **Top-Level Imports**: Explicitly end local module imports with `.ts` when writing scripts.

## 🔒 4. Security & Quality Rules

- **No Secrets**: Never stage API keys, credentials, or bot tokens. All secrets should be loaded from the root `.env` file. Commits are scanned automatically using `gitleaks`.
- **Lockfile Integrity**: Only the `bun.lock` file is permitted at the project root. Do not commit `package-lock.json`, `yarn.lock`, or `pnpm-lock.yaml`.
- **Prettier Format**: Run code formatting before committing. File checks enforce Prettier styles on all staged files.

## 🛠️ 5. Development Workflows

Verify your changes locally before pushing:

- **Pre-commit Checks** (auto-runs on `git commit`):
  ```bash
  bun run commit:validate
  ```
- **Pre-push Checks** (auto-runs on `git push`):
  ```bash
  bun run push:validate
  ```
- **Code Formatter**:
  ```bash
  bun run format
  ```
