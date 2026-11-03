import { TIMEZONE } from "@/lib/time";
import type { ClaudeProject, ClaudeThread, GraphNode } from "@/lib/types";

/** How many open threads a project shows before the rest fold into "+N more". */
export const OPEN_SHOWN = 5;
/** How many repos without Claude sessions the "Other repos" column lists. */
const OTHER_SHOWN = 6;

export interface OverviewColumn {
  project: GraphNode;
  children: GraphNode[];
}

/** The overview map: Claude on top, one column per project, its threads stacked below. */
export interface Overview {
  agent: GraphNode;
  columns: OverviewColumn[];
}

const norm = (s: string) => s.trim().toLowerCase();

/** Which project a thread belongs to: the repo it ran in first, then the project's name. */
export function projectOf(t: ClaudeThread, projects: ClaudeProject[]): ClaudeProject | undefined {
  if (t.cwd) {
    const hit = projects
      .filter((p) => p.path && (t.cwd === p.path || t.cwd!.startsWith(p.path.replace(/\/$/, "") + "/")))
      .sort((a, b) => b.path!.length - a.path!.length)[0];
    if (hit) return hit;
  }
  const name = norm(t.project || "");
  if (!name) return undefined;
  return projects.find((p) => norm(p.name) === name || (p.path && norm(p.path.split("/").pop() ?? "") === name));
}

/** The threads that ran in one project, newest first. */
export function threadsForProject(p: ClaudeProject, projects: ClaudeProject[], threads: ClaudeThread[]): ClaudeThread[] {
  return threads.filter((t) => projectOf(t, projects)?.id === p.id);
}

const day = (iso?: string) =>
  iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: TIMEZONE }).toUpperCase() : "";

const RANK: Record<string, number> = { needs_you: 0, running: 1, failed: 2, idle: 3, done: 4 };
const byUrgency = (a: ClaudeThread, b: ClaudeThread) =>
  (RANK[a.state] ?? 5) - (RANK[b.state] ?? 5) || (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "");

function threadNode(t: ClaudeThread): GraphNode {
  const where = t.origin === "cloud" ? "CLOUD" : t.app === "desktop" ? "DESKTOP" : t.app === "vscode" ? "VS CODE" : "MAC";
  return {
    id: `thread:${t.id}`,
    kind: "thread",
    label: t.title,
    state: t.state,
    url: t.url,
    meta: [t.state === "needs_you" ? "NEEDS YOU" : t.state === "running" ? "RUNNING" : null, where, day(t.updatedAt)].filter(Boolean).join(" · "),
  };
}

/**
 * Every project with its threads. Open threads show first (up to OPEN_SHOWN, unless expanded),
 * finished ones fold into one "N finished" node so a busy project stays a short column.
 * Repos nobody has run Claude in share one "Other repos" column.
 */
export function overview(projects: ClaudeProject[], threads: ClaudeThread[], expanded: ReadonlySet<string> = new Set()): Overview {
  const groups = new Map<string, { project?: ClaudeProject; name: string; threads: ClaudeThread[] }>();
  for (const p of projects) groups.set(p.id, { project: p, name: p.name, threads: [] });
  for (const t of threads) {
    const p = projectOf(t, projects);
    const key = p ? p.id : `name:${norm(t.project || "Other")}`;
    if (!groups.has(key)) groups.set(key, { name: t.project || "Other", threads: [] });
    groups.get(key)!.threads.push(t);
  }

  const active = [...groups.entries()].filter(([, g]) => g.threads.length || g.project?.stats.sessions);
  const quiet = [...groups.entries()].filter(([, g]) => !g.threads.length && !g.project?.stats.sessions);
  const last = (g: { project?: ClaudeProject; threads: ClaudeThread[] }) =>
    [g.project?.updatedAt ?? "", ...g.threads.map((t) => t.updatedAt ?? "")].sort().at(-1) ?? "";
  active.sort(
    ([, a], [, b]) =>
      Number(Boolean(b.project?.pinned)) - Number(Boolean(a.project?.pinned)) ||
      Number(b.threads.some((t) => t.state !== "done")) - Number(a.threads.some((t) => t.state !== "done")) ||
      last(b).localeCompare(last(a)),
  );

  const columns: OverviewColumn[] = active.map(([key, g]) => {
    const pid = `project:${key}`;
    const sorted = [...g.threads].sort(byUrgency);
    const open = sorted.filter((t) => t.state !== "done");
    const done = sorted.filter((t) => t.state === "done");
    const all = expanded.has(pid);
    const children: GraphNode[] = (all ? open : open.slice(0, OPEN_SHOWN)).map(threadNode);
    if (!all && open.length > OPEN_SHOWN)
      children.push({ id: `${pid}:more`, kind: "subagent", label: `+${open.length - OPEN_SHOWN} more open`, meta: "CLICK TO SHOW" });
    if (done.length) {
      if (all) children.push(...done.map(threadNode));
      else children.push({ id: `${pid}:done`, kind: "subagent", label: `${done.length} finished`, state: "done", meta: `LAST ${day(done[0].updatedAt)} · CLICK TO SHOW` });
    }
    if (all && (open.length > OPEN_SHOWN || done.length))
      children.push({ id: `${pid}:less`, kind: "subagent", label: "Show less", meta: "CLICK TO FOLD" });
    const sessions = g.project?.stats.sessions ?? g.threads.length;
    return {
      project: {
        id: pid,
        kind: "project",
        label: g.name,
        url: g.project?.url,
        meta: [open.length ? `${open.length} OPEN` : null, `${sessions} SESSION${sessions === 1 ? "" : "S"}`, last(g) ? day(last(g)) : null]
          .filter(Boolean)
          .join(" · "),
      },
      children,
    };
  });

  if (quiet.length) {
    const pid = "project:other-repos";
    const all = expanded.has(pid);
    const repos = quiet.map(([key, g]) => ({
      id: `repo:${key}`,
      kind: "branch" as const,
      label: g.name,
      url: g.project?.url,
      meta: [g.project?.path ? "ON THE MAC" : g.project?.repo ? "GITHUB" : null, g.project?.updatedAt ? day(g.project.updatedAt) : null].filter(Boolean).join(" · "),
    }));
    const children: GraphNode[] = all ? repos : repos.slice(0, OTHER_SHOWN);
    if (!all && repos.length > OTHER_SHOWN) children.push({ id: `${pid}:more`, kind: "subagent", label: `+${repos.length - OTHER_SHOWN} more repos`, meta: "CLICK TO SHOW" });
    if (all && repos.length > OTHER_SHOWN) children.push({ id: `${pid}:less`, kind: "subagent", label: "Show less", meta: "CLICK TO FOLD" });
    columns.push({ project: { id: pid, kind: "project", label: "Other repos", meta: `${repos.length} WITHOUT CLAUDE SESSIONS` }, children });
  }

  const open = threads.filter((t) => t.state !== "done").length;
  return {
    agent: { id: "agent", kind: "agent", label: "Claude", meta: `${columns.length} PROJECT${columns.length === 1 ? "" : "S"} · ${open} OPEN` },
    columns,
  };
}
