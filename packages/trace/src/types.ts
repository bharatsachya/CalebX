/**
 * Span vocabulary. Deliberately small: a span is a named, timed, possibly-failed
 * unit of work with a parent. Anything richer (links, baggage, metrics) is not
 * needed to answer the only question this package exists for — "what did the
 * agent do for this turn, in what order, and where did the time go".
 */

/**
 * The kind decides how a span renders and which attributes are expected. It is
 * also the unit of filtering: "show me every `llm` span slower than 2s".
 */
export type SpanKind =
  | "internal"
  | "llm"
  | "tool"
  | "db"
  | "graph"
  | "embed"
  | "queue"
  | "dispatch"
  | "http"
  | "authz";

export type SpanStatus = "unset" | "ok" | "error";

export type AttributeValue = string | number | boolean | null;

export interface SpanAttributes {
  [key: string]: AttributeValue | undefined;
}

export interface SpanEvent {
  at: number;
  name: string;
  attributes: SpanAttributes;
}

export interface SpanError {
  name: string;
  message: string;
  code?: string;
}

/** A finished span. This is the only shape exporters ever see. */
export interface SpanRecord {
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  name: string;
  kind: SpanKind;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  status: SpanStatus;
  error?: SpanError;
  attributes: SpanAttributes;
  events: SpanEvent[];
}

/**
 * What flows implicitly through async calls. `traceId` doubles as the
 * `correlationId` used by `@calebx/logger`, so a log line and a span can be
 * joined without threading an extra argument through every function.
 */
export interface TraceContext {
  traceId: string;
  spanId: string;
  userId?: string;
  mode?: string;
  jobId?: string;
}

export interface SpanExporter {
  export(span: SpanRecord): void;
  flush?(): Promise<void>;
}

export interface SpanOptions {
  kind?: SpanKind;
  attributes?: SpanAttributes;
  /** Force a parent instead of taking it from the ambient context. */
  parent?: TraceContext;
}

/** Injectable so tests get deterministic ids and durations. */
export interface TracerClock {
  now(): number;
}

export interface TracerIdSource {
  traceId(): string;
  spanId(): string;
}
