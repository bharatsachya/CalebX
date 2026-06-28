# Architectural Blueprint and Coding Plan for an Autonomous Open-Source Telegram Agent Utilizing HelixDB

## Overview

The contemporary landscape of artificial intelligence engineering demands systems capable of persistent, multi-dimensional memory paired with resilient, real-time user interfaces.

Developing an autonomous agent that integrates a Retrieval-Augmented Generation (RAG) pipeline within a Telegram bot interface requires a meticulously structured architectural and coding plan.

This architecture is built entirely on **open-source technologies**, replacing proprietary cloud services with self-hosted alternatives.

At the center of the architecture is **HelixDB**, a high-performance graph-vector database that enables unified GraphRAG memory.

---

# High-Level Architecture

```
Telegram User
      │
      ▼
Telegram Bot API
      │
      ▼
GramIO Bot (Node.js)
      │
      ▼
BullMQ Queue (Redis)
      │
 ┌────┴────┐
 │         │
 ▼         ▼
Ingestion Worker
Retrieval Worker
 │         │
 ▼         ▼
FastEmbed   HelixDB GraphRAG
 │         │
 ▼         ▼
HelixDB <──┘
 │
 ▼
Ollama / vLLM
 │
 ▼
Dispatcher Worker
 │
 ▼
Telegram Bot API
 │
 ▼
Telegram User
```

---

# Open Source Technology Stack

| Component          | Technology           | Purpose                         |
| ------------------ | -------------------- | ------------------------------- |
| Database           | HelixDB              | Unified Graph + Vector database |
| Object Storage     | MinIO                | Persistent storage              |
| Embedding Engine   | FastEmbed / ColPali  | Local embedding generation      |
| LLM                | Ollama / vLLM        | Local inference                 |
| Backend            | Node.js + TypeScript | Application layer               |
| Queue              | BullMQ + Redis       | Async processing                |
| Telegram Framework | GramIO               | Telegram Bot API                |
| Deployment         | Docker Compose       | Infrastructure                  |

---

# Project Structure

```
project-root/

docker-compose.yml

helix.toml

.env

db/
    schema.hx
    queries.ts

src/

    bot/
        telegram.ts

    workers/
        ingestion.ts
        retrieval.ts
        dispatcher.ts

    services/
        embedding.ts
        llm.ts
        rag.ts

    queue/
        redis.ts
        bullmq.ts

    middleware/
        consent.ts
        auth.ts

    utils/
        chunking.ts
        tokenizer.ts

storage/

scripts/
```

---

# Docker Stack

```
Node.js

Redis

BullMQ

HelixDB

MinIO

FastEmbed

Ollama

Telegram Bot
```

---

# HelixDB Schema

## Nodes

```
User

Session

MemoryChunk

Group

Document
```

---

## Edges

```
OwnsMemory

MemberOf

ContainsDocument

RelatedMemory

UpdatedTo
```

---

## Vectors

```
Memory Embedding

Document Embedding

Image Embedding
```

---

# Ingestion Pipeline

```
Telegram Message

↓

Receive Update

↓

Validate Consent

↓

Chunk Text

↓

Generate Embeddings

↓

HelixDB WriteBatch

↓

Store

User

Memory

Relationship

Embedding
```

---

# Retrieval Pipeline

```
User Question

↓

Generate Query Embedding

↓

Locate User Node

↓

Traverse User Graph

↓

ANN Vector Search

↓

BM25 Keyword Search

↓

Merge Results

↓

Context

↓

Ollama

↓

LLM Response
```

---

# GraphRAG Flow

```
User

↓

Memory Nodes

↓

Connected Relationships

↓

Semantic Search

↓

Graph Traversal

↓

Relevant Context

↓

LLM
```

---

# Queue Architecture

```
Telegram

↓

BullMQ

↓

──────────────

Ingestion Queue

Retrieval Queue

Dispatch Queue

──────────────

↓

Telegram API
```

