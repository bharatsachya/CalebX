/**
 * Posts a WhatsApp webhook fixture to the local bot, signed exactly as Meta
 * would sign it. Lets the whole endpoint be exercised with no Meta account and
 * no tunnel.
 *
 *   bun run scripts/wa-post.ts text
 *   bun run scripts/wa-post.ts status --expect-no-reply
 *   bun run scripts/wa-post.ts text --repeat 2      # dedupe check
 *   bun run scripts/wa-post.ts text --tamper        # signature check
 *   bun run scripts/wa-post.ts --list
 */
import { createHmac } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
// Importing @calebx/config loads the root .env and locates the repo root, so
// this script works regardless of the cwd it is launched from.
import { env, rootPath } from "@calebx/config";

const FIXTURES = rootPath("packages/whatsapp-bot/fixtures");
const e = env("wa-post");

const args = process.argv.slice(2);
const flag = (name: string): boolean => args.includes(name);
const flagValue = (name: string): string | undefined => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
};

async function listFixtures(): Promise<string[]> {
  const files = await readdir(FIXTURES);
  return files.filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5));
}

// Wrapped in main() rather than using top-level await, so this runs identically
// under `bun run` and `npx tsx` (the repo root is not "type": "module").
async function main(): Promise<void> {
  if (flag("--list") || args.length === 0) {
    console.log((await listFixtures()).map((n) => `  ${n}`).join("\n"));
    return;
  }

  const appSecret = e.optional("WHATSAPP_APP_SECRET", "");
  if (appSecret === "") {
    console.error("WHATSAPP_APP_SECRET is not set — add it to .env.");
    process.exitCode = 1;
    return;
  }

  const port = e.number("WHATSAPP_PORT", 8787);
  const webhookPath = e.optional("WHATSAPP_WEBHOOK_PATH", "/webhook");
  const url = `http://localhost:${port}${webhookPath}`;

  const name = args[0]!;
  const raw = await readFile(path.join(FIXTURES, `${name}.json`), "utf8");

  // Refresh timestamps to "now" so fixtures stay inside the freshness window as
  // they age — except `stale`, whose whole purpose is to be too old.
  const nowSeconds = String(Math.floor(Date.now() / 1000));
  const body =
    name === "stale"
      ? raw
      : raw.replace(/"timestamp": "19\d{8}"/g, `"timestamp": "${nowSeconds}"`);

  // Sign the exact bytes we send — see packages/whatsapp-bot/src/signature.ts.
  const payload = Buffer.from(body, "utf8");
  const digest = createHmac("sha256", appSecret).update(payload).digest("hex");
  const signature = flag("--tamper")
    ? `sha256=${"0".repeat(digest.length)}`
    : `sha256=${digest}`;

  const repeat = Number(flagValue("--repeat") ?? "1");

  for (let attempt = 1; attempt <= repeat; attempt++) {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": signature,
      },
      body: payload,
    });
    const text = await response.text();
    const label = repeat > 1 ? ` (attempt ${attempt}/${repeat})` : "";
    console.log(
      `${name}${label} → HTTP ${response.status} ${text || "<empty>"}`,
    );
  }
}

void main();
