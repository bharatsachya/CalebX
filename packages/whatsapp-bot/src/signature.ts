import { createHmac, timingSafeEqual } from "node:crypto";

const PREFIX = "sha256=";

/**
 * Verifies Meta's `X-Hub-Signature-256` header over a webhook body.
 *
 * `rawBody` MUST be the exact bytes received. Re-serialising the parsed JSON
 * will not reproduce Meta's unicode escaping or key order, and the HMAC will
 * never match — this is the single most common cause of "my signature is
 * always wrong".
 *
 * The HMAC key is the app secret, not the access token and not the verify token.
 */
export function verifySignature(
  rawBody: Buffer,
  header: string | string[] | undefined,
  appSecret: string,
): boolean {
  if (typeof header !== "string" || !header.startsWith(PREFIX)) return false;

  const expected = createHmac("sha256", appSecret).update(rawBody).digest();
  const received = Buffer.from(header.slice(PREFIX.length), "hex");

  // Buffer.from(hex) silently truncates malformed input, and timingSafeEqual
  // THROWS on a length mismatch — an uncaught throw here would 500 and make
  // Meta retry a request that can never succeed.
  if (received.length !== expected.length) return false;
  return timingSafeEqual(received, expected);
}