---

# Telegram Workflow

```
Incoming Message

↓

Webhook

↓

GramIO

↓

BullMQ

↓

Worker

↓

HelixDB

↓

LLM

↓

Dispatcher

↓

Telegram
```

---

# Persistent Storage

```
HelixDB

↓

MinIO Object Storage

↓

Encrypted Volumes
```

---

# Configuration

## helix.toml

```
Port

Namespaces

Storage

Authentication

Compiled Queries
```

---

## Environment Variables

```
HELIX_PORT=6969

S3_BUCKET=helix

AWS_ENDPOINT=http://minio:9000

AWS_ALLOW_HTTP=true

PATH_TO_QUERIES=queries.json
```

---

# Query Compilation

```
schema.hx

↓

Type Checking

↓

AST Generation

↓

queries.json

↓

Helix Runtime
```

---

# GraphRAG Execution

```
User Query

↓

Embedding

↓

Graph Traversal

↓

Vector Search

↓

Keyword Search

↓

Rank

↓

Prompt

↓

LLM
```

---

# Telegram Rate Limiting

| Scope        | Limit            |
| ------------ | ---------------- |
| Private Chat | ~1 msg/sec       |
| Group Chat   | ~20 msg/min      |
| Global       | ~30 msg/sec      |
| Read APIs    | ~100-150 req/min |

---

# Dispatcher Logic

```
Queue

↓

Rate Limiter

↓

Random Jitter

↓

Retry Logic

↓

Telegram API

↓

429?

↓

Wait retry_after

↓

Retry
```

---

# Consent Workflow

```
New User

↓

Privacy Policy

↓

Accept Button

↓

consent_granted = true

↓

Store Messages
```

---

# User Model

```
User

Telegram ID

Username

Consent

Preferences

Created

Updated
```

---

# Memory Model

```
MemoryChunk

Text

Embedding

Timestamp

Metadata
```

---

# Security

```
Encrypted Storage

Separate Keys

HTTPS

Bot API Only

No MTProto

No Secret Chats
```

---

# Deployment

```
docker compose up

↓

HelixDB

↓

MinIO

↓

Redis

↓

BullMQ

↓

Ollama

↓

Telegram Bot
```

---

# Multi-Tenant Graph

```
Group

├── User A

├── User B

├── User C

└── Shared Memory
```

---

# Temporal Memory

```
Preference V1

↓

Preference V2

↓

Preference V3

↓

Time-aware Graph
```

---

# Large Document Flow

```
Telegram

↓

Upload

↓

Chunk

↓

Embedding

↓

HelixDB

↓

GraphRAG

↓

Summary

↓

Telegram
```

---

# Ban Recovery

| Type             | Description                |
| ---------------- | -------------------------- |
| Spam Restriction | Appeal via @SpamBot        |
| Silent Ghosting  | Pause queue                |
| Hard Ban         | Email recover@telegram.org |
| IP Block         | Infrastructure migration   |

---

# Best Practices

- Use only the Telegram Bot API.
- Never automate user accounts via MTProto.
- Respect Telegram rate limits.
- Add randomized dispatch jitter.
- Queue all outbound messages.
- Require explicit user consent before storing data.
- Encrypt all persistent storage.
- Keep embedding generation local.
- Use HelixDB for unified GraphRAG memory.
- Decouple ingestion, retrieval, and dispatch workers.
- Implement retry logic for HTTP 429 responses.
- Support multi-tenant group memory with strict graph permissions.
- Preserve historical memories through temporal graph modeling.
- Maintain portable deployment with Docker Compose.

---

# Overall System Pipeline

```
Telegram User

↓

Telegram Bot API

↓

GramIO

↓

BullMQ

↓

Ingestion Worker

↓

FastEmbed

↓

HelixDB

↓

GraphRAG

↓

Ollama / vLLM

↓

Dispatcher Worker

↓

Telegram API

↓

Telegram User
```
