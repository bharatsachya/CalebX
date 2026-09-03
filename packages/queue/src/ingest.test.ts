/// <reference types="bun" />
import { beforeEach, describe, expect, it } from "bun:test";
import { userPrincipal } from "@calebx/authz";
import { HashEmbedder } from "@calebx/embed";
import { MemoryGraphStore } from "@calebx/graph";
import { runIngest, type IngestDeps } from "./ingest.ts";
import type { IngestJob } from "./payloads.ts";

const USER = "tg:1001";

let graph: MemoryGraphStore;
let extracted: string;
let deps: IngestDeps;
let extractCalls: { prompt: string; text: string }[];

const job: IngestJob = {
  userId: USER,
  mode: "community_connector",
  text: "I've been working out of cafes in Koramangala",
  reply: "Nice.",
};

beforeEach(() => {
  graph = new MemoryGraphStore(() => 1_700_000_000_000);
  extractCalls = [];
  extracted = JSON.stringify({
    location_hint: null,
    chunks: [{ text: "works out of cafes", category: "interest" }],
  });
  deps = {
    extract: async (prompt, text) => {
      extractCalls.push({ prompt, text });
      return extracted;
    },
    promptFor: (mode) => `PROMPT:${mode}`,
    parse: (raw) => {
      const parsed = JSON.parse(raw) as {
        location_hint: string | null;
        chunks: { text: string; category: "interest" | "location" }[];
      };
      return { locationHint: parsed.location_hint, chunks: parsed.chunks };
    },
    embed: new HashEmbedder(),
    graph,
    principalFor: (userId, mode) => userPrincipal(userId, mode),
  };
});

describe("community ingestion", () => {
  it("writes the extracted chunks to the graph", async () => {
    const report = await runIngest(deps, job);
    expect(report).toEqual({ chunksWritten: 1, skipped: false });

    const chunks = await graph.listChunks(
      userPrincipal(USER, "community_connector"),
      USER,
    );
    expect(chunks[0].text).toBe("works out of cafes");
    expect(chunks[0].embedding).toHaveLength(384);
  });

  it("uses the mode-specific extraction prompt", async () => {
    await runIngest(deps, job);
    expect(extractCalls[0].prompt).toBe("PROMPT:community_connector");
    expect(extractCalls[0].text).toBe(job.text);
  });

  it("turns a location hint into its own chunk", async () => {
    // The location is what later decides whose cohorts and which city's places.
    extracted = JSON.stringify({ location_hint: "Koramangala", chunks: [] });
    const report = await runIngest(deps, job);
    expect(report.chunksWritten).toBe(1);
    const chunks = await graph.listChunks(
      userPrincipal(USER, "community_connector"),
      USER,
    );
    expect(chunks[0].category).toBe("location");
    expect(chunks[0].text).toContain("Koramangala");
  });

  it("does not add a location chunk when extraction already produced one", async () => {
    extracted = JSON.stringify({
      location_hint: "Koramangala",
      chunks: [{ text: "lives in Koramangala", category: "location" }],
    });
    const report = await runIngest(deps, job);
    expect(report.chunksWritten).toBe(1);
  });

  it("writes nothing when a turn carried no durable fact", async () => {
    extracted = JSON.stringify({ location_hint: null, chunks: [] });
    expect(await runIngest(deps, job)).toEqual({
      chunksWritten: 0,
      skipped: false,
    });
  });

  it("embeds every chunk in one batch", async () => {
    let batches = 0;
    deps.embed = {
      name: "counting",
      dimensions: 384,
      embed: async (texts) => {
        batches += 1;
        return texts.map(() => new Array<number>(384).fill(0));
      },
    };
    extracted = JSON.stringify({
      location_hint: null,
      chunks: [
        { text: "works out of cafes", category: "interest" },
        { text: "avoids loud rooms", category: "interest" },
      ],
    });
    await runIngest(deps, job);
    expect(batches).toBe(1);
  });

  it("appends rather than replacing, so contradictions survive", async () => {
    await runIngest(deps, job);
    extracted = JSON.stringify({
      location_hint: null,
      chunks: [
        {
          text: "actually prefers working from home now",
          category: "interest",
        },
      ],
    });
    await runIngest(deps, job);
    const chunks = await graph.listChunks(
      userPrincipal(USER, "community_connector"),
      USER,
    );
    expect(chunks).toHaveLength(2);
  });
});

describe("matchmaker ingestion", () => {
  it("writes nothing at all", async () => {
    // A background job inferring "prefers vegetarian" from one sentence is the
    // silent profile rewrite the confirmation rule exists to prevent.
    const report = await runIngest(deps, { ...job, mode: "matchmaker" });
    expect(report.skipped).toBe(true);
    expect(report.chunksWritten).toBe(0);
    expect(report.reason).toContain("confirmed tool");
  });

  it("does not even call the extractor", async () => {
    await runIngest(deps, { ...job, mode: "matchmaker" });
    expect(extractCalls).toEqual([]);
  });
});
