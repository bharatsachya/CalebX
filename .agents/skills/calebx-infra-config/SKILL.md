---
name: calebx-infra-config
description: CALEBX local infrastructure and env config — docker-compose services (Redis, MinIO, HelixDB, Ollama) and the Zod env var schema. Read when editing docker-compose.yml, config/schema.ts, service ports/images, or adding/validating environment variables.
user-invocable: false
metadata:
  internal: true
---

## Infrastructure (docker-compose.yml)

```yaml
services:
  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]
    volumes: ["redis-data:/data"]
    command: redis-server --appendonly yes

  minio:
    image: minio/minio
    ports: ["9000:9000", "9001:9001"]
    environment:
      MINIO_ROOT_USER: calebx
      MINIO_ROOT_PASSWORD: calebx-local-dev
    volumes: ["minio-data:/data"]
    command: server /data --console-address ":9001"

  helixdb:
    image: ghcr.io/helixdb/enterprise-dev:latest
    ports: ["6969:6969"]
    environment:
      S3_BUCKET: calebx-helix
      AWS_ENDPOINT: http://minio:9000
      AWS_ACCESS_KEY_ID: calebx
      AWS_SECRET_ACCESS_KEY: calebx-local-dev
      AWS_ALLOW_HTTP: "true"
      PATH_TO_QUERIES: /app/queries.json
    volumes:
      - ./db/queries.json:/app/queries.json:ro
    depends_on: [minio]
    command: ["helix", "start", "--disk"] # persistent mode, not in-memory

  ollama:
    image: ollama/ollama
    ports: ["11434:11434"]
    volumes: ["ollama-models:/root/.ollama"]
    # pull models on first run:
    # docker exec calebx-ollama ollama pull llama3
    # docker exec calebx-ollama ollama pull nomic-embed-text

volumes:
  redis-data:
  minio-data:
  ollama-models:
```

**Important:** HelixDB defaults to in-memory mode without `--disk`. In-memory mode
wipes all PersonaChunks on container restart. Always use `--disk` with MinIO backing
in any environment beyond unit tests.

## Environment Variables (config/schema.ts)

All env vars are validated at boot using Zod. If any required var is missing or
mistyped, the process exits with a clear error before doing anything else.

```typescript
// packages/config/schema.ts
export const ConfigSchema = z.object({
  // Telegram
  TELEGRAM_BOT_TOKEN: z.string().min(20),

  // HelixDB
  HELIX_URL: z.string().url().default("http://localhost:6969"),

  // Redis / BullMQ
  REDIS_URL: z.string().url().default("redis://localhost:6379"),

  // Ollama
  OLLAMA_URL: z.string().url().default("http://localhost:11434"),
  OLLAMA_CHAT_MODEL: z.string().default("llama3"),
  OLLAMA_EMBED_MODEL: z.string().default("nomic-embed-text"),

  // MinIO (used by HelixDB, not directly by app)
  MINIO_ENDPOINT: z.string().url().default("http://localhost:9000"),

  // Tuning
  PERSONA_CHUNK_THRESHOLD: z.coerce.number().default(0.75),
  MAX_SESSION_TURNS: z.coerce.number().default(20),
  DISPATCH_JITTER_MAX_MS: z.coerce.number().default(15),
});
```
