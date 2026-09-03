/// <reference types="bun" />
import { describe, expect, it } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EMBEDDING_DIMENSIONS } from "@calebx/embed";

const dir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "migrations",
);
const files = readdirSync(dir)
  .filter((name) => name.endsWith(".sql"))
  .sort();
const read = (name: string) => readFileSync(path.join(dir, name), "utf8");
const migration009 = read("009_agent_modes_and_community.sql");

describe("migration files", () => {
  it("are numbered contiguously from 001", () => {
    // They are applied in filename order, so a gap or a duplicate number means
    // the order is no longer obvious to a reader.
    const numbers = files.map((name) => Number(name.slice(0, 3)));
    expect(numbers).toEqual(numbers.map((_, index) => index + 1));
  });

  it("has 009 as the current head", () => {
    expect(files.at(-1)).toBe("009_agent_modes_and_community.sql");
  });
});

describe("009: pgvector", () => {
  it("creates the extension rather than assuming the host has it", () => {
    expect(migration009).toContain("CREATE EXTENSION IF NOT EXISTS vector");
  });

  it("declares the vector column at the shared embedding dimension", () => {
    // This is the guard against the one mistake that silently breaks retrieval:
    // the model, the Neo4j index, and this column disagreeing.
    expect(migration009).toContain(
      `interest_embedding vector(${EMBEDDING_DIMENSIONS})`,
    );
  });

  it("indexes the vector column for cosine", () => {
    expect(migration009).toContain(
      "USING hnsw (interest_embedding vector_cosine_ops)",
    );
  });
});

describe("009: mode state", () => {
  it("defines the two modes and nothing else", () => {
    expect(migration009).toContain(
      "CREATE TYPE agent_mode AS ENUM ('matchmaker', 'community_connector')",
    );
  });

  it("models enrolment as a set alongside one active mode", () => {
    // /switch moves active_mode; enrolled_modes is what the user has consented
    // to and has a profile for. Neither is derivable from the other.
    expect(migration009).toContain("active_mode    agent_mode");
    expect(migration009).toContain(
      "enrolled_modes agent_mode[] NOT NULL DEFAULT '{}'",
    );
  });

  it("keys consent by (user, mode), not by user", () => {
    expect(migration009).toContain("PRIMARY KEY (user_id, mode)");
  });

  it("cascades consent when the user row goes, so /forget is complete", () => {
    expect(migration009).toContain(
      "REFERENCES agent_users(user_id) ON DELETE CASCADE",
    );
  });

  it("defaults discoverability to false", () => {
    // People discovery is opt-in. A column defaulting to true would enrol every
    // existing candidate without asking.
    expect(migration009).toContain(
      "discoverable       boolean NOT NULL DEFAULT false",
    );
  });
});

describe("009: review queue and cohort registry", () => {
  it("covers every escalation kind the design has", () => {
    for (const kind of [
      "create_group",
      "mutual_interest",
      "contact_share",
      "agent_escalation",
    ]) {
      expect(migration009).toContain(`'${kind}'`);
    }
  });

  it("indexes only open tasks, which is the only query the queue runs", () => {
    expect(migration009).toContain("WHERE state = 'open'");
  });

  it("allows a cohort to exist before its group does", () => {
    // A bot cannot create a Telegram group, so group_id starts NULL and an
    // admin fills it in later (A2).
    expect(migration009).toContain("group_id    text UNIQUE");
    expect(migration009).not.toMatch(/group_id\s+text\s+UNIQUE\s+NOT NULL/);
  });
});
