/// <reference types="bun" />
import { describe, expect, it } from "bun:test";
import { authorize } from "./policy.ts";
import {
  adminPrincipal,
  systemPrincipal,
  userPrincipal,
  type Principal,
} from "./principal.ts";
import { ownedBy, shared, type ResourceRef } from "./resource.ts";

const ALICE = "tg:1001";
const BOB = "tg:2002";

const alice = userPrincipal(ALICE, "matchmaker");
const aliceCommunity = userPrincipal(ALICE, "community_connector");
const bothModes = userPrincipal(ALICE, "matchmaker", [
  "matchmaker",
  "community_connector",
]);

const ownCandidate = ownedBy("candidate", ALICE, "matchmaker");
const bobsCandidate = ownedBy("candidate", BOB, "matchmaker");
const ownChunk = ownedBy("persona_chunk", ALICE, "community_connector");

describe("own data", () => {
  it("lets a user read and write their own record", () => {
    for (const action of [
      "read",
      "write",
      "delete",
      "read_anonymized",
    ] as const) {
      expect(authorize(alice, action, ownCandidate).allowed).toBe(true);
    }
  });

  it("gives the owner a full projection, not an anonymized one", () => {
    expect(authorize(alice, "read", ownCandidate).projection).toBe("full");
  });

  it("lets a user read their own contact details", () => {
    const own = ownedBy("contact_details", ALICE, "matchmaker");
    expect(authorize(alice, "read_contact", own).allowed).toBe(true);
  });

  it("refuses a bulk read even of your own data", () => {
    const decision = authorize(alice, "read_bulk", ownCandidate);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("users may not bulk-read");
  });
});

describe("another user's data", () => {
  it("denies a full read of a peer's record", () => {
    const decision = authorize(alice, "read", bobsCandidate);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("not owner");
  });

  it("denies writing to a peer's record", () => {
    for (const action of ["write", "delete"] as const) {
      expect(authorize(alice, action, bobsCandidate).allowed).toBe(false);
    }
  });

  it("allows an anonymized read only when the peer is discoverable", () => {
    const discoverable: ResourceRef = {
      ...bobsCandidate,
      discoverable: true,
    };
    const decision = authorize(alice, "read_anonymized", discoverable);
    expect(decision.allowed).toBe(true);
    expect(decision.projection).toBe("anonymized");
  });

  it("denies an anonymized read of a peer who has not opted in", () => {
    const decision = authorize(alice, "read_anonymized", bobsCandidate);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("peer not discoverable");
  });

  it("treats a missing discoverable flag as not discoverable", () => {
    // Absent must never mean permitted — a peer row written before the flag
    // existed is not consent.
    const decision = authorize(alice, "read_anonymized", {
      ...bobsCandidate,
      discoverable: undefined,
    });
    expect(decision.allowed).toBe(false);
  });

  it("never exposes contact details without an unlocked match", () => {
    const decision = authorize(
      alice,
      "read_contact",
      ownedBy("contact_details", BOB, "matchmaker"),
    );
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("contact not unlocked");
  });

  it("allows contact details once mutual interest unlocked them", () => {
    const decision = authorize(alice, "read_contact", {
      ...ownedBy("contact_details", BOB, "matchmaker"),
      contactUnlocked: true,
    });
    expect(decision.allowed).toBe(true);
    expect(decision.projection).toBe("full");
  });

  it("refuses to make a match or partner_prefs peer-visible at all", () => {
    for (const kind of ["match", "partner_prefs", "photo", "memory"] as const) {
      const decision = authorize(alice, "read_anonymized", {
        ...ownedBy(kind, BOB, "matchmaker"),
        discoverable: true,
      });
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toContain("never peer-visible");
    }
  });
});

