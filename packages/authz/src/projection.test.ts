/// <reference types="bun" />
import { describe, expect, it } from "bun:test";
import {
  anonymizePeer,
  peerHandle,
  project,
  projectAll,
  type PeerProfile,
} from "./projection.ts";

const SALT = "test-salt";

describe("peerHandle", () => {
  it("is stable for the same user and salt", () => {
    expect(peerHandle("tg:2002", SALT)).toBe(peerHandle("tg:2002", SALT));
  });

  it("differs between users", () => {
    expect(peerHandle("tg:2002", SALT)).not.toBe(peerHandle("tg:3003", SALT));
  });

  it("differs between deployments with different salts", () => {
    expect(peerHandle("tg:2002", SALT)).not.toBe(
      peerHandle("tg:2002", "other"),
    );
  });

  it("does not contain the user id", () => {
    expect(peerHandle("tg:2002", SALT)).not.toContain("2002");
  });
});

describe("anonymizePeer", () => {
  const peer: PeerProfile = {
    userId: "tg:2002",
    displayName: "Priya",
    phone: "+919876543210",
    interests: ["indie hacking", "filter coffee"],
    area: "Koramangala",
    sharedConnections: 2,
    discoverable: true,
  };

  it("keeps only what the requester is allowed to see", () => {
    const card = anonymizePeer(peer, SALT);
    expect(card).toEqual({
      handle: peerHandle("tg:2002", SALT),
      interests: ["indie hacking", "filter coffee"],
      area: "Koramangala",
      sharedConnections: 2,
    });
  });

  it("carries no name, phone, or user id", () => {
    const serialized = JSON.stringify(anonymizePeer(peer, SALT));
    expect(serialized).not.toContain("Priya");
    expect(serialized).not.toContain("9876543210");
    expect(serialized).not.toContain("tg:2002");
  });

  it("copies the interests array so the caller cannot mutate the source", () => {
    const card = anonymizePeer(peer, SALT);
    card.interests.push("mutated");
    expect(peer.interests).toHaveLength(2);
  });

  it("defaults missing optional fields instead of emitting undefined", () => {
    const card = anonymizePeer(
      { userId: "tg:4004", interests: [], discoverable: true },
      SALT,
    );
    expect(card.area).toBeNull();
    expect(card.sharedConnections).toBe(0);
  });
});

describe("project", () => {
  const candidate = {
    id: "c1",
    full_name: "Priya R",
    phone: "+919876543210",
    email: "p@example.com",
    city: "Bengaluru",
    age: 29,
    interest_text: "trekking, filter coffee",
    photo_url: "https://example.com/p.jpg",
    user_id_hash: "abc123",
  };

  it("returns a copy for a full projection, not the original object", () => {
    const out = project(candidate, "full");
    expect(out).toEqual(candidate);
    expect(out).not.toBe(candidate);
  });

  it("strips identifying columns for an anonymized projection", () => {
    const out = project(candidate, "anonymized")!;
    expect(out.city).toBe("Bengaluru");
    expect(out.age).toBe(29);
    expect(out.interest_text).toBe("trekking, filter coffee");
    for (const hidden of [
      "full_name",
      "phone",
      "email",
      "photo_url",
      "user_id_hash",
    ]) {
      expect(hidden in out).toBe(false);
    }
  });

  it("returns null for a 'none' projection", () => {
    // A caller that forgot to check `allowed` gets nothing, not everything.
    expect(project(candidate, "none")).toBeNull();
  });

  it("hides both snake_case and camelCase spellings of the same field", () => {
    const out = project(
      { fullName: "X", waPhone: "+91", telegramId: 7, city: "Pune" },
      "anonymized",
    )!;
    expect(out).toEqual({ city: "Pune" });
  });

  it("keeps unknown-but-harmless columns", () => {
    const out = project({ some_new_metric: 4 }, "anonymized")!;
    expect(out.some_new_metric).toBe(4);
  });

  it("handles an empty record", () => {
    expect(project({}, "anonymized")).toEqual({});
  });
});

describe("projectAll", () => {
  it("projects every record", () => {
    const out = projectAll(
      [
        { name: "A", city: "X" },
        { name: "B", city: "Y" },
      ],
      "anonymized",
    );
    expect(out).toEqual([{ city: "X" }, { city: "Y" }]);
  });

  it("returns an empty list for a 'none' projection", () => {
    expect(projectAll([{ name: "A" }], "none")).toEqual([]);
  });
});
