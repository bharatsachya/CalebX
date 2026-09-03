/**
 * Trace and span ids are hex strings of the W3C trace-context widths (16 bytes
 * and 8 bytes). Not because we speak that protocol, but because every trace
 * viewer, log search, and grep pattern in the world already handles that shape.
 */

function hex(bytes: number): string {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  let out = "";
  for (const byte of buffer) out += byte.toString(16).padStart(2, "0");
  return out;
}

export function newTraceId(): string {
  return hex(16);
}

export function newSpanId(): string {
  return hex(8);
}

/** Deterministic id source for tests: `t0000…0001`, `s0000…01`, in order. */
export function sequentialIds(): {
  traceId(): string;
  spanId(): string;
  reset(): void;
} {
  let traces = 0;
  let spans = 0;
  return {
    traceId: () => `${(++traces).toString(16).padStart(32, "0")}`,
    spanId: () => `${(++spans).toString(16).padStart(16, "0")}`,
    reset: () => {
      traces = 0;
      spans = 0;
    },
  };
}
