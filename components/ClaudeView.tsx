"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import type { ClaudeProject, DashboardData, RepoCard, ThreadState, TokenRow } from "@/lib/types";

const ProjectGraph = dynamic(() => import("./ProjectGraph").then((m) => m.ProjectGraph), {
  ssr: false,
  loading: () => <div className="graph" />,
});

type Fmt = (iso: string, opts: Intl.DateTimeFormatOptions) => string;

const STATE: Record<ThreadState, { label: string; color: string }> = {
  running: { label: "RUNNING", color: "var(--blue)" },
  needs_you: { label: "NEEDS YOU", color: "var(--amber)" },
  done: { label: "DONE", color: "var(--teal)" },
  failed: { label: "FAILED", color: "var(--amber)" },
  idle: { label: "IDLE", color: "var(--muted)" },
};
const MODEL_COLORS = ["var(--blue)", "var(--teal)", "var(--amber)", "var(--silver)", "var(--blue-soft)", "var(--slate)"];

export const tokens = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));
const usd = (n: number) => (n >= 100 ? `$${Math.round(n)}` : `$${n.toFixed(2)}`);
const total = (r: TokenRow) => r.input + r.output + r.cacheRead + r.cacheWrite;

/** "claude-opus-4-5-20251101" → "Opus 4.5". */
export function modelLabel(id: string) {
  const m = id.replace(/^claude-/, "").replace(/-\d{8}$/, "").replace(/\[.*\]$/, "");
  const parts = m.split("-");
  const name = parts[0] ?? m;
  const ver = parts.slice(1).join(".");
  return `${name.charAt(0).toUpperCase()}${name.slice(1)}${ver ? " " + ver : ""}`;
}

