import { AsyncLocalStorage } from "node:async_hooks";
import { newSpanId, newTraceId } from "./ids.ts";
import { redactAttributes } from "./redact.ts";
import type {
  SpanAttributes,
  SpanExporter,
  SpanOptions,
  SpanRecord,
  SpanStatus,
  TraceContext,
  TracerClock,
  TracerIdSource,
} from "./types.ts";

/**
 * Context flows through `AsyncLocalStorage` rather than a `parentSpan` argument.
 * The alternative is threading a context object through every function in the
 * agent, including the ones that only exist to call one other function — and the
 * first place someone forgets to thread it is the place the trace silently loses
 * half the turn.
 */
const storage = new AsyncLocalStorage<TraceContext>();

interface TracerSettings {
  exporters: SpanExporter[];
  clock: TracerClock;
  ids: TracerIdSource;
  redact: boolean;
}

const defaults: TracerSettings = {
  exporters: [],
  clock: { now: () => Date.now() },
  ids: { traceId: newTraceId, spanId: newSpanId },
  redact: true,
};

let settings: TracerSettings = { ...defaults };

export function configureTracer(overrides: Partial<TracerSettings>): void {
  settings = { ...settings, ...overrides };
}

/** Restores factory settings. Tests call this in `beforeEach`. */
export function resetTracer(): void {
  settings = { ...defaults, exporters: [] };
}

export function addExporter(exporter: SpanExporter): void {
  settings.exporters = [...settings.exporters, exporter];
}

export async function flushTracer(): Promise<void> {
  await Promise.all(
    settings.exporters.map((e) => e.flush?.() ?? Promise.resolve()),
  );
}

/** The ambient context, or undefined outside any span. */
export function currentContext(): TraceContext | undefined {
  return storage.getStore();
}

/**
 * The current trace id, for log correlation. Returns undefined rather than
 * inventing one, so a log line outside a trace is honestly untraced instead of
 * carrying an id that leads nowhere.
 */
export function currentTraceId(): string | undefined {
  return storage.getStore()?.traceId;
}

export class Span {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId: string | null;
  readonly startedAt: number;

  private status: SpanStatus = "unset";
  private error: SpanRecord["error"];
  private readonly attributes: SpanAttributes;
  private readonly events: SpanRecord["events"] = [];
  private ended = false;

  constructor(
    readonly name: string,
    readonly kind: SpanRecord["kind"],
    context: TraceContext,
    parentSpanId: string | null,
    attributes: SpanAttributes,
  ) {
    this.traceId = context.traceId;
    this.spanId = context.spanId;
    this.parentSpanId = parentSpanId;
    this.startedAt = settings.clock.now();
    this.attributes = redactAttributes(attributes, settings.redact);
  }

  setAttributes(attributes: SpanAttributes): this {
    Object.assign(
      this.attributes,
      redactAttributes(attributes, settings.redact),
    );
    return this;
  }

  addEvent(name: string, attributes: SpanAttributes = {}): this {
    this.events.push({
      at: settings.clock.now(),
      name,
      attributes: redactAttributes(attributes, settings.redact),
    });
    return this;
  }

  recordError(error: unknown): this {
    this.status = "error";
    const asError = error instanceof Error ? error : new Error(String(error));
    this.error = {
      name: asError.name,
      message: asError.message,
      code:
        typeof (asError as unknown as { code?: unknown }).code === "string"
          ? (asError as unknown as { code: string }).code
          : undefined,
    };
    return this;
  }

  /**
   * Idempotent. A span that is ended twice (a `finally` plus an explicit call in
   * a happy path) exports once — double-counted durations are worse than a
   * missing span because they look plausible.
   */
  end(): SpanRecord | null {
    if (this.ended) return null;
    this.ended = true;

    const endedAt = settings.clock.now();
    const record: SpanRecord = {
      traceId: this.traceId,
      spanId: this.spanId,
      parentSpanId: this.parentSpanId,
      name: this.name,
      kind: this.kind,
      startedAt: this.startedAt,
      endedAt,
      durationMs: endedAt - this.startedAt,
      status: this.status === "unset" ? "ok" : this.status,
      attributes: this.attributes,
      events: this.events,
    };
    if (this.error) record.error = this.error;

    for (const exporter of settings.exporters) {
      // An exporter must never be able to fail the work it is observing.
      try {
        exporter.export(record);
      } catch {
        /* ignored on purpose */
      }
    }
    return record;
  }
}

function childContext(options: SpanOptions): {
  context: TraceContext;
  parentSpanId: string | null;
} {
  const parent = options.parent ?? storage.getStore();
  const spanId = settings.ids.spanId();
  if (!parent) {
    return {
      context: { traceId: settings.ids.traceId(), spanId },
      parentSpanId: null,
    };
  }
  return {
    context: { ...parent, spanId },
    parentSpanId: parent.spanId,
  };
}

/**
 * Runs `fn` inside a new span, propagating context to everything it awaits.
 *
 * Errors are recorded and rethrown, never swallowed — observability that eats
 * exceptions turns a crash into a mystery.
 */
export async function withSpan<T>(
  name: string,
  options: SpanOptions,
  fn: (span: Span) => Promise<T> | T,
): Promise<T> {
  const { context, parentSpanId } = childContext(options);
  const span = new Span(
    name,
    options.kind ?? "internal",
    context,
    parentSpanId,
    options.attributes ?? {},
  );

  return storage.run(context, async () => {
    try {
      return await fn(span);
    } catch (error) {
      span.recordError(error);
      throw error;
    } finally {
      span.end();
    }
  });
}

/**
 * Starts a root span for a unit of work that owns its own trace — an inbound
 * message, a queue job. Any ambient context is ignored on purpose: a queue job
 * is a new trace even when it was enqueued inside another one.
 */
export async function withTrace<T>(
  name: string,
  seed: { userId?: string; mode?: string; jobId?: string; traceId?: string },
  options: SpanOptions,
  fn: (span: Span) => Promise<T> | T,
): Promise<T> {
  const context: TraceContext = {
    traceId: seed.traceId ?? settings.ids.traceId(),
    spanId: settings.ids.spanId(),
    userId: seed.userId,
    mode: seed.mode,
    jobId: seed.jobId,
  };
  const span = new Span(
    name,
    options.kind ?? "internal",
    context,
    null,
    options.attributes ?? {},
  );

  return storage.run(context, async () => {
    try {
      return await fn(span);
    } catch (error) {
      span.recordError(error);
      throw error;
    } finally {
      span.end();
    }
  });
}
