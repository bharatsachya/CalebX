/// <reference types="bun" />
import { describe, expect, it } from "bun:test";
import { EmbeddingError } from "@calebx/errors";
import { HttpEmbedder } from "./http.client.ts";
import { EMBEDDING_DIMENSIONS } from "./dimensions.ts";

function vector(fill = 1, size = EMBEDDING_DIMENSIONS): number[] {
  return new Array<number>(size).fill(fill);
}

function stubFetch(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
): typeof fetch {
  return ((url: string, init?: RequestInit) =>
    Promise.resolve(handler(url, init))) as unknown as typeof fetch;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("HttpEmbedder", () => {
  it("posts the batch to /embed and normalises the response", async () => {
    let seenUrl = "";
    let seenBody: unknown;
    const embedder = new HttpEmbedder({
      baseUrl: "http://embed.local",
      fetchImpl: stubFetch((url, init) => {
        seenUrl = url;
        seenBody = JSON.parse(String(init?.body));
        return jsonResponse({ embeddings: [vector(2)] });
      }),
    });

    const [out] = await embedder.embed(["cafes"]);
    expect(seenUrl).toBe("http://embed.local/embed");
    expect(seenBody).toMatchObject({ texts: ["cafes"] });
    const magnitude = Math.sqrt(out.reduce((sum, v) => sum + v * v, 0));
    expect(magnitude).toBeCloseTo(1, 10);
  });

  it("strips a trailing slash from the base url", async () => {
    let seenUrl = "";
    const embedder = new HttpEmbedder({
      baseUrl: "http://embed.local///",
      fetchImpl: stubFetch((url) => {
        seenUrl = url;
        return jsonResponse({ embeddings: [vector()] });
      }),
    });
    await embedder.embed(["x"]);
    expect(seenUrl).toBe("http://embed.local/embed");
  });

  it("short-circuits an empty batch without a request", async () => {
    let called = false;
    const embedder = new HttpEmbedder({
      baseUrl: "http://embed.local",
      fetchImpl: stubFetch(() => {
        called = true;
        return jsonResponse({ embeddings: [] });
      }),
    });
    expect(await embedder.embed([])).toEqual([]);
    expect(called).toBe(false);
  });

  it("raises EmbeddingError on a non-2xx response", async () => {
    const embedder = new HttpEmbedder({
      baseUrl: "http://embed.local",
      fetchImpl: stubFetch(() => new Response("nope", { status: 503 })),
    });
    await expect(embedder.embed(["x"])).rejects.toThrow(/returned 503/);
    await expect(embedder.embed(["x"])).rejects.toBeInstanceOf(EmbeddingError);
  });

  it("rejects a response with the wrong number of embeddings", async () => {
    // Callers zip by index; a short response would misattribute vectors.
    const embedder = new HttpEmbedder({
      baseUrl: "http://embed.local",
      fetchImpl: stubFetch(() => jsonResponse({ embeddings: [vector()] })),
    });
    await expect(embedder.embed(["a", "b"])).rejects.toThrow(/count mismatch/);
  });

  it("rejects a response with the wrong dimension", async () => {
    const embedder = new HttpEmbedder({
      baseUrl: "http://embed.local",
      fetchImpl: stubFetch(() =>
        jsonResponse({ embeddings: [vector(1, 768)] }),
      ),
    });
    await expect(embedder.embed(["a"])).rejects.toThrow(/dimension mismatch/);
  });

  it("rejects a response with no embeddings field", async () => {
    const embedder = new HttpEmbedder({
      baseUrl: "http://embed.local",
      fetchImpl: stubFetch(() => jsonResponse({ ok: true })),
    });
    await expect(embedder.embed(["a"])).rejects.toThrow(/no embeddings/);
  });

  it("wraps a transport failure as EmbeddingError", async () => {
    const embedder = new HttpEmbedder({
      baseUrl: "http://embed.local",
      fetchImpl: (() =>
        Promise.reject(new Error("ECONNREFUSED"))) as unknown as typeof fetch,
    });
    await expect(embedder.embed(["a"])).rejects.toThrow(/unreachable/);
  });

  it("times out instead of hanging the ingest worker", async () => {
    const embedder = new HttpEmbedder({
      baseUrl: "http://embed.local",
      timeoutMs: 5,
      fetchImpl: ((_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          });
        })) as unknown as typeof fetch,
    });
    await expect(embedder.embed(["a"])).rejects.toThrow(/timed out after 5ms/);
  });

  it("reports the shared dimension by default", () => {
    const embedder = new HttpEmbedder({ baseUrl: "http://embed.local" });
    expect(embedder.dimensions).toBe(EMBEDDING_DIMENSIONS);
    expect(embedder.name).toBe("http");
  });
});
