export {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
  EMBEDDING_SIMILARITY,
} from "./dimensions.ts";

export { HashEmbedder, tokenize } from "./hash.embedder.ts";
export { HttpEmbedder, type HttpEmbedderOptions } from "./http.client.ts";
export {
  createEmbeddingProvider,
  createFastEmbedProvider,
  type ProviderKind,
} from "./provider.ts";
export { cosine, normalize, topK, type Scored } from "./similarity.ts";
export type { Embedding, EmbeddingProvider } from "./types.ts";
