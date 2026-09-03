/// <reference types="bun" />
import { beforeEach, describe, expect, it } from "bun:test";
import { systemPrincipal, userPrincipal } from "@calebx/authz";
import { HashEmbedder } from "@calebx/embed";
import {
  CohortGroupsRepository,
  FakeSqlExecutor,
  ReviewTasksRepository,
} from "@calebx/db";
import { MemoryGraphStore } from "@calebx/graph";
import type { CommunityContext } from "./context.ts";
import {
  COMMUNITY_TOOLS,
  findLikeMindedPeople,
  getCuratedPlaces,
  savePersonaChunk,
  searchCommunityGroups,
} from "./tools/index.ts";
import { StubPlacesClient } from "./places.client.ts";

const ALICE = "tg:1001";
const BOB = "tg:2002";
const CAROL = "tg:3003";

const MODE = "community_connector" as const;
const NOW = 1_700_000_000_000;

let graph: MemoryGraphStore;
let sql: FakeSqlExecutor;
let context: CommunityContext;
const embedder = new HashEmbedder();

function principalFor(userId: string) {
  return userPrincipal(userId, MODE);
}

async function seedChunks(
  userId: string,
  texts: [string, "interest" | "location"][],
) {
  const embeddings = await embedder.embed(texts.map(([text]) => text));
  await graph.addChunks(
    principalFor(userId),
    userId,
    texts.map(([text, category], index) => ({
      text,
      category,
      embedding: embeddings[index],
    })),
  );
}

beforeEach(() => {
  graph = new MemoryGraphStore(() => NOW);
  sql = new FakeSqlExecutor();
  context = {
    principal: principalFor(ALICE),
    userId: ALICE,
    graph,
    embed: embedder,
    places: new StubPlacesClient(),
    repos: {
      cohorts: new CohortGroupsRepository(sql),
      review: new ReviewTasksRepository(sql),
    },
    systemPrincipal: systemPrincipal("community-lookup"),
    handleSalt: "test-salt",
    now: () => NOW,
  };
});

describe("tool definitions", () => {
  it("exposes exactly the four community tools", () => {
    expect(COMMUNITY_TOOLS.map((t) => t.name)).toEqual([
      "save_persona_chunk",
      "find_like_minded_people",
      "search_community_groups",
      "get_curated_places",
    ]);
  });

  it("requires text and category to save a chunk", () => {
    expect(savePersonaChunk.parameters.required).toEqual(["text", "category"]);
  });
});

describe("save_persona_chunk", () => {
  it("embeds and stores the fact", async () => {
    const result = await savePersonaChunk.handler(context, {
      text: "prefers quiet cafes for work",
      category: "interest",
    });
    expect(result.ok).toBe(true);
    const chunks = await graph.listChunks(context.principal, ALICE);
    expect(chunks[0].text).toBe("prefers quiet cafes for work");
    expect(chunks[0].embedding).toHaveLength(384);
  });

  it("tells the model not to announce the save", async () => {
    // "I've noted that down" breaks the illusion and is also a lie about a
    // best-effort write.
    const result = await savePersonaChunk.handler(context, {
      text: "goes trekking most weekends",
      category: "interest",
    });
    expect(result.message).toContain("Do not tell the user");
  });

  it("rejects an unknown category", async () => {
    const result = await savePersonaChunk.handler(context, {
      text: "prefers quiet cafes for work",
      category: "vibes",
    });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("category must be one of");
  });

  it("rejects a fact too short to be useful", async () => {
    // One-word facts dilute every later search.
    const result = await savePersonaChunk.handler(context, {
      text: "cafes",
      category: "interest",
    });
    expect(result.ok).toBe(false);
    expect(await graph.listChunks(context.principal, ALICE)).toEqual([]);
  });

  it("rejects an empty fact", async () => {
    const result = await savePersonaChunk.handler(context, {
      text: "   ",
      category: "interest",
    });
    expect(result.ok).toBe(false);
  });

  it("appends rather than replacing, so contradictions both survive", async () => {
    await savePersonaChunk.handler(context, {
      text: "loves loud bars on weekends",
      category: "interest",
    });
    await savePersonaChunk.handler(context, {
      text: "avoids loud bars these days",
      category: "interest",
    });
    expect(await graph.listChunks(context.principal, ALICE)).toHaveLength(2);
  });
});

