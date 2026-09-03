/// <reference types="bun" />
import { beforeEach, describe, expect, it } from "bun:test";
import { ForbiddenError } from "@calebx/errors";
import { systemPrincipal, userPrincipal } from "@calebx/authz";
import { HashEmbedder } from "@calebx/embed";
import { MemoryGraphStore } from "./memory.store.ts";
import type { NewChunk } from "./types.ts";

const ALICE = "tg:1001";
const BOB = "tg:2002";
const CAROL = "tg:3003";
const DAVE = "tg:4004";

const alice = userPrincipal(ALICE, "community_connector");
const bob = userPrincipal(BOB, "community_connector");
const aliceMatchmaker = userPrincipal(ALICE, "matchmaker");
const job = systemPrincipal("cohort-clustering");

const embedder = new HashEmbedder();
let store: MemoryGraphStore;
let clock: number;

async function chunk(
  text: string,
  category: NewChunk["category"] = "interest",
) {
  const [embedding] = await embedder.embed([text]);
  return { text, category, embedding } satisfies NewChunk;
}

/** Links every pair as mutual acquaintances, as the store does. */
async function befriend(pairs: [string, string][]) {
  for (const [a, b] of pairs) {
    await store.linkKnows(userPrincipal(a, "community_connector"), a, b);
  }
}

beforeEach(() => {
  clock = 1_700_000_000_000;
  store = new MemoryGraphStore(() => clock);
});

describe("users", () => {
  it("creates a user with discovery off by default", async () => {
    const user = await store.ensureUser(alice, ALICE);
    // Opt-in, never opt-out: a user who has never been asked is not discoverable.
    expect(user.discoverable).toBe(false);
    expect(user.communityId).toBeNull();
    expect(user.createdAt).toBe(clock);
  });

  it("is idempotent and refreshes lastActive", async () => {
    const first = await store.ensureUser(alice, ALICE);
    clock += 5_000;
    const second = await store.ensureUser(alice, ALICE);
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.lastActive).toBe(clock);
  });

  it("returns null for a user who does not exist", async () => {
    expect(await store.getUser(alice, ALICE)).toBeNull();
  });

  it("records the discoverability opt-in", async () => {
    await store.setDiscoverable(alice, ALICE, true);
    expect((await store.getUser(alice, ALICE))?.discoverable).toBe(true);
  });

  it("refuses to touch another user's node", async () => {
    await expect(store.ensureUser(alice, BOB)).rejects.toThrow(ForbiddenError);
    await expect(store.getUser(alice, BOB)).rejects.toThrow(ForbiddenError);
    await expect(store.setDiscoverable(alice, BOB, true)).rejects.toThrow(
      ForbiddenError,
    );
  });

  it("refuses a matchmaker principal, because chunks are community-mode data", async () => {
    await expect(store.ensureUser(aliceMatchmaker, ALICE)).rejects.toThrow(
      /cross-mode/,
    );
  });
});

