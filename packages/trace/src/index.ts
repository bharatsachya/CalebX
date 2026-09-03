export {
  Span,
  addExporter,
  configureTracer,
  currentContext,
  currentTraceId,
  flushTracer,
  resetTracer,
  withSpan,
  withTrace,
} from "./tracer.ts";

export {
  JsonlFileExporter,
  MemoryExporter,
  MultiExporter,
  StdoutExporter,
} from "./exporters.ts";

export {
  buildTraceTree,
  renderTraceTree,
  summarizeByName,
  type TraceNode,
} from "./tree.ts";

export {
  fingerprint,
  isSensitiveKey,
  maskUserId,
  redactAttributes,
} from "./redact.ts";

export { newSpanId, newTraceId, sequentialIds } from "./ids.ts";

export { initTracing, traceFilePath } from "./setup.ts";

export type {
  AttributeValue,
  SpanAttributes,
  SpanEvent,
  SpanExporter,
  SpanKind,
  SpanOptions,
  SpanRecord,
  SpanStatus,
  TraceContext,
  TracerClock,
  TracerIdSource,
} from "./types.ts";
