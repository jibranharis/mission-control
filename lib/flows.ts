import type { Flow, FlowLink, FlowNode } from "@/components/FlowSankey";
import type { ClaudeProject, ThreadState, TokenRow, TokenUsage } from "@/lib/types";

/** What a flow's bands measure: tokens, or their API value in dollars (the closest thing to credits on a Pro plan). */
export type Measure = "tokens" | "cost";

export const MODEL_COLORS = ["var(--blue)", "var(--teal)", "var(--amber)", "var(--silver)", "var(--blue-soft)", "var(--slate)"];
const STATE_COLOR: Record<ThreadState, string> = {
  running: "var(--blue)",
  needs_you: "var(--amber)",
  done: "var(--teal)",
  failed: "var(--amber)",
  idle: "var(--dim)",
};

export const rowTokens = (r: TokenRow) => r.input + r.output + r.cacheRead + r.cacheWrite;
export const fmtTokens = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(Math.round(n)));
export const fmtUsd = (n: number) => (n >= 100 ? `$${Math.round(n)}` : n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(3)}`);
const fmtFor = (m: Measure) => (m === "cost" ? fmtUsd : fmtTokens);
const measure = (m: Measure, r: TokenRow) => (m === "cost" ? r.cost : rowTokens(r));
const pct = (v: number, of: number) => (of ? Math.round((v / of) * 100) : 0);

/** "claude-opus-4-5-20251101" → "Opus 4.5". */
export function modelLabel(id: string) {
  const m = id.replace(/^claude-/, "").replace(/-\d{8}$/, "").replace(/\[.*\]$/, "");
  const parts = m.split("-");
  const name = parts[0] ?? m;
  const ver = parts.slice(1).join(".");
  return `${name.charAt(0).toUpperCase()}${name.slice(1)}${ver ? " " + ver : ""}`;
}

/** One color per model, the same on every chart. */
export function modelColors(models: string[]): Record<string, string> {
  return Object.fromEntries(models.map((m, i) => [m, MODEL_COLORS[i % MODEL_COLORS.length]]));
}

const MAX_SESSIONS = 6;

/** Project → model → session, sized by tokens or API value. */
export function projectUsageFlow(p: ClaudeProject, m: Measure, colors: Record<string, string>): Flow | null {
  const u = p.usage;
  if (!u || !u.byModel.length) return null;
  const fmt = fmtFor(m);
  const total = measure(m, u.total);
  const nodes: FlowNode[] = [
    {
      id: "root",
      col: 0,
      label: p.name,
      kicker: "PROJECT · 100%",
      sub: `${u.total.sessions ?? u.sessions.length} sessions · ${u.total.messages} turns`,
      stats: [fmtTokens(rowTokens(u.total)), fmtUsd(u.total.cost)],
      color: "var(--silver)",
      url: p.url,
    },
  ];
  const links: FlowLink[] = [];
  for (const r of u.byModel) {
    const v = measure(m, r);
    if (v <= 0) continue;
    nodes.push({
      id: `model:${r.model}`,
      col: 1,
      label: modelLabel(r.model),
      kicker: `MODEL · ${pct(v, total)}%`,
      sub: `In ${fmtTokens(r.input)} · Out ${fmtTokens(r.output)} · Cache ${fmtTokens(r.cacheRead + r.cacheWrite)}`,
      stats: [fmtTokens(rowTokens(r)), fmtUsd(r.cost)],
      color: colors[r.model] ?? "var(--silver)",
    });
    links.push({ source: "root", target: `model:${r.model}`, value: v });
  }
  const val = (x: { tokens: number; cost: number }) => (m === "cost" ? x.cost : x.tokens);
  const sessions = [...u.sessions].sort((a, b) => val(b) - val(a));
  const shown = sessions.slice(0, MAX_SESSIONS);
  for (const s of shown) {
    const v = val(s);
    if (v <= 0) continue;
    nodes.push({
      id: `session:${s.id}`,
      col: 2,
      label: s.title,
      kicker: `SESSION · ${pct(v, total)}%`,
      stats: [fmtTokens(s.tokens), fmtUsd(s.cost), (s.state ?? "idle").replace("_", " ").toUpperCase()],
      color: STATE_COLOR[s.state ?? "idle"],
    });
    for (const [model, x] of Object.entries(s.byModel)) if (val(x) > 0) links.push({ source: `model:${model}`, target: `session:${s.id}`, value: val(x) });
  }
  // Everything else, so each model's bands add up to what it used.
  const rest = new Map<string, number>();
  for (const r of u.byModel) {
    const used = shown.reduce((a, s) => a + (s.byModel[r.model] ? val(s.byModel[r.model]) : 0), 0);
    const left = measure(m, r) - used;
    if (left > total * 0.002) rest.set(r.model, left);
  }
  if (rest.size) {
    const v = [...rest.values()].reduce((a, b) => a + b, 0);
    const n = Math.max(0, (u.total.sessions ?? sessions.length) - shown.length);
    nodes.push({
      id: "session:rest",
      col: 2,
      label: n ? `${n} more session${n === 1 ? "" : "s"}` : "Other turns",
      kicker: `OTHER · ${pct(v, total)}%`,
      stats: [fmt(v)],
      color: "var(--slate)",
    });
    for (const [model, left] of rest) links.push({ source: `model:${model}`, target: "session:rest", value: left });
  }
  return { nodes, links, columns: ["PROJECT", "MODEL", "SESSION"], format: fmt };
}

/** For a project with no Claude Code usage yet: its pull requests and commits, by outcome. */
export function projectWorkFlow(p: ClaudeProject): Flow | null {
  const prs = p.graph.nodes.filter((n) => n.kind === "pr");
  const commits = p.graph.nodes.filter((n) => n.kind === "commit");
  const sessions = p.graph.nodes.filter((n) => n.kind === "session");
  const total = prs.length + commits.length + sessions.length;
  if (!total) return null;
  const nodes: FlowNode[] = [
    { id: "root", col: 0, label: p.name, kicker: "PROJECT · 100%", sub: p.description ?? p.repo, stats: [`${total} ITEMS`], color: "var(--silver)", url: p.url },
  ];
  const links: FlowLink[] = [];
  const lane = (id: string, label: string, items: number, color: string, sub: string) => {
    if (!items) return;
    nodes.push({ id, col: 1, label, kicker: `${label.toUpperCase()} · ${pct(items, total)}%`, sub, stats: [String(items)], color });
    links.push({ source: "root", target: id, value: items });
  };
  lane("prs", "Pull requests", prs.length, "var(--blue)", "Opened on GitHub");
  lane("commits", "Commits", commits.length, "var(--teal)", "Latest on the default branch");
  lane("sessions", "Claude sessions", sessions.length, "var(--amber)", "On the Mac");
  const outcome = (id: string, label: string, items: number, color: string, from: string) => {
    if (!items) return;
    nodes.push({ id, col: 2, label, kicker: `${label.toUpperCase()} · ${pct(items, total)}%`, stats: [String(items)], color });
    links.push({ source: from, target: id, value: items });
  };
  outcome("merged", "Merged", prs.filter((n) => n.state === "done").length, "var(--teal)", "prs");
  outcome("open", "Open", prs.filter((n) => n.state === "needs_you" || n.state === "running").length, "var(--amber)", "prs");
  outcome("closed", "Closed", prs.filter((n) => n.state !== "done" && n.state !== "needs_you" && n.state !== "running").length, "var(--dim)", "prs");
  outcome("shipped", "Shipped", commits.length, "var(--teal)", "commits");
  outcome("s-done", "Finished", sessions.filter((n) => n.state === "done").length, "var(--teal)", "sessions");
  outcome("s-active", "Active", sessions.filter((n) => n.state !== "done").length, "var(--blue)", "sessions");
  return { nodes, links, columns: ["PROJECT", "WORK", "OUTCOME"], format: (v) => String(v) };
}

const MAX_PROJECTS = 7;

/** All of Claude Code → each project → each model. */
export function overallFlow(t: TokenUsage, projects: ClaudeProject[], m: Measure, colors: Record<string, string>): Flow | null {
  if (!t.byModel.length) return null;
  const fmt = fmtFor(m);
  const total = measure(m, t.total);
  const nodes: FlowNode[] = [
    {
      id: "root",
      col: 0,
      label: "All Claude Code",
      kicker: "EVERYTHING · 100%",
      sub: `${t.total.sessions ?? 0} sessions · ${t.total.messages} turns`,
      stats: [fmtTokens(rowTokens(t.total)), fmtUsd(t.total.cost)],
      color: "var(--silver)",
    },
  ];
  const links: FlowLink[] = [];
  const withUsage = projects.filter((p) => p.usage && measure(m, p.usage.total) > 0).sort((a, b) => measure(m, b.usage!.total) - measure(m, a.usage!.total));
  const shown = withUsage.slice(0, MAX_PROJECTS);
  const used = new Map<string, number>();
  for (const p of shown) {
    const v = measure(m, p.usage!.total);
    nodes.push({
      id: `p:${p.id}`,
      col: 1,
      label: p.name,
      kicker: `PROJECT · ${pct(v, total)}%`,
      sub: `${p.usage!.total.sessions ?? p.usage!.sessions.length} sessions`,
      stats: [fmtTokens(rowTokens(p.usage!.total)), fmtUsd(p.usage!.total.cost)],
      color: p.pinned ? "var(--amber)" : "var(--blue-soft)",
    });
    links.push({ source: "root", target: `p:${p.id}`, value: v });
    for (const r of p.usage!.byModel) {
      const mv = measure(m, r);
      if (mv <= 0) continue;
      links.push({ source: `p:${p.id}`, target: `model:${r.model}`, value: mv });
      used.set(r.model, (used.get(r.model) ?? 0) + mv);
    }
  }
  // Projects past the first few, and folders that aren't repos.
  const rest = new Map<string, number>();
  for (const r of t.byModel) {
    const left = measure(m, r) - (used.get(r.model) ?? 0);
    if (left > total * 0.002) rest.set(r.model, left);
  }
  if (rest.size) {
    const v = [...rest.values()].reduce((a, b) => a + b, 0);
    const n = withUsage.length - shown.length;
    nodes.push({ id: "p:rest", col: 1, label: n > 0 ? `${n} more projects` : "Other folders", kicker: `OTHER · ${pct(v, total)}%`, stats: [fmt(v)], color: "var(--slate)" });
    links.push({ source: "root", target: "p:rest", value: v });
    for (const [model, left] of rest) links.push({ source: "p:rest", target: `model:${model}`, value: left });
  }
  for (const r of t.byModel) {
    const v = measure(m, r);
    if (v <= 0) continue;
    nodes.push({
      id: `model:${r.model}`,
      col: 2,
      label: modelLabel(r.model),
      kicker: `MODEL · ${pct(v, total)}%`,
      sub: `${r.sessions ?? 0} sessions · ${r.messages} turns`,
      stats: [fmtTokens(rowTokens(r)), fmtUsd(r.cost)],
      color: colors[r.model] ?? "var(--silver)",
    });
  }
  return { nodes, links, columns: ["CLAUDE CODE", "PROJECT", "MODEL"], format: fmt };
}

/** Legend rows for a flow's middle column. */
export function legendFor(flow: Flow, col: number) {
  const inflow = new Map<string, number>();
  for (const l of flow.links) inflow.set(l.target, (inflow.get(l.target) ?? 0) + l.value);
  const rows = flow.nodes.filter((n) => n.col === col);
  const sum = rows.reduce((a, n) => a + (inflow.get(n.id) ?? 0), 0);
  return rows.map((n) => ({ label: n.label, color: n.color, value: flow.format(inflow.get(n.id) ?? 0), pct: pct(inflow.get(n.id) ?? 0, sum) }));
}
