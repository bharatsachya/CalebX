import { dataPath, env } from "@calebx/config";
import { addExporter, configureTracer } from "./tracer.ts";
import { JsonlFileExporter, StdoutExporter } from "./exporters.ts";

const e = env("trace");

/** Where a process writes its spans. One file per process role, appended. */
export function traceFilePath(role: string): string {
  return dataPath("traces", `${role}.jsonl`);
}

/**
 * Wires exporters from the environment. Entry points call this once at boot;
 * libraries never do — a library that configures global tracing steals the
 * decision from whoever embedded it.
 *
 * `TRACE=off` disables entirely. `TRACE_STDOUT=true` adds JSON lines to stdout
 * for `bun run … | jq`. `TRACE_REDACT=off` turns off attribute redaction, which
 * is for local debugging and nowhere else (see assumptions.md A7).
 */
export function initTracing(role: string): void {
  if (e.optional("TRACE", "on").toLowerCase() === "off") {
    configureTracer({ exporters: [] });
    return;
  }

  configureTracer({
    redact: e.optional("TRACE_REDACT", "on").toLowerCase() !== "off",
  });
  addExporter(new JsonlFileExporter(traceFilePath(role)));
  if (e.boolean("TRACE_STDOUT", false)) addExporter(new StdoutExporter());
}