describe("find_like_minded_people", () => {
  beforeEach(async () => {
    // alice — bob — carol
    await graph.linkKnows(principalFor(ALICE), ALICE, BOB);
    await graph.linkKnows(principalFor(BOB), BOB, CAROL);
    await seedChunks(ALICE, [
      ["prefers quiet cafes for work", "interest"],
      ["lives in Koramangala", "location"],
    ]);
    await seedChunks(CAROL, [
      ["works from cafes most days", "interest"],
      ["lives in Indiranagar", "location"],
    ]);
  });

  it("says nothing is available when the peer has not opted in", async () => {
    const result = await findLikeMindedPeople.handler(context, {});
    expect(result.ok).toBe(false);
    expect(result.message).toContain("opted in");
  });

  it("returns an anonymous card once the peer opted in", async () => {
    await graph.setDiscoverable(principalFor(CAROL), CAROL, true);
    const result = await findLikeMindedPeople.handler(context, {});
    expect(result.ok).toBe(true);
    const { people } = result.data as { people: Record<string, unknown>[] };
    expect(people).toHaveLength(1);
    expect(people[0].interests).toContain("works from cafes most days");
    expect(people[0].sharedConnections).toBe(1);
  });

  it("never includes the peer's user id or a name", async () => {
    await graph.setDiscoverable(principalFor(CAROL), CAROL, true);
    const result = await findLikeMindedPeople.handler(context, {});
    const serialized = JSON.stringify(result.data);
    expect(serialized).not.toContain(CAROL);
    expect(serialized).not.toContain("3003");
  });

  it("gives a stable opaque handle so interest can be expressed later", async () => {
    await graph.setDiscoverable(principalFor(CAROL), CAROL, true);
    const first = await findLikeMindedPeople.handler(context, {});
    const second = await findLikeMindedPeople.handler(context, {});
    const handleOf = (result: typeof first) =>
      (result.data as { people: { handle: string }[] }).people[0].handle;
    expect(handleOf(first)).toBe(handleOf(second));
  });

  it("tells the model it may not reveal identity", async () => {
    await graph.setDiscoverable(principalFor(CAROL), CAROL, true);
    const result = await findLikeMindedPeople.handler(context, {});
    expect(result.message).toContain("Never a name");
  });

  it("offers nobody rather than strangers when there are no mutuals", async () => {
    const lonely: CommunityContext = {
      ...context,
      principal: principalFor("tg:9999"),
      userId: "tg:9999",
    };
    const result = await findLikeMindedPeople.handler(lonely, {});
    expect(result.ok).toBe(false);
    expect(result.message).toContain("do not offer strangers");
  });

  it("ranks a peer with shared interests above one without", async () => {
    const dave = "tg:4004";
    await graph.linkKnows(principalFor(BOB), BOB, dave);
    await seedChunks(dave, [["restores vintage motorcycles", "interest"]]);
    await graph.setDiscoverable(principalFor(CAROL), CAROL, true);
    await graph.setDiscoverable(principalFor(dave), dave, true);

    const result = await findLikeMindedPeople.handler(context, { limit: 2 });
    const { people } = result.data as { people: { interests: string[] }[] };
    expect(people[0].interests[0]).toContain("cafes");
  });

  it("respects the limit", async () => {
    const dave = "tg:4004";
    await graph.linkKnows(principalFor(BOB), BOB, dave);
    await seedChunks(dave, [["also works from cafes", "interest"]]);
    await graph.setDiscoverable(principalFor(CAROL), CAROL, true);
    await graph.setDiscoverable(principalFor(dave), dave, true);
    const result = await findLikeMindedPeople.handler(context, { limit: 1 });
    expect((result.data as { people: unknown[] }).people).toHaveLength(1);
  });
});

