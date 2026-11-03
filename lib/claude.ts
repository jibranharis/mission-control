import { PINNED_PROJECTS } from "@/lib/config";
import { TIMEZONE } from "@/lib/time";
import type { ClaudeProject, ClaudeSnapshot, ClaudeThread, GraphNode, RepoCard, TokenUsage } from "@/lib/types";

/** What a pusher may send; anything left out keeps what the last push set. */
export type ClaudePush = Partial<Omit<ClaudeSnapshot, "usage">> & {
  usage?: Partial<ClaudeSnapshot["usage"]>;
  threads?: ClaudeThread[];
  /** Which pusher this is; its threads replace only the threads it pushed before. */
  origin?: "cloud" | "mac";
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TITLE_MAX = 72;

/**
 * Session titles come from the first prompt, which can be a bare session id or
 * just attached files (@"/Users/.../uploads/..."). Those get a readable title.
 */
export function cleanTitle(title: string | undefined, at?: string): string {
  let t = (title ?? "")
    .replace(/@"[^"]*"?/g, " ")
    .replace(/@\/\S+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t || UUID.test(t) || /^(session|cse|cmsg)_[A-Za-z0-9]+$/.test(t) || !/[A-Za-z]{2}/.test(t)) {
    const files = /@["/]/.test(title ?? "");
    const day = at ? new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: TIMEZONE }) : null;
    return `${files ? "Files shared" : "Session"}${day ? ` · ${day}` : ""}`;
  }
  if (t.length > TITLE_MAX) t = `${t.slice(0, TITLE_MAX).replace(/\s+\S*$/, "")}…`;
  return t;
}

const RUNNING_FOR = 10 * 60_000;

/** A thread's state can go stale between pushes: nothing runs for more than a few minutes unobserved. */
function settle(t: ClaudeThread): ClaudeThread {
  if (t.state !== "running" || !t.updatedAt) return t;
  return Date.now() - new Date(t.updatedAt).getTime() > RUNNING_FOR ? { ...t, state: "idle" } : t;
}

/** Threads from the push replace the ones its origin pushed last time; the other origin's stay. */
function mergeThreads(push: ClaudePush, prev: ClaudeThread[]): ClaudeThread[] {
  if (!Array.isArray(push.threads)) return prev.map(settle);
  const origin = push.origin ?? "cloud";
  const incoming = push.threads.map((t) => ({ ...t, title: cleanTitle(t.title, t.updatedAt), origin: t.origin ?? origin }));
  const ids = new Set(incoming.map((t) => t.id));
  const kept = prev.filter((t) => (t.origin ?? "cloud") !== origin && !ids.has(t.id));
  return [...incoming, ...kept]
    .map(settle)
    .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
}

/** Projects from the push replace the ones with the same id; pinned ones first, then most recent. */
export function mergeProjects(incoming: ClaudeProject[] | undefined, prev: ClaudeProject[]): ClaudeProject[] {
  const byId = new Map(prev.map((p) => [p.id, p]));
  for (const p of incoming ?? []) {
    const sessions = p.usage?.sessions.map((s) => ({ ...s, title: cleanTitle(s.title, s.updatedAt) }));
    const nodes = p.graph?.nodes?.map((n) => (n.kind === "session" ? { ...n, label: cleanTitle(n.label) } : n));
    byId.set(p.id, { ...p, ...(p.usage && sessions ? { usage: { ...p.usage, sessions } } : {}), ...(nodes ? { graph: { ...p.graph, nodes } } : {}) });
  }
  return [...byId.values()].sort(
    (a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""),
  );
}

export function normalizeClaude(
  p: ClaudePush,
  history: NonNullable<ClaudeSnapshot["usage"]["history"]>,
  prev: ClaudeSnapshot | null,
): ClaudeSnapshot {
  const threads = mergeThreads(p, prev?.threads ?? []);
  const u = p.usage ?? prev?.usage ?? {};
  const limits = Array.isArray(u.limits) ? u.limits : [];
  const find = (re: RegExp) => limits.find((l) => re.test(l.label));
  const session = u.session ?? (find(/session/i) && { pct: find(/session/i)!.pct, resetsAt: find(/session/i)!.resetsAt });
  const weekly = u.weekly ?? (find(/week|all models/i) && { pct: find(/week|all models/i)!.pct, resetsAt: find(/week|all models/i)!.resetsAt });
  const tokens: TokenUsage | undefined = p.tokens ?? prev?.tokens;
  const projects = mergeProjects(p.projects, prev?.projects ?? []);
  const repos: RepoCard[] | undefined = p.repos ?? prev?.repos;
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
    updates: Array.isArray(p.updates) ? p.updates : prev?.updates ?? [],
    tokens,
    projects,
    repos,
  };
}

/**
 * Pinned projects (Solo Kitchen) always show, first and under their own name,
 * even before anything has reported them.
 */
export function withPinned(projects: ClaudeProject[], pinned = PINNED_PROJECTS): ClaudeProject[] {
  const out = projects.map((p) => {
    const pin = pinned.find((x) => x.repo.toLowerCase() === (p.repo ?? p.id).toLowerCase() || x.name.toLowerCase() === p.name.toLowerCase());
    return pin ? { ...p, name: pin.name, pinned: true } : p;
  });
  for (const pin of pinned) {
    if (out.some((p) => p.pinned && p.name === pin.name)) continue;
    out.push({
      id: pin.repo.toLowerCase(),
      name: pin.name,
      repo: pin.repo,
      url: `https://github.com/${pin.repo}`,
      pinned: true,
      placeholder: true,
      stats: {},
      graph: { nodes: [{ id: pin.repo.toLowerCase(), kind: "project", label: pin.name, url: `https://github.com/${pin.repo}` }], edges: [] },
    });
  }
  return out.sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
}
