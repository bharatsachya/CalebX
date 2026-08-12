import type { IncomingMessage } from "node:http";

/** Meta's webhook payloads are small; anything larger is not a real delivery. */
export const MAX_BODY_BYTES = 1024 * 1024;

/**
 * Collects the request body as raw bytes, capped.
 *
 * Buffers are concatenated rather than string-joined: a multi-byte UTF-8
 * sequence (any emoji in a user's message) can straddle a chunk boundary, and
 * decoding per-chunk would corrupt it — and with it the HMAC computed over it.
 *
 * The cap matters because this is a public endpoint; an unbounded accumulator
 * is a one-line memory exhaustion.
 */
export function readRawBody(
  req: IncomingMessage,
  limit: number = MAX_BODY_BYTES,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;

    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("payload too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
