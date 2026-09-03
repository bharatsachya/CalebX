/** A unit-length embedding. Every provider must normalise before returning. */
export type Embedding = number[];

export interface EmbeddingProvider {
  readonly name: string;
  readonly dimensions: number;
  /**
   * Embeds a batch. Order of the output matches the input exactly — callers zip
   * the two together, so a provider that reorders or drops entries corrupts the
   * mapping silently.
   */
  embed(texts: string[]): Promise<Embedding[]>;
}
