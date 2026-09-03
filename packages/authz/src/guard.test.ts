/// <reference types="bun" />
import { describe, expect, it } from "bun:test";
import { ForbiddenError } from "@calebx/errors";
import { assertAuthorized, can, filterAuthorized } from "./guard.ts";
import { systemPrincipal, userPrincipal } from "./principal.ts";
import { ownedBy, type ResourceRef } from "./resource.ts";

const ALICE = "tg:1001";
const alice = userPrincipal(ALICE, "community_connector");

describe("assertAuthorized", () => {
  it("returns the decision when allowed", () => {
    const decision = assertAuthorized(
      alice,
      "read",
      ownedBy("persona_chunk", ALICE, "community_connector"),
    );
    expect(decision.projection).toBe("full");
  });

  it("throws ForbiddenError carrying the reason and the action", () => {
    try {
      assertAuthorized(
        alice,
        "read",
        ownedBy("persona_chunk", "tg:2002", "community_connector"),
      );
      throw new Error("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ForbiddenError);
      const forbidden = error as ForbiddenError;
      expect(forbidden.reason).toBe("not owner");
      expect(forbidden.action).toBe("read:persona_chunk");
      expect(forbidden.code).toBe("ERR_FORBIDDEN");
    }
  });

  it("never puts the other user's id in the message", () => {
    // A denial message can end up in front of a user; leaking the id of the
    // person they were not allowed to see defeats the purpose.
    try {
      assertAuthorized(
        alice,
        "read",
        ownedBy("persona_chunk", "tg:2002", "community_connector"),
      );
    } catch (error) {
      expect((error as Error).message).not.toContain("tg:2002");
    }
  });
});

describe("can", () => {
  it("answers without throwing", () => {
    expect(
      can(
        alice,
        "read",
        ownedBy("persona_chunk", ALICE, "community_connector"),
      ),
    ).toBe(true);
    expect(
      can(
        alice,
        "read",
        ownedBy("persona_chunk", "tg:2002", "community_connector"),
      ),
    ).toBe(false);
  });
});

describe("filterAuthorized", () => {
  interface Peer {
    userId: string;
    discoverable: boolean;
  }

  const toRef = (peer: Peer): ResourceRef => ({
    kind: "peer",
    ownerId: peer.userId,
    mode: "community_connector",
    discoverable: peer.discoverable,
  });

  it("keeps discoverable peers and drops the rest", () => {
    const peers: Peer[] = [
      { userId: "tg:2002", discoverable: true },
      { userId: "tg:3003", discoverable: false },
      { userId: "tg:4004", discoverable: true },
    ];
    const allowed = filterAuthorized(alice, "read_anonymized", peers, toRef);
    expect(allowed.map((a) => a.item.userId)).toEqual(["tg:2002", "tg:4004"]);
  });

  it("pairs each survivor with its projection", () => {
    const allowed = filterAuthorized(
      alice,
      "read_anonymized",
      [{ userId: "tg:2002", discoverable: true }],
      toRef,
    );
    expect(allowed[0].decision.projection).toBe("anonymized");
  });

  it("returns an empty list rather than throwing when nothing is allowed", () => {
    // One non-discoverable peer in a result set is normal, not an error.
    const allowed = filterAuthorized(
      alice,
      "read_anonymized",
      [{ userId: "tg:3003", discoverable: false }],
      toRef,
    );
    expect(allowed).toEqual([]);
  });

  it("handles an empty input", () => {
    expect(filterAuthorized(alice, "read_anonymized", [], toRef)).toEqual([]);
  });

  it("drops everything for a principal that may not perform the action at all", () => {
    const job = systemPrincipal("cohort");
    const allowed = filterAuthorized(
      job,
      "read_anonymized",
      [{ userId: "tg:2002", discoverable: true }],
      toRef,
    );
    expect(allowed).toEqual([]);
  });
});
