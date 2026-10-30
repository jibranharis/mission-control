import type { ClaudeSnapshot, ClaudeThread, GraphNode } from "@/lib/types";

/** What a pusher may send; anything left out is filled in here. */
export type ClaudePush = Partial<Omit<ClaudeSnapshot, "usage">> & {
  usage?: Partial<ClaudeSnapshot["usage"]>;
  threads?: ClaudeThread[];
};

/** Agent → projects → threads, for pushers that only send threads. */
export function graphFromThreads(threads: ClaudeThread[]): ClaudeSnapshot["graph"] {
  const nodes: GraphNode[] = [{ id: "agent", kind: "agent", label: "Claude" }];
  const edges: [string, string][] = [];
  const projects = new Map<string, string>();
  for (const t of threads) {
    const name = t.project || "Other";
    if (!projects.has(name)) {
      const id = `project:${projects.size}`;
      projects.set(name, id);
      nodes.push({ id, kind: "project", label: name });
      edges.push(["agent", id]);
    }
    nodes.push({ id: `thread:${t.id}`, kind: "thread", label: t.title, state: t.state, url: t.url });
    edges.push([projects.get(name)!, `thread:${t.id}`]);
  }
  return { nodes, edges };
}

/** Share of threads per project, the closest honest stand-in for usage by project. */
export function shareByProject(threads: ClaudeThread[]): { name: string; pct: number }[] {
  if (!threads.length) return [];
  const counts = new Map<string, number>();
  for (const t of threads) counts.set(t.project || "Other", (counts.get(t.project || "Other") ?? 0) + 1);
  return [...counts]
    .sort((a, b) => b[1] - a[1])
    .map(([name, n]) => ({ name, pct: Math.round((n / threads.length) * 100) }));
}

export function normalizeClaude(p: ClaudePush, history: NonNullable<ClaudeSnapshot["usage"]["history"]>): ClaudeSnapshot {
  const threads = Array.isArray(p.threads) ? p.threads : [];
  const u = p.usage ?? {};
  const limits = Array.isArray(u.limits) ? u.limits : [];
  const find = (re: RegExp) => limits.find((l) => re.test(l.label));
  const session = u.session ?? (find(/session/i) && { pct: find(/session/i)!.pct, resetsAt: find(/session/i)!.resetsAt });
  const weekly = u.weekly ?? (find(/week|all models/i) && { pct: find(/week|all models/i)!.pct, resetsAt: find(/week|all models/i)!.resetsAt });
  return {
    generatedAt: new Date().toISOString(),
    usage: {
      plan: u.plan ?? "Pro",
      session: session || undefined,
      weekly: weekly || undefined,
      limits,
      byProject: u.byProject?.length ? u.byProject : shareByProject(threads),
      daily: Array.isArray(u.daily) ? u.daily : [],
      estimated: u.estimated ?? false,
      history,
      readAt: u.readAt,
    },
    threads,
    graph: p.graph?.nodes?.length ? p.graph : graphFromThreads(threads),
    updates: Array.isArray(p.updates) ? p.updates : [],
  };
}
