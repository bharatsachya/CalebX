# CALEBX 🪐

> **Context-Aware Social Recommendation Engine**
> CALEBX transforms everyday conversations on WhatsApp and Telegram into meaningful social connections and hyper-local recommendations.

By analyzing chat intents in real-time, CALEBX connects users with like-minded profiles and relevant places using a hybrid vector-graph recommendation pipeline.

---

## 🚀 Features

- **Real-Time Intent Parsing:** Extracts context, sentiment, and named entities (places, topics) from unstructured chat messages on the fly.
- **Platform Agnostic:** Built to run as a headless backend for various platform bots (Telegram, Discord, WhatsApp).
- **Dual-Engine Recommendations:**
  - _Semantic Matching (Vector DB):_ Finds users with similar conversational "vibes" and interests.
  - _Relational Matching (Graph DB):_ Filters by social proximity (2nd-degree connections) and geographic location.
- **Privacy-First:** Node anonymization and transient message caching ensure PII is protected.

---

## 🏗️ Monorepo & Plug-and-Play Architecture

CALEBX is designed as a **decoupled monorepo** utilizing the Ports and Adapters (Hexagonal) architecture. This ensures that the core domain logic remains constant while all database engines and communication frameworks are easily pluggable.

```text
packages/
  ├── core/            # Domain entities, use-cases, and repository ports (interfaces)
  ├── telegram-bot/    # Telegram Bot adapter using GramIO
  └── db/              # Database adapter using HelixDB (Graph + Vector)
```

For guidelines on coding style and structural constraints, please read the [Developer Contribution Rules](rules/rules.md).

---

## 💻 Tech Stack

- **Runtime Engine:** [Bun](https://bun.sh/)
- **Programming Language:** TypeScript
- **Telegram Bot Framework:** [GramIO](https://gramio.dev/)
- **Unified Graph-Vector DB:** [HelixDB](https://github.com/HelixDB/helix-db) (for GraphRAG memory)

---

## 🛠️ Local Development Setup

### Prerequisites

- [Bun](https://bun.sh/) installed locally
- Telegram API Bot Token (obtained from `@BotFather`)

### Installation & Execution

1. **Clone the repository:**

   ```bash
   git clone https://github.com/bharatsachya/CalebX.git
   cd CalebX
   ```

2. **Install dependencies:**

   ```bash
   bun install
   ```

3. **Configure environment variables:**
   Create a `.env` file at the root:

   ```bash
   TELEGRAM_BOT_TOKEN="YOUR_BOT_TOKEN_HERE"
   ```

4. **Build the packages:**
   Compile the packages in order (dependencies first):

   ```bash
   npm run build
   ```

5. **Start the Telegram Bot:**
   Run the bot in development mode:
   ```bash
   bun run bot:start
   ```

---

## 🚦 Verification & Git Hooks

This project enforces validation workflows to guarantee repository quality and style consistency:

- **Pre-commit hooks** (Husky) auto-runs `bun run commit:validate` which formats staged files using Prettier, blocks large files, scans for secrets via `gitleaks`, and validates that all source directories have a `README.md`.
- **Pre-push hooks** (Husky) auto-runs `bun run push:validate` which checks for TypeScript compilation errors, Prettier formatting compliance, and linters.