describe("mode isolation", () => {
  it("denies reading your own data from the other mode", () => {
    const decision = authorize(alice, "read", ownChunk);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("cross-mode access");
  });

  it("allows it once acting in that mode", () => {
    expect(authorize(aliceCommunity, "read", ownChunk).allowed).toBe(true);
  });

  it("checks mode before ownership, so enrolment in both modes is not a bypass", () => {
    // `bothModes` is enrolled in community but is acting as matchmaker.
    const decision = authorize(bothModes, "read", ownChunk);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("cross-mode access");
  });

  it("denies a mode the user is not enrolled in even while acting in it", () => {
    const notEnrolled = userPrincipal(ALICE, "matchmaker", [
      "community_connector",
    ]);
    const decision = authorize(notEnrolled, "read", ownCandidate);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("not enrolled in mode");
  });

  it("allows mode-agnostic resources from either mode", () => {
    const modeless: ResourceRef = {
      kind: "mode_state",
      ownerId: ALICE,
      mode: null,
    };
    expect(authorize(alice, "read", modeless).allowed).toBe(true);
    expect(authorize(aliceCommunity, "read", modeless).allowed).toBe(true);
  });
});

describe("shared reference data", () => {
  it("lets any user read groups and places", () => {
    expect(authorize(aliceCommunity, "read", shared("group")).allowed).toBe(
      true,
    );
    expect(authorize(aliceCommunity, "read", shared("place")).allowed).toBe(
      true,
    );
  });

  it("does not let a user modify them", () => {
    for (const action of ["write", "delete"] as const) {
      const decision = authorize(aliceCommunity, action, shared("group"));
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toBe("users may not modify shared data");
    }
  });

  it("denies an unowned record of any other kind", () => {
    const orphan: ResourceRef = {
      kind: "candidate",
      ownerId: null,
      mode: "matchmaker",
    };
    expect(authorize(alice, "read", orphan).allowed).toBe(false);
  });
});

describe("admin principal", () => {
  const admin = adminPrincipal("coordinator-1");

  it("may review and resolve review tasks", () => {
    const task = shared("review_task");
    expect(authorize(admin, "review", task).allowed).toBe(true);
    expect(authorize(admin, "write", task).allowed).toBe(true);
  });

  it("may read contact details, which is the point of the role", () => {
    const contact = ownedBy("contact_details", BOB, "matchmaker");
    expect(authorize(admin, "read_contact", contact).allowed).toBe(true);
  });

  it("may not read community persona chunks", () => {
    // A matchmaking coordinator has no business in the community persona graph.
    const decision = authorize(admin, "read", ownChunk);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain("may not access persona_chunk");
  });

  it("may register a group they created", () => {
    // /register_group: the bot cannot create the group, so an admin does and
    // then hands the bot its id and invite link (A2).
    expect(authorize(admin, "write", shared("group")).allowed).toBe(true);
  });

  it("may not edit a user's own profile", () => {
    const decision = authorize(admin, "write", bobsCandidate);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain("may not write candidate");
  });

  it("may not delete anything", () => {
    expect(authorize(admin, "delete", bobsCandidate).allowed).toBe(false);
  });

  it("may not review something that is not a review task", () => {
    expect(authorize(admin, "review", bobsCandidate).allowed).toBe(false);
  });
});

describe("system principal", () => {
  const job = systemPrincipal("cohort-clustering");

  it("may bulk-read the graph, anonymized", () => {
    const decision = authorize(job, "read_bulk", shared("peer"));
    expect(decision.allowed).toBe(true);
    expect(decision.projection).toBe("anonymized");
  });

  it("may bulk-read persona chunks and groups", () => {
    for (const kind of ["persona_chunk", "group"] as const) {
      expect(authorize(job, "read_bulk", shared(kind)).allowed).toBe(true);
    }
  });

  it("may not bulk-read anything with contact details in it", () => {
    for (const kind of [
      "candidate",
      "contact_details",
      "match",
      "photo",
    ] as const) {
      const decision = authorize(job, "read_bulk", shared(kind));
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toContain("may not read");
    }
  });

  it("may not do any single-record read, write, or contact read", () => {
    for (const action of [
      "read",
      "write",
      "delete",
      "read_contact",
      "review",
    ] as const) {
      const decision = authorize(job, action, shared("peer"));
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toBe(
        "system principal may only bulk-read or write derived data",
      );
    }
  });

  it("may write exactly the three derived kinds", () => {
    // The cohort job cannot create a Telegram group itself (see A2), so filing
    // a task is its only way to get one made; it maintains group rows and the
    // derived communityId itself.
    for (const kind of ["review_task", "group", "community_label"] as const) {
      expect(authorize(job, "write", shared(kind)).allowed).toBe(true);
    }
  });

  it("may not write anything about a user beyond the community label", () => {
    for (const kind of [
      "peer",
      "persona_chunk",
      "candidate",
      "match",
    ] as const) {
      expect(authorize(job, "write", shared(kind)).allowed).toBe(false);
    }
  });

  it("may still not read or resolve review tasks", () => {
    expect(authorize(job, "read", shared("review_task")).allowed).toBe(false);
    expect(authorize(job, "review", shared("review_task")).allowed).toBe(false);
  });
});

