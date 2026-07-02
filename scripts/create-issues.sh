#!/usr/bin/env bash

# Verify GitHub CLI is installed and authenticated
if ! command -v gh &> /dev/null; then
    echo "❌ Error: GitHub CLI (gh) is not installed. Please install it first or copy-paste issues manually."
    exit 1
fi

if ! gh auth status &> /dev/null; then
    echo "❌ Error: GitHub CLI is not authenticated. Run 'gh auth login' first."
    exit 1
fi

echo "🏷️ Ensuring custom labels exist on GitHub..."
gh label create foundation --color "1d76db" --description "Phase 1: Foundation tasks" &> /dev/null || true
gh label create ingestion --color "28a745" --description "Phase 2: Ingestion & Consent Gate tasks" &> /dev/null || true
gh label create retrieval --color "6f42c1" --description "Phase 3: Retrieval & Persona RAG tasks" &> /dev/null || true
gh label create dispatch --color "fd7e14" --description "Phase 4: Outbound Dispatcher tasks" &> /dev/null || true
gh label create resilience --color "dc3545" --description "Phase 4: Resilience and logging tasks" &> /dev/null || true

echo "🚀 Creating Phase 1 Foundation Issues..."
gh issue create --title "[Foundation] Set up Local Development Infrastructure" --body "Scaffold local containerized services (Redis, MinIO, HelixDB, Ollama) and config files." --label "enhancement" --label "foundation"

gh issue create --title "[Foundation] Scaffold shared utility packages (types, errors, logger, config)" --body "Establish core package workspace modules inside packages/*." --label "enhancement" --label "foundation"

gh issue create --title "[Foundation] Define Domain Entities, Ports, and HelixQL Schema" --body "Implement core packages domain entities, port boundaries, and schema.hx schema." --label "enhancement" --label "foundation"

echo "🚀 Creating Phase 2 Ingestion Issues..."
gh issue create --title "[Ingestion] Implement Consent Gate Middleware & Commands (/start, /forget)" --body "Enforce consent checks and user removal logic." --label "enhancement" --label "ingestion"

gh issue create --title "[Ingestion] Implement Ingestion Queue & Stage 1 Extraction Worker" --body "Set up Ingest BullMQ worker, Ollama extraction, and HelixDB indexing." --label "enhancement" --label "ingestion"

echo "🚀 Creating Phase 3 Retrieval Issues..."
gh issue create --title "[Retrieval] Implement GraphRAG Query and RRF Fusion Ranker" --body "Create retrieval-queue and 7-step search logic." --label "enhancement" --label "retrieval"

gh issue create --title "[Retrieval] Implement Stage 2 Conversation and Session Summarization" --body "Integrate natural conversational responses and session summarization." --label "enhancement" --label "retrieval"

echo "🚀 Creating Phase 4 Dispatch & Reliability Issues..."
gh issue create --title "[Dispatch] Implement Dispatcher Queue and Telegram Rate Limiting" --body "Add dispatch-queue worker enforcing limits and jitter." --label "enhancement" --label "dispatch"

gh issue create --title "[Resilience] Implement Dead-Letter Queues, Log Correlation, and E2E validation" --body "Implement DLQ handling, structured logging, and E2E tests." --label "enhancement" --label "resilience"

echo "✅ Done! All issues created on GitHub."