describe("search_community_groups", () => {
  beforeEach(async () => {
    await seedChunks(ALICE, [["loves filter coffee", "interest"]]);
    context.location = { latitude: 28.6, longitude: 77.2, city: "Delhi" };
  });

  it("asks for a city when none is known", async () => {
    context.location = undefined;
    const result = await searchCommunityGroups.handler(context, {});
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Ask which city");
  });

  it("derives the cohort key from interest and city", async () => {
    await searchCommunityGroups.handler(context, { interest: "filter coffee" });
    expect(sql.calls[0].params).toEqual([["cafe:delhi"]]);
  });

  it("falls back to stored chunks when no interest was passed", async () => {
    await searchCommunityGroups.handler(context, {});
    expect(sql.calls[0].params).toEqual([["cafe:delhi"]]);
  });

  it("returns a group with its invite link", async () => {
    sql.enqueue([
      {
        cohort_key: "cafe:delhi",
        group_id: "-1001",
        invite_link: "https://t.me/+abc",
        title: "Delhi Cafe Crawlers",
        member_hint: 8,
        registered_at: new Date(),
      },
    ]);
    const result = await searchCommunityGroups.handler(context, {});
    const { groups } = result.data as { groups: Record<string, unknown>[] };
    expect(groups[0].title).toBe("Delhi Cafe Crawlers");
    expect(groups[0].inviteLink).toBe("https://t.me/+abc");
  });

  it("does not invent a group when the cohort has none yet", async () => {
    const result = await searchCommunityGroups.handler(context, {});
    expect(result.ok).toBe(false);
    expect(result.message).toContain("do not invent one");
  });

  it("keeps quiet when nothing is known about their interests", async () => {
    const blank: CommunityContext = {
      ...context,
      principal: principalFor("tg:9999"),
      userId: "tg:9999",
    };
    const result = await searchCommunityGroups.handler(blank, {});
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Keep talking");
  });
});

describe("get_curated_places", () => {
  it("asks for a location when none is known", async () => {
    const result = await getCuratedPlaces.handler(context, {
      category: "cafe",
    });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Ask which neighbourhood");
  });

  it("returns places for an explicit category", async () => {
    context.location = { latitude: 12.97, longitude: 77.64, city: "Bengaluru" };
    const result = await getCuratedPlaces.handler(context, {
      category: "cafe",
    });
    expect(result.ok).toBe(true);
    const { places } = result.data as { places: { placeId: string }[] };
    expect(places[0].placeId).toBe("stub-cafe-1");
  });

  it("infers the category from stored chunks", async () => {
    context.location = { latitude: 12.97, longitude: 77.64, city: "Bengaluru" };
    await seedChunks(ALICE, [["goes trekking most weekends", "interest"]]);
    const result = await getCuratedPlaces.handler(context, {});
    const { places } = result.data as { places: { placeId: string }[] };
    expect(places[0].placeId).toBe("stub-outdoors-1");
  });

  it("asks rather than guessing when nothing is known", async () => {
    context.location = { latitude: 12.97, longitude: 77.64, city: "Bengaluru" };
    const result = await getCuratedPlaces.handler(context, {});
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Ask about that");
  });

  it("tells the model to describe the place, not its rating", async () => {
    context.location = { latitude: 12.97, longitude: 77.64, city: "Bengaluru" };
    const result = await getCuratedPlaces.handler(context, {
      category: "cafe",
    });
    expect(result.message).toContain("not their ratings");
  });

  it("offers to widen the area when nothing came back", async () => {
    context.location = { latitude: 12.97, longitude: 77.64, city: "Bengaluru" };
    context.places = { nearby: async () => [] };
    const result = await getCuratedPlaces.handler(context, {
      category: "cafe",
    });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("widen the area");
  });
});