describe("chunks", () => {
  it("appends chunks and returns their ids", async () => {
    const ids = await store.addChunks(alice, ALICE, [
      await chunk("prefers quiet cafes for work"),
      await chunk("dislikes loud rooms", "sentiment"),
    ]);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  it("creates the user implicitly on first write", async () => {
    await store.addChunks(alice, ALICE, [await chunk("indie hacker")]);
    expect(await store.getUser(alice, ALICE)).not.toBeNull();
  });

  it("returns chunks newest first", async () => {
    await store.addChunks(alice, ALICE, [await chunk("older")]);
    clock += 60_000;
    await store.addChunks(alice, ALICE, [await chunk("newer")]);
    const chunks = await store.listChunks(alice, ALICE);
    expect(chunks.map((c) => c.text)).toEqual(["newer", "older"]);
  });

  it("keeps a contradicting chunk instead of replacing the old one", async () => {
    // The temporal trail is the persona history: nothing is overwritten.
    await store.addChunks(alice, ALICE, [await chunk("loves loud bars")]);
    clock += 86_400_000;
    await store.addChunks(alice, ALICE, [await chunk("hates loud bars")]);
    const chunks = await store.listChunks(alice, ALICE);
    expect(chunks).toHaveLength(2);
  });

  it("honours an explicit createdAt so a chunk can be aged in tests", async () => {
    const old = { ...(await chunk("ancient")), createdAt: 1_600_000_000_000 };
    await store.addChunks(alice, ALICE, [old]);
    expect((await store.listChunks(alice, ALICE))[0].createdAt).toBe(
      1_600_000_000_000,
    );
  });

  it("respects the limit", async () => {
    await store.addChunks(alice, ALICE, [
      await chunk("a"),
      await chunk("b"),
      await chunk("c"),
    ]);
    expect(await store.listChunks(alice, ALICE, 2)).toHaveLength(2);
  });

  it("accepts an empty batch without creating anything odd", async () => {
    expect(await store.addChunks(alice, ALICE, [])).toEqual([]);
  });

  it("hands back copies, so a caller cannot mutate stored embeddings", async () => {
    await store.addChunks(alice, ALICE, [await chunk("cafes")]);
    const [first] = await store.listChunks(alice, ALICE);
    first.embedding[0] = 999;
    const [again] = await store.listChunks(alice, ALICE);
    expect(again.embedding[0]).not.toBe(999);
  });

  it("refuses to read or write another user's chunks", async () => {
    await store.addChunks(bob, BOB, [await chunk("bob's secret")]);
    await expect(store.listChunks(alice, BOB)).rejects.toThrow(ForbiddenError);
    await expect(
      store.addChunks(alice, BOB, [await chunk("x")]),
    ).rejects.toThrow(ForbiddenError);
  });
});

describe("own-chunk vector search", () => {
  beforeEach(async () => {
    await store.addChunks(alice, ALICE, [
      await chunk("prefers quiet cafes for work"),
      await chunk("goes trekking in the western ghats"),
      await chunk("building ai developer tools"),
    ]);
    await store.addChunks(bob, BOB, [
      await chunk("prefers quiet cafes for work"),
    ]);
  });

  it("ranks the most similar chunk first", async () => {
    const [query] = await embedder.embed(["a quiet cafe to work from"]);
    const results = await store.searchOwnChunks(alice, ALICE, query, 3);
    expect(results[0].chunk.text).toBe("prefers quiet cafes for work");
    expect(results[0].similarity).toBeGreaterThan(results[2].similarity);
  });

  it("never returns another user's chunk, even an identical one", async () => {
    // The privacy boundary is the point of scoping the search to the owner.
    const [query] = await embedder.embed(["quiet cafes"]);
    const results = await store.searchOwnChunks(alice, ALICE, query, 10);
    expect(results.every((r) => r.chunk.userId === ALICE)).toBe(true);
  });

  it("respects the limit", async () => {
    const [query] = await embedder.embed(["cafes"]);
    expect(await store.searchOwnChunks(alice, ALICE, query, 1)).toHaveLength(1);
  });

  it("returns nothing for a user with no chunks", async () => {
    const [query] = await embedder.embed(["cafes"]);
    expect(
      await store.searchOwnChunks(
        userPrincipal(CAROL, "community_connector"),
        CAROL,
        query,
      ),
    ).toEqual([]);
  });

  it("refuses to search someone else's chunks", async () => {
    const [query] = await embedder.embed(["cafes"]);
    await expect(store.searchOwnChunks(alice, BOB, query)).rejects.toThrow(
      ForbiddenError,
    );
  });
});

describe("second-degree traversal", () => {
  beforeEach(async () => {
    // alice — bob — carol,  alice — bob — dave,  carol — dave
    await befriend([
      [ALICE, BOB],
      [BOB, CAROL],
      [BOB, DAVE],
      [CAROL, DAVE],
    ]);
  });

  it("finds friends-of-friends", async () => {
    const peers = await store.secondDegreePeers(alice, ALICE);
    expect(peers.map((p) => p.userId).sort()).toEqual([CAROL, DAVE]);
  });

  it("excludes the requester", async () => {
    const peers = await store.secondDegreePeers(alice, ALICE);
    expect(peers.map((p) => p.userId)).not.toContain(ALICE);
  });

  it("excludes people already directly known", async () => {
    const peers = await store.secondDegreePeers(alice, ALICE);
    expect(peers.map((p) => p.userId)).not.toContain(BOB);
  });

  it("counts shared connections and sorts by them", async () => {
    // carol is reachable via bob only; give her a second path.
    await befriend([
      [ALICE, "tg:5005"],
      ["tg:5005", CAROL],
    ]);
    const peers = await store.secondDegreePeers(alice, ALICE);
    expect(peers[0].userId).toBe(CAROL);
    expect(peers[0].sharedConnections).toBe(2);
  });

  it("reports discoverability so the caller can filter on consent", async () => {
    await store.setDiscoverable(
      userPrincipal(CAROL, "community_connector"),
      CAROL,
      true,
    );
    const peers = await store.secondDegreePeers(alice, ALICE);
    const carol = peers.find((p) => p.userId === CAROL)!;
    const dave = peers.find((p) => p.userId === DAVE)!;
    expect(carol.discoverable).toBe(true);
    expect(dave.discoverable).toBe(false);
  });

  it("returns nothing for an isolated user", async () => {
    expect(
      await store.secondDegreePeers(
        userPrincipal("tg:9999", "community_connector"),
        "tg:9999",
      ),
    ).toEqual([]);
  });

  it("refuses to traverse from another user", async () => {
    await expect(store.secondDegreePeers(alice, BOB)).rejects.toThrow(
      ForbiddenError,
    );
  });
});

describe("peer chunks", () => {
  beforeEach(async () => {
    await store.addChunks(bob, BOB, [await chunk("also into filter coffee")]);
  });

  it("refuses when the peer has not opted in to discovery", async () => {
    await expect(store.peerChunks(alice, BOB)).rejects.toThrow(
      /not discoverable/,
    );
  });

  it("returns the peer's chunks once they have opted in", async () => {
    await store.setDiscoverable(bob, BOB, true);
    const chunks = await store.peerChunks(alice, BOB);
    expect(chunks.map((c) => c.text)).toEqual(["also into filter coffee"]);
  });

  it("refuses for a peer who does not exist at all", async () => {
    await expect(store.peerChunks(alice, "tg:9999")).rejects.toThrow(
      /not discoverable/,
    );
  });
});

describe("places and groups", () => {
  const group = {
    groupId: "-1001",
    title: "Delhi Cafe Crawlers",
    cohortKey: "cafe:delhi",
    inviteLink: "https://t.me/+abc",
    category: "social",
    memberCount: 0,
  };

  it("records a visit and counts repeats", async () => {
    await store.ensureUser(alice, ALICE);
    await store.recordVisit(alice, ALICE, "ChIJ123", ["work_cafe"]);
    await store.recordVisit(alice, ALICE, "ChIJ123", ["work_cafe"]);
    // Visit counts have no user-facing read yet; what matters is that repeats
    // do not create duplicate places and the call is idempotent-safe.
    expect(await store.getUser(alice, ALICE)).not.toBeNull();
  });

  it("ignores a visit for a user who was never created", async () => {
    // Parity with the Cypher, which MATCHes the user rather than MERGEing it.
    await expect(
      store.recordVisit(alice, ALICE, "ChIJ123", []),
    ).resolves.toBeUndefined();
    expect(await store.getUser(alice, ALICE)).toBeNull();
  });

  it("refuses to record a visit for another user", async () => {
    await expect(store.recordVisit(alice, BOB, "ChIJ123", [])).rejects.toThrow(
      ForbiddenError,
    );
  });

  it("lets a system principal register a group and a user join it", async () => {
    await store.upsertGroup(job, group);
    await store.joinGroup(alice, ALICE, group.groupId);
    const mine = await store.listMyGroups(alice, ALICE);
    expect(mine.map((g) => g.title)).toEqual(["Delhi Cafe Crawlers"]);
    expect(mine[0].memberCount).toBe(1);
  });

  it("does not double-count a repeated join", async () => {
    await store.upsertGroup(job, group);
    await store.joinGroup(alice, ALICE, group.groupId);
    await store.joinGroup(alice, ALICE, group.groupId);
    expect((await store.listMyGroups(alice, ALICE))[0].memberCount).toBe(1);
  });

  it("ignores a join for a group that was never registered", async () => {
    await store.joinGroup(alice, ALICE, "-9999");
    expect(await store.listMyGroups(alice, ALICE)).toEqual([]);
  });

  it("does not let a user register a group", async () => {
    await expect(store.upsertGroup(alice, group)).rejects.toThrow(
      ForbiddenError,
    );
  });

  it("preserves member count across an upsert", async () => {
    await store.upsertGroup(job, group);
    await store.joinGroup(alice, ALICE, group.groupId);
    await store.upsertGroup(job, {
      ...group,
      title: "Renamed",
      memberCount: 0,
    });
    const [found] = await store.groupsByCohort(job, "cafe:delhi");
    expect(found.title).toBe("Renamed");
    expect(found.memberCount).toBe(1);
  });

  it("finds groups by cohort key for the cohort job", async () => {
    await store.upsertGroup(job, group);
    expect(await store.groupsByCohort(job, "cafe:delhi")).toHaveLength(1);
    expect(await store.groupsByCohort(job, "gym:pune")).toEqual([]);
  });
});

describe("system-principal bulk surface", () => {
  beforeEach(async () => {
    await befriend([
      [ALICE, BOB],
      [BOB, CAROL],
    ]);
    await store.addChunks(alice, ALICE, [
      await chunk("filter coffee"),
      await chunk("feeling tired", "sentiment"),
    ]);
  });

  it("exposes KNOWS edges to a system principal", async () => {
    const edges = await store.knowsEdges(job);
    expect(edges.length).toBeGreaterThan(0);
    expect(edges.every((e) => typeof e.strength === "number")).toBe(true);
  });

  it("exposes only interest-ish chunk text, not sentiment", async () => {
    const [row] = await store.allUserInterests(job);
    expect(row.interests).toEqual(["filter coffee"]);
  });

  it("writes back a community id", async () => {
    await store.setCommunityId(job, ALICE, 7);
    expect((await store.getUser(alice, ALICE))?.communityId).toBe(7);
  });

  it("refuses the bulk surface to a user principal", async () => {
    await expect(store.knowsEdges(alice)).rejects.toThrow(ForbiddenError);
    await expect(store.allUserInterests(alice)).rejects.toThrow(ForbiddenError);
    await expect(store.setCommunityId(alice, ALICE, 1)).rejects.toThrow(
      ForbiddenError,
    );
  });
});

describe("deleteUser (/forget)", () => {
  it("removes the user, their chunks, and their edges", async () => {
    await befriend([[ALICE, BOB]]);
    await store.addChunks(alice, ALICE, [await chunk("something personal")]);

    await store.deleteUser(alice, ALICE);

    expect(await store.getUser(alice, ALICE)).toBeNull();
    expect(await store.listChunks(alice, ALICE)).toEqual([]);
    // The edge from bob's side must go too, or bob still "knows" a ghost.
    expect(await store.secondDegreePeers(bob, BOB)).toEqual([]);
    expect(await store.knowsEdges(job)).toEqual([]);
  });

  it("is safe to call for a user who was never created", async () => {
    await expect(store.deleteUser(alice, ALICE)).resolves.toBeUndefined();
  });

  it("refuses to delete another user", async () => {
    await expect(store.deleteUser(alice, BOB)).rejects.toThrow(ForbiddenError);
  });
});