describe("malformed principals", () => {
  const cases: [string, Principal][] = [
    [
      "blank user id",
      {
        kind: "user",
        userId: "",
        mode: "matchmaker",
        enrolledModes: ["matchmaker"],
      },
    ],
    [
      "whitespace user id",
      {
        kind: "user",
        userId: "   ",
        mode: "matchmaker",
        enrolledModes: ["matchmaker"],
      },
    ],
    [
      "padded user id",
      {
        kind: "user",
        userId: " tg:1001 ",
        mode: "matchmaker",
        enrolledModes: ["matchmaker"],
      },
    ],
    ["blank admin id", { kind: "admin", adminId: "" }],
    ["blank job name", { kind: "system", job: "" }],
  ];

  for (const [label, principal] of cases) {
    it(`denies everything for a ${label}`, () => {
      const decision = authorize(principal, "read", ownCandidate);
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toBe("malformed principal");
    });
  }

  it("does not treat a blank owner id as matching a blank principal", () => {
    const blankOwner: ResourceRef = {
      kind: "candidate",
      ownerId: "",
      mode: "matchmaker",
    };
    const blankUser: Principal = {
      kind: "user",
      userId: "",
      mode: "matchmaker",
      enrolledModes: ["matchmaker"],
    };
    expect(authorize(blankUser, "read", blankOwner).allowed).toBe(false);
  });
});

describe("id comparison is exact", () => {
  it("does not match on different case", () => {
    const upper = ownedBy("candidate", "TG:1001", "matchmaker");
    expect(authorize(alice, "read", upper).allowed).toBe(false);
  });

  it("does not match on a different namespace with the same digits", () => {
    // The whole reason ids are namespaced: wa:1001 is a different person.
    const other = ownedBy("candidate", "wa:1001", "matchmaker");
    expect(authorize(alice, "read", other).allowed).toBe(false);
  });

  it("does not match on a prefix", () => {
    const prefixed = ownedBy("candidate", "tg:10010", "matchmaker");
    expect(authorize(alice, "read", prefixed).allowed).toBe(false);
  });
});

describe("aliases", () => {
  // Matchmaking tables key ownership by a hash of the namespaced id, so one
  // person is named two ways and the policy has to accept both.
  const HASH = "hash-of-tg-1001";
  const withAlias = userPrincipal(ALICE, "matchmaker", ["matchmaker"], [HASH]);

  it("recognises a resource owned under an alias", () => {
    const byHash = ownedBy("candidate", HASH, "matchmaker");
    expect(authorize(withAlias, "read", byHash).allowed).toBe(true);
  });

  it("still recognises the primary id", () => {
    expect(authorize(withAlias, "read", ownCandidate).allowed).toBe(true);
  });

  it("does not recognise someone else's hash", () => {
    const other = ownedBy("candidate", "hash-of-tg-2002", "matchmaker");
    expect(authorize(withAlias, "read", other).allowed).toBe(false);
  });

  it("ignores a blank alias against a blank owner id", () => {
    const blankAlias = userPrincipal(ALICE, "matchmaker", ["matchmaker"], [""]);
    const blankOwner = {
      kind: "candidate",
      ownerId: "",
      mode: "matchmaker",
    } as const;
    expect(authorize(blankAlias, "read", blankOwner).allowed).toBe(false);
  });

  it("treats a principal with no aliases exactly as before", () => {
    expect(
      authorize(alice, "read", ownedBy("candidate", HASH, "matchmaker"))
        .allowed,
    ).toBe(false);
  });
});