export function ClaudeView({ data, fmt, now }: { data: DashboardData; fmt: Fmt; now: Date | null }) {
  const c = data.claude;
  const t = c.tokens;
  const projects = c.projects ?? [];
  const repos = c.repos ?? [];
  const [selected, setSelected] = useState<string | null>(null);
  const project = projects.find((p) => p.id === selected) ?? projects[0] ?? null;
  const running = c.threads.filter((x) => x.state === "running").length;
  const since = t?.since ? fmt(t.since, { month: "short", day: "numeric", year: "numeric" }) : null;

  return (
    <>
      <div className="view-head">
        <div>
          <h1>Claude</h1>
          <p className="row-meta" style={{ marginTop: 6 }}>
            EVERY PROJECT, FLOW CHART, TOKEN AND THREAD{since ? ` · SINCE ${since.toUpperCase()}` : ""}
          </p>
        </div>
        <div className="stats">
          <Stat label="TOKENS" value={t ? tokens(total(t.total)) : "—"} />
          <Stat label="API VALUE" value={t ? usd(t.total.cost) : "—"} hint="AT LIST PRICES" />
          <Stat label="SESSIONS" value={t ? String(t.total.sessions ?? c.threads.length) : String(c.threads.length)} />
          <Stat label="RUNNING" value={String(running)} color={running ? "var(--blue)" : undefined} />
          <Stat label="PROJECTS" value={String(projects.length)} />
          <Stat label="REPOS" value={String(repos.length)} />
        </div>
      </div>

      <div className="grid">
        <LimitsPanel data={data} fmt={fmt} now={now} />
        <ModelsPanel data={data} fmt={fmt} />
        <DailyPanel data={data} fmt={fmt} />
      </div>

      <section className="panel" aria-labelledby="projects-title">
        <div className="panel-head">
          <h2 id="projects-title">PROJECTS · FLOW CHARTS</h2>
          <span className="aside">DRAG NODES · CLICK TO OPEN · MERGED AND COMMITTED WORK IS TEAL</span>
        </div>
        {projects.length === 0 ? (
          <p className="empty">
            No projects yet. The collector on your Mac sends every repo Claude has worked in; GitHub repos appear once GITHUB_USERS is set.
          </p>
        ) : (
          <div className="projects">
            <div className="project-list">
              {projects.map((p) => (
                <button key={p.id} className="project-card" aria-pressed={project?.id === p.id} onClick={() => setSelected(p.id)}>
                  <span className="thread-top">
                    <strong>{p.name}</strong>
                    {p.pinned && <span className="mono" style={{ fontSize: 10, color: "var(--amber)" }}>PINNED</span>}
                  </span>
                  <span className="row-meta">
                    {[
                      p.repo ?? (p.path ? "LOCAL" : null),
                      p.stats.commits != null ? `${p.stats.commits} COMMITS` : null,
                      p.stats.mergedPRs != null ? `${p.stats.mergedPRs} MERGED` : null,
                      p.stats.sessions ? `${p.stats.sessions} SESSIONS` : null,
                      p.stats.tokens ? `${tokens(p.stats.tokens)} TOKENS` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")
                      .toUpperCase()}
                  </span>
                  {p.updatedAt && <span className="row-meta">UPDATED {fmt(p.updatedAt, { month: "short", day: "numeric" }).toUpperCase()}</span>}
                </button>
              ))}
            </div>
            {project && <ProjectDetail project={project} data={data} fmt={fmt} />}
          </div>
        )}
      </section>

      <ThreadsPanel data={data} fmt={fmt} />

      <section className="panel" aria-labelledby="repos-title">
        <div className="panel-head">
          <h2 id="repos-title">SHOWCASE · GITHUB</h2>
          <span className="aside">{repos.length} REPOSITOR{repos.length === 1 ? "Y" : "IES"}</span>
        </div>
        {repos.length === 0 ? (
          <p className="empty">No repositories yet. Set GITHUB_USERS (and GITHUB_TOKEN for private repos) on the deployment.</p>
        ) : (
          <div className="repos">
            {repos.map((r) => (
              <RepoTile key={r.fullName} r={r} fmt={fmt} />
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function Stat({ label, value, hint, color }: { label: string; value: string; hint?: string; color?: string }) {
  return (
    <div className="stat">
      <strong style={color ? { color } : undefined}>{value}</strong>
      <span>{label}</span>
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

function LimitsPanel({ data, fmt, now }: { data: DashboardData; fmt: Fmt; now: Date | null }) {
  const u = data.claude.usage;
  const limits =
    u.limits && u.limits.length
      ? u.limits
      : [...(u.session ? [{ label: "5-hour session", ...u.session }] : []), ...(u.weekly ? [{ label: "Weekly limit", ...u.weekly }] : [])];
  const history = (u.history ?? []).filter((h) => h.weekly != null);
  const resets = (iso?: string) => {
    if (!iso) return "";
    const mins = now ? Math.round((new Date(iso).getTime() - now.getTime()) / 60_000) : 0;
    if (mins > 0 && mins < 24 * 60) return ` · RESETS ${Math.floor(mins / 60)}H ${mins % 60}M`;
    return ` · RESETS ${fmt(iso, { weekday: "short" }).toUpperCase()}`;
  };
  return (
    <section className="panel" aria-labelledby="limits-title">
      <div className="panel-head">
        <h2 id="limits-title">PLAN LIMITS · {u.plan.toUpperCase()}</h2>
        <span className="aside">{u.readAt ? `READ ${fmt(u.readAt, { weekday: "short", hour: "numeric", minute: "2-digit" }).toUpperCase()}` : "FROM CLAUDE.AI"}</span>
      </div>
      <div className="panel-body">
        {limits.length === 0 && <p className="empty" style={{ padding: 0 }}>Not read yet. The Docket sync reads your claude.ai usage page three times a day.</p>}
        {limits.map((l) => (
          <div key={l.label} className="limit">
            <div className="limit-head">
              <span>{l.label.toUpperCase()}</span>
              <span>
                {l.pct}%{l.resetsAt ? resets(l.resetsAt) : l.resets ? ` · RESETS ${l.resets.toUpperCase()}` : ""}
              </span>
            </div>
            <div className="meter">
              <span style={{ width: `${Math.min(l.pct, 100)}%`, background: l.pct > 85 ? "var(--amber)" : /session/i.test(l.label) ? "var(--blue)" : "var(--silver)" }} />
            </div>
          </div>
        ))}
        {history.length > 1 && (
          <div className="limit">
            <span className="row-meta">WEEKLY LIMIT USED · LAST {history.length} READINGS</span>
            <div className="bars" role="img" aria-label={`Weekly limit used over time, latest ${history.at(-1)!.weekly}%`}>
              {history.map((h) => (
                <div key={h.at} title={`${fmt(h.at, { weekday: "short", hour: "numeric" })}: ${h.weekly}%`} style={{ height: `${h.weekly}%` }} />
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function ModelsPanel({ data, fmt }: { data: DashboardData; fmt: Fmt }) {
  const t = data.claude.tokens;
  const rows = t?.byModel ?? [];
  const max = Math.max(1, ...rows.map(total));
  const sum = rows.reduce((a, r) => a + total(r), 0);
  return (
    <section className="panel" aria-labelledby="models-title">
      <div className="panel-head">
        <h2 id="models-title">TOKENS · BY MODEL</h2>
        <span className="aside">{t ? `CLAUDE CODE · ${fmt(t.collectedAt, { weekday: "short", hour: "numeric", minute: "2-digit" }).toUpperCase()}` : "CLAUDE CODE"}</span>
      </div>
      <div className="panel-body">
        {rows.length === 0 && <p className="empty" style={{ padding: 0 }}>No token data yet. Install the collector on your Mac (README → Claude) and it reports every 10 minutes.</p>}
        {rows.map((r, i) => (
          <div key={r.model} className="limit">
            <div className="limit-head">
              <span style={{ color: "var(--text)" }}>
                <i className="swatch" style={{ background: MODEL_COLORS[i % MODEL_COLORS.length] }} />
                {modelLabel(r.model).toUpperCase()}
              </span>
              <span>
                {tokens(total(r))} · {usd(r.cost)}
              </span>
            </div>
            <div className="meter">
              <span style={{ width: `${(total(r) / max) * 100}%`, background: MODEL_COLORS[i % MODEL_COLORS.length] }} />
            </div>
            <span className="row-meta">
              {Math.round((total(r) / Math.max(1, sum)) * 100)}% · IN {tokens(r.input)} · OUT {tokens(r.output)} · CACHE {tokens(r.cacheRead + r.cacheWrite)} · {r.messages} TURNS · {r.sessions ?? 0} SESSIONS
            </span>
          </div>
        ))}
        {t && t.byProject.length > 0 && (
          <div className="limit">
            <span className="row-meta">BY PROJECT</span>
            <div className="legend">
              {t.byProject.slice(0, 8).map((p) => (
                <div key={p.project} className="legend-row">
                  <span>{p.project}</span>
                  <span className="mono">
                    {tokens(total(p))} · {usd(p.cost)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function DailyPanel({ data, fmt }: { data: DashboardData; fmt: Fmt }) {
  const t = data.claude.tokens;
  const days = (t?.daily ?? []).slice(-30);
  const max = Math.max(1, ...days.map((d) => d.input + d.output));
  const week = days.slice(-7);
  const weekTokens = week.reduce((a, d) => a + d.input + d.output, 0);
  const weekCost = week.reduce((a, d) => a + d.cost, 0);
  return (
    <section className="panel" aria-labelledby="daily-title">
      <div className="panel-head">
        <h2 id="daily-title">TOKENS · BY DAY</h2>
        <span className="aside">LAST {days.length || 30} DAYS</span>
      </div>
      <div className="panel-body">
        {days.length === 0 ? (
          <p className="empty" style={{ padding: 0 }}>Daily usage shows up with the first collector run.</p>
        ) : (
          <>
            <div className="limit-head">
              <span>LAST 7 DAYS</span>
              <span>
                {tokens(weekTokens)} · {usd(weekCost)}
              </span>
            </div>
            <div className="bars tall" role="img" aria-label={`Tokens per day, most recent ${tokens(days.at(-1)!.input + days.at(-1)!.output)}`}>
              {days.map((d) => (
                <div key={d.date} title={`${fmt(d.date + "T12:00:00", { weekday: "short", month: "short", day: "numeric" })}: ${tokens(d.input + d.output)} · ${usd(d.cost)} · ${d.messages} turns`} style={{ height: `${((d.input + d.output) / max) * 100}%` }} />
              ))}
            </div>
            <div className="limit-head">
              <span>{fmt(days[0].date + "T12:00:00", { month: "short", day: "numeric" }).toUpperCase()}</span>
              <span>{fmt(days.at(-1)!.date + "T12:00:00", { month: "short", day: "numeric" }).toUpperCase()}</span>
            </div>
            {t && (
              <span className="row-meta">
                ALL TIME · IN {tokens(t.total.input)} · OUT {tokens(t.total.output)} · CACHE READ {tokens(t.total.cacheRead)} · CACHE WRITE {tokens(t.total.cacheWrite)} · {t.total.messages} TURNS
              </span>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function ProjectDetail({ project: p, data, fmt }: { project: ClaudeProject; data: DashboardData; fmt: Fmt }) {
  const threads = data.claude.threads.filter((t) => t.project.toLowerCase() === p.name.toLowerCase());
  const counts = useMemo(() => {
    const n: Record<string, number> = {};
    for (const node of p.graph.nodes) n[node.kind] = (n[node.kind] ?? 0) + 1;
    return n;
  }, [p.graph.nodes]);
  const [tall, setTall] = useState(false);
  useEffect(() => setTall(false), [p.id]);
  return (
    <div className="project-detail">
      <div className="project-meta">
        <div>
          <strong style={{ fontSize: 18 }}>{p.name}</strong>
          {p.description && <div style={{ color: "var(--text-2)", marginTop: 2 }}>{p.description}</div>}
          <div className="row-meta" style={{ marginTop: 6 }}>
            {[
              p.repo,
              p.path?.replace(/^\/Users\/[^/]+/, "~"),
              p.branch ? `ON ${p.branch}` : null,
              counts.branch ? `${counts.branch} BRANCHES` : null,
              counts.commit ? `${counts.commit} COMMITS SHOWN` : null,
              counts.pr ? `${counts.pr} PRS` : null,
              counts.session ? `${counts.session} SESSIONS` : null,
              p.stats.cost ? `${usd(p.stats.cost)} API VALUE` : null,
            ]
              .filter(Boolean)
              .join(" · ")
              .toUpperCase()}
          </div>
        </div>
        <div className="hero-actions">
          {p.url && (
            <a className="btn" href={p.url} target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center" }}>
              OPEN REPO ↗
            </a>
          )}
          <button className="btn" onClick={() => setTall((v) => !v)}>
            {tall ? "SMALLER" : "BIGGER"}
          </button>
        </div>
      </div>
      <ProjectGraph graph={p.graph} height={tall ? 900 : 520} />
      {threads.length > 0 && (
        <div>
          <div className="row-meta" style={{ padding: "12px 18px 4px" }}>CLAUDE THREADS IN THIS PROJECT</div>
          {threads.slice(0, 8).map((t) => (
            <ThreadRow key={t.id} t={t} fmt={fmt} />
          ))}
        </div>
      )}
    </div>
  );
}

function ThreadRow({ t, fmt }: { t: DashboardData["claude"]["threads"][number]; fmt: Fmt }) {
  const s = STATE[t.state];
  const body = (
    <>
      <span className="thread-top">
        <strong>{t.title}</strong>
        <span className="mono" style={{ fontSize: 11, color: s.color }}>
          {s.label}
        </span>
      </span>
      <span className="row-meta">
        {[t.project, t.origin === "mac" ? "ON THE MAC" : "CLOUD", t.model ? modelLabel(t.model) : null, t.tokens ? `${tokens(t.tokens)} TOKENS` : null, t.step, t.updatedAt ? fmt(t.updatedAt, { month: "short", day: "numeric", hour: "numeric" }) : null]
          .filter(Boolean)
          .join(" · ")
          .toUpperCase()}
      </span>
    </>
  );
  return t.url ? (
    <a className="row thread" href={t.url} target="_blank" rel="noreferrer">
      {body}
    </a>
  ) : (
    <div className="row thread">{body}</div>
  );
}

function ThreadsPanel({ data, fmt }: { data: DashboardData; fmt: Fmt }) {
  const [filter, setFilter] = useState<"all" | ThreadState>("all");
  const all = data.claude.threads;
  const shown = all.filter((t) => filter === "all" || t.state === filter);
  return (
    <section className="panel" aria-labelledby="all-threads-title">
      <div className="panel-head">
        <h2 id="all-threads-title">THREADS · {all.length}</h2>
        <div className="seg" role="group" aria-label="Filter threads">
          {(["all", "running", "needs_you", "idle", "done"] as const).map((f) => (
            <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {f === "all" ? "ALL" : STATE[f].label}
            </button>
          ))}
        </div>
      </div>
      {shown.length === 0 && <p className="empty">Nothing here yet.</p>}
      {shown.slice(0, 60).map((t) => (
        <ThreadRow key={t.id} t={t} fmt={fmt} />
      ))}
    </section>
  );
}

function RepoTile({ r, fmt }: { r: RepoCard; fmt: Fmt }) {
  return (
    <a className="repo" href={r.url} target="_blank" rel="noreferrer">
      <span className="thread-top">
        <strong>{r.name}</strong>
        <span className="mono" style={{ fontSize: 10, color: r.private ? "var(--amber)" : "var(--muted)" }}>
          {r.private ? "PRIVATE" : "PUBLIC"}
        </span>
      </span>
      {r.description && <span style={{ color: "var(--text-2)", fontSize: 13 }}>{r.description}</span>}
      <span className="row-meta">
        {[r.language, r.stars ? `★ ${r.stars}` : null, `PUSHED ${fmt(r.pushedAt, { month: "short", day: "numeric" })}`].filter(Boolean).join(" · ").toUpperCase()}
      </span>
      {r.homepage && <span className="row-meta" style={{ color: "var(--blue-soft)" }}>{r.homepage.replace(/^https?:\/\//, "")}</span>}
    </a>
  );
}
