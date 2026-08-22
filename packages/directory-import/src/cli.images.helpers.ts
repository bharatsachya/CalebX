import type { Gender } from "./candidate.card.ts";
import type { MappedRow } from "./candidate.ts";

export type Engine = "tesseract" | "vision";

export interface Options {
  paths: string[];
  write: boolean;
  force: boolean;
  gender: Gender;
  engine: Engine;
  /** Vision only: read each card twice and keep the numerics both agree on. */
  consensus: boolean;
  /** Write the full mapped result here, for review or a later re-run. */
  json: string | undefined;
  /** Commit a previously reviewed `--json` file instead of reading images. */
  fromJson: string | undefined;
}

/** Reads a `--flag value` pair. */
export function flagValue(argv: string[], name: string): string | undefined {
  const at = argv.indexOf(name);
  return at === -1 ? undefined : argv[at + 1];
}

export function parseArgs(argv: string[]): Options {
  const valueIndices = new Set(
    ["--gender", "--engine", "--model", "--json", "--from-json"]
      .map((name) => argv.indexOf(name))
      .filter((at) => at !== -1)
      .map((at) => at + 1),
  );
  const gender = flagValue(argv, "--gender");
  const engine = flagValue(argv, "--engine");

  return {
    paths: argv.filter(
      (arg, i) => !arg.startsWith("--") && !valueIndices.has(i),
    ),
    write: argv.includes("--write"),
    force: argv.includes("--force"),
    gender: gender === "male" || gender === "female" ? gender : null,
    engine: engine === "vision" ? "vision" : "tesseract",
    consensus: !argv.includes("--no-consensus"),
    json: flagValue(argv, "--json"),
    fromJson: flagValue(argv, "--from-json"),
  };
}

/**
 * Every mapped row, not a sample.
 *
 * This output is the entire point of a dry run — it is what a person reads
 * before agreeing to write a stranger's biodata into a shared sheet. Truncating
 * it to the first three hid two thirds of the result, including whichever rows
 * had problems. Use `--json` when a booklet's worth is too much to scroll.
 */
export function printRows(rows: MappedRow[]): void {
  console.log(`\nAll ${rows.length} row(s):`);
  for (const row of rows) {
    console.log(`  ${row.userId}`);
    for (const [key, value] of Object.entries(row.candidate)) {
      console.log(`      ${key}: ${value}`);
    }
    if (row.contact) {
      for (const [key, value] of Object.entries(row.contact)) {
        if (key !== "user_id" && key !== "updated_at") {
          console.log(`      → Contacts.${key}: ${value}`);
        }
      }
    }
  }
}
