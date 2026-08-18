import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * One place that knows where the monorepo root is, and the only place that calls
 * dotenv.
 *
 * Every package used to repeat `dotenv.config({ path: resolve(__dirname, "../../../.env") })`.
 * That hard-codes each package's depth from the root, so it silently breaks the
 * moment a file moves into a subdirectory, and it re-parses .env once per
 * importing module. Here the root is *discovered* instead of counted.
 */

/** Markers that identify the monorepo root, most specific first. */
function isRepoRoot(dir: string): boolean {
  if (fs.existsSync(path.join(dir, "bun.lock"))) return true;
  const pkgPath = path.join(dir, "package.json");
  if (!fs.existsSync(pkgPath)) return false;
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
      workspaces?: unknown;
    };
    return pkg.workspaces !== undefined;
  } catch {
    return false;
  }
}

function findRepoRoot(): string {
  // An explicit override wins — useful for containers that copy only `dist/`,
  // where none of the workspace markers survive the build.
  const override = process.env.CALEBX_ROOT;
  if (override && override.trim() !== "") return path.resolve(override.trim());

  // Search up from this module first (stable regardless of cwd), then from cwd
  // (covers the case where this package is installed outside the repo tree).
  const starts = [path.dirname(fileURLToPath(import.meta.url)), process.cwd()];
  for (const start of starts) {
    let dir = start;
    for (;;) {
      if (isRepoRoot(dir)) return dir;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return process.cwd();
}

export const repoRoot: string = findRepoRoot();

/**
 * Loading is idempotent and happens on first import of this module. dotenv never
 * overwrites variables that are already set, so a real environment (CI, Docker,
 * systemd) always wins over the checked-out .env file.
 */
dotenv.config({ path: path.join(repoRoot, ".env") });

/** Resolve a path relative to the monorepo root. */
export function rootPath(...segments: string[]): string {
  return path.resolve(repoRoot, ...segments);
}

/** Resolve a path inside the gitignored `.data/` directory at the repo root. */
export function dataPath(...segments: string[]): string {
  return rootPath(".data", ...segments);
}

/**
 * A value is "unset" if it is missing, blank, or still the `YOUR_X_HERE`
 * placeholder from .env.example — pasting the example verbatim is the most
 * common misconfiguration, and it should fail like an empty value, not like a
 * valid credential.
 */
function read(name: string): string | undefined {
  const value = process.env[name];
  if (!value) return undefined;
  const trimmed = value.trim();
  if (trimmed === "" || trimmed === `YOUR_${name}_HERE`) return undefined;
  return trimmed;
}

export class MissingEnvError extends Error {
  constructor(
    readonly name: string,
    scope?: string,
  ) {
    super(
      `${scope ? `[${scope}] ` : ""}Missing required environment variable: ${name}.\n` +
        `Copy .env.example to .env at the repo root and fill it in.`,
    );
    this.name = "MissingEnvError";
  }
}

/**
 * Reader bound to a package name, so error messages say which package needed the
 * variable. `env("sheets").required("GOOGLE_PRIVATE_KEY")`.
 */
export function env(scope?: string) {
  return {
    /** Throws `MissingEnvError` when unset. Prefer this inside lazy getters. */
    required(name: string): string {
      const value = read(name);
      if (value === undefined) throw new MissingEnvError(name, scope);
      return value;
    },

    /**
     * Like `required`, but exits the process instead of throwing. For values read
     * at module load in an entry point, where a stack trace is noise — the user
     * needs the one-line fix, not a trace through dotenv.
     */
    requiredOrExit(name: string): string {
      const value = read(name);
      if (value === undefined) {
        const error = new MissingEnvError(name, scope);
        // Fatal boot error, before any logger is wired up. stderr is the contract.
        console.error(error.message);
        process.exit(1);
      }
      return value;
    },

    optional(name: string, fallback: string): string {
      return read(name) ?? fallback;
    },

    number(name: string, fallback: number): number {
      const raw = read(name);
      if (raw === undefined) return fallback;
      const parsed = Number(raw);
      return Number.isFinite(parsed) ? parsed : fallback;
    },

    boolean(name: string, fallback = false): boolean {
      const raw = read(name)?.toLowerCase();
      if (raw === undefined) return fallback;
      return raw === "true" || raw === "1" || raw === "yes";
    },
  };
}

export type Env = ReturnType<typeof env>;
