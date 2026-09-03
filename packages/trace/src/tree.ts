import type { SpanRecord } from "./types.ts";

export interface TraceNode {
  span: SpanRecord;
  children: TraceNode[];
  /** Time inside this span not accounted for by its children. */
  selfMs: number;
}

/**
 * Rebuilds the span hierarchy from a flat list.
 *
 * Spans arrive in *completion* order, so a parent is exported after its
 * children and cannot be assumed present when a child is processed. Orphans —
 * a child whose parent id is not in the list, which happens whenever you read a
 * partial trace or a truncated file — are promoted to roots rather than dropped.
 * A partial trace is still useful; a silently empty one is not.
 */
export function buildTraceTree(spans: SpanRecord[]): TraceNode[] {
  const nodes = new Map<string, TraceNode>();
  for (const span of spans) {
    nodes.set(span.spanId, { span, children: [], selfMs: span.durationMs });
  }

  const roots: TraceNode[] = [];
  for (const node of nodes.values()) {
    const parentId = node.span.parentSpanId;
    const parent = parentId ? nodes.get(parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  const byStart = (a: TraceNode, b: TraceNode) =>
    a.span.startedAt - b.span.startedAt ||
    a.span.spanId.localeCompare(b.span.spanId);

  for (const node of nodes.values()) {
    node.children.sort(byStart);
    const childTime = node.children.reduce(
      (sum, c) => sum + c.span.durationMs,
      0,
    );
    node.selfMs = Math.max(0, node.span.durationMs - childTime);
  }
  roots.sort(byStart);
  return roots;
}

const KIND_MARK: Record<string, string> = {
  llm: "◆",
  tool: "▸",
  db: "▪",
  graph: "◈",
  embed: "◇",
  queue: "⇄",
  dispatch: "→",
  http: "↗",
  authz: "⊘",
  internal: "·",
};

function formatLine(node: TraceNode, prefix: string, isLast: boolean): string {
  const branch = prefix === "" ? "" : `${isLast ? "└─ " : "├─ "}`;
  const span = node.span;
  const mark = KIND_MARK[span.kind] ?? "·";
  const status = span.status === "error" ? " ✗" : "";
  const self = node.children.length > 0 ? ` (self ${node.selfMs}ms)` : "";
  const attrs = Object.entries(span.attributes)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(" ");
  const error = span.error
    ? `  ! ${span.error.name}: ${span.error.message}`
    : "";
  return `${prefix}${branch}${mark} ${span.name}  ${span.durationMs}ms${self}${status}${
    attrs ? `  [${attrs}]` : ""
  }${error}`;
}

/**
 * Renders a trace as an indented tree with durations. This is the whole point of
 * the package for a human: one glance tells you the order of operations and
 * which step ate the wall clock.
 */
export function renderTraceTree(spans: SpanRecord[]): string {
  const roots = buildTraceTree(spans);
  const lines: string[] = [];

  const walk = (node: TraceNode, prefix: string, isLast: boolean): void => {
    lines.push(formatLine(node, prefix, isLast));
    const childPrefix =
      prefix === "" ? "   " : `${prefix}${isLast ? "   " : "│  "}`;
    node.children.forEach((child, index) =>
      walk(child, childPrefix, index === node.children.length - 1),
    );
  };

  roots.forEach((root, index) => walk(root, "", index === roots.length - 1));
  return lines.join("\n");
}

/** Aggregate view: total time per span name, slowest first. */
export function summarizeByName(spans: SpanRecord[]): {
  name: string;
  count: number;
  totalMs: number;
  maxMs: number;
  errors: number;
}[] {
  const acc = new Map<
    string,
    {
      name: string;
      count: number;
      totalMs: number;
      maxMs: number;
      errors: number;
    }
  >();
  for (const span of spans) {
    const row = acc.get(span.name) ?? {
      name: span.name,
      count: 0,
      totalMs: 0,
      maxMs: 0,
      errors: 0,
    };
    row.count += 1;
    row.totalMs += span.durationMs;
    row.maxMs = Math.max(row.maxMs, span.durationMs);
    if (span.status === "error") row.errors += 1;
    acc.set(span.name, row);
  }
  return [...acc.values()].sort((a, b) => b.totalMs - a.totalMs);
}
