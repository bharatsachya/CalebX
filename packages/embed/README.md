# @calebx/embed

Embeddings, and the one place the model and its dimension are decided.

**`bge-small-en-v1.5`, 384 dimensions.** That number is compiled into the Neo4j vector
index and the Postgres `vector(384)` column, so it lives in `dimensions.ts` alone and is
imported by both — a mismatch fails a unit test instead of silently returning garbage
neighbours. See `assumptions.md` A4.

## Providers

| Provider                    | When                    | Notes                                                                                                    |
| --------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------- |
| `HttpEmbedder` (default)    | deployed                | one shared service; five workers each loading their own ONNX model is 5× the RAM for the same throughput |
| `createFastEmbedProvider()` | single-worker local run | optional dependency, loaded dynamically so `tsc` does not need onnxruntime installed                     |
| `HashEmbedder`              | tests, offline dev      | deterministic hashing trick. **Lexical only** — must be asked for explicitly                             |

`HashEmbedder` is never the default: a misconfigured deployment writing lexical-only
vectors into the same index as real ones produces plausible-looking, quietly wrong
recommendations — the worst failure mode available.

```ts
const provider = await createEmbeddingProvider(); // EMBED_PROVIDER, default "http"
const [vector] = await provider.embed(["prefers quiet cafes for work"]);
```

## Similarity

`cosine`, `normalize`, `topK`. Every provider returns unit-length vectors, so `cosine` is
a dot product with a length check — a dimension mismatch throws rather than returning a
wrong number. `topK` breaks ties on input order, so a caller that pre-sorted by recency
keeps that ordering among equally-similar items.

## Environment

| Variable            | Default | Meaning                          |
| ------------------- | ------- | -------------------------------- |
| `EMBED_PROVIDER`    | `http`  | `http` \| `fastembed` \| `hash`  |
| `EMBED_SERVICE_URL` | —       | required when provider is `http` |
