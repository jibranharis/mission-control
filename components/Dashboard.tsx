"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { DashboardData, SourceStatus, TaskItem, ThreadState, UpdateItem } from "@/lib/types";
import { CoursesView, DeenView, ExamsStrip, NoDocket, NotesView, WeekView, WorkView } from "./DocketViews";
import { PRAYERS, PRAYER_ORDER, prayerTimes } from "@/lib/deen";
import { ClaudeView } from "./ClaudeView";

const ProjectGraph = dynamic(() => import("./ProjectGraph").then((m) => m.ProjectGraph), {
  ssr: false,
  loading: () => <div className="graph" />,
});

const REFRESH_MS = 3 * 60_000;

const TABS = [
  ["today", "TODAY"],
  ["claude", "CLAUDE"],
  ["courses", "COURSES"],
  ["week", "WEEK"],
  ["work", "WORK"],
  ["deen", "DEEN"],
  ["notes", "NOTES"],
] as const;
type Tab = (typeof TABS)[number][0];

const SOURCE_COLOR: Record<TaskItem["source"] | UpdateItem["source"], string> = {
  CANVAS: "var(--amber)",
  CAL: "var(--blue-soft)",
  TODO: "var(--silver)",
  CLAUDE: "var(--teal)",
  GMAIL: "var(--blue-soft)",
  GITHUB: "var(--silver)",
};

const STATE: Record<ThreadState, { label: string; color: string }> = {
  running: { label: "RUNNING", color: "var(--blue)" },
  needs_you: { label: "NEEDS YOU", color: "var(--amber)" },
  done: { label: "DONE", color: "var(--teal)" },
  failed: { label: "FAILED", color: "var(--amber)" },
  idle: { label: "IDLE", color: "var(--muted)" },
};

const EVENT_COLOR = { class: "var(--blue-soft)", gym: "var(--teal)", focus: "var(--silver)", other: "var(--amber)" };
const SPLIT_COLORS = ["var(--blue)", "var(--silver)", "var(--amber)", "var(--teal)", "var(--slate)"];

function useNow(intervalMs = 1000) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function Dashboard({ initial, owner, signOut }: { initial: DashboardData; owner: string; signOut: boolean }) {
  const [data, setData] = useState(initial);
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set());
  const now = useNow();
  const tz = data.timezone;
  const [tab, setTab] = useState<Tab>("today");

  useEffect(() => {
    const read = () => {
      const h = location.hash.slice(1);
      setTab(TABS.some(([id]) => id === h) ? (h as Tab) : "today");
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);
  const go = (t: Tab) => {
    history.replaceState(null, "", t === "today" ? location.pathname : `#${t}`);
    setTab(t);
    window.scrollTo({ top: 0 });
  };

  const fmt = useCallback(
    (iso: string, opts: Intl.DateTimeFormatOptions) => new Date(iso).toLocaleString("en-US", { timeZone: tz, ...opts }),
    [tz],
  );

  const refresh = useCallback(async () => {
    const res = await fetch("/api/dashboard", { cache: "no-store" });
    if (!res.ok) return;
    const next = (await res.json()) as DashboardData;
    setData((prev) => {
      const seen = new Set(prev.updates.map((u) => u.id));
      setFreshIds(new Set(next.updates.filter((u) => !seen.has(u.id)).map((u) => u.id)));
      return next;
    });
  }, []);

  useEffect(() => {
    const t = setInterval(refresh, REFRESH_MS);
    const onVisible = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  const setDone = async (id: string, done: boolean) => {
    setData((d) => ({
      ...d,
      tasks: d.tasks.map((t) => (t.id === id ? { ...t, done } : t)),
      gym: d.gym.map((g) => (`gym:${g.date}` === id ? { ...g, status: done ? "done" : "planned" } : g)),
      docket: d.docket && {
        ...d.docket,
        items: d.docket.items.map((i) => (`docket:${i.id}` === id ? { ...i, status: done ? "done" : "todo" } : i)),
        tasks: d.docket.tasks?.map((t) => (`docket:task:${t.id}` === id ? { ...t, status: done ? "done" : "todo" } : t)),
      },
    }));
    await fetch("/api/done", { method: "POST", body: JSON.stringify({ id, done }) });
  };

  const hour = Number(now ? fmt(now.toISOString(), { hour: "numeric", hourCycle: "h23" }) : 12);
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const open = data.tasks.filter((t) => t.dueToday && !t.done);
  const overdue = open.filter((t) => t.meta === "OVERDUE").length;
  const running = data.claude.threads.filter((t) => t.state === "running" || t.state === "needs_you");
  const degraded = Object.entries(data.sources).filter(([, s]) => s === "error");
  const prayer = useMemo(() => {
    if (!now) return null;
    const key = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
    const pt = prayerTimes(key, tz, data.docket?.deen?.method);
    const id = PRAYERS.find((p) => pt[p] > now);
    if (!id) return null;
    const mins = Math.round((pt[id].getTime() - now.getTime()) / 60000);
    return `${PRAYER_ORDER.find(([k]) => k === id)![1].toUpperCase()} ${mins >= 60 ? `${Math.floor(mins / 60)}H ` : ""}${mins % 60}M`;
  }, [now, tz, data.docket?.deen?.method]);

  return (
    <>
      <header className="topbar">
        <div className="brand">
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <circle cx="9" cy="9" r="7.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
            <path d="M9 1.5v15M1.5 9h15" stroke="currentColor" strokeWidth="1.2" />
          </svg>
          MISSION CONTROL
        </div>
        <div className="topbar-meta">
          <span>{now ? fmt(now.toISOString(), { weekday: "short", month: "short", day: "numeric" }).toUpperCase() : " "}</span>
          <span className="clock">
            {now ? fmt(now.toISOString(), { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }) : "--:--:--"}
          </span>
          <span className="status">
            <span className="live-dot" style={{ background: degraded.length ? "var(--amber)" : "var(--teal)" }} />
            {degraded.length ? `${degraded.length} SOURCE${degraded.length > 1 ? "S" : ""} DEGRADED` : "ALL SYSTEMS NOMINAL"}
          </span>
          {prayer && (
            <a href="#deen" onClick={(e) => (e.preventDefault(), go("deen"))}>
              {prayer}
            </a>
          )}
          <span>SYNC {now ? ago(data.generatedAt, now) : "NOW"}</span>
          {signOut && (
            <form method="post" action="/api/logout">
              <button className="signout" type="submit">
                SIGN OUT
              </button>
            </form>
          )}
        </div>
      </header>

      <nav className="tabs" aria-label="Sections">
        {TABS.map(([id, label]) => (
          <a key={id} href={`#${id}`} aria-current={tab === id ? "page" : undefined} onClick={(e) => (e.preventDefault(), go(id))}>
            {label}
          </a>
        ))}
      </nav>

      {tab !== "today" && (
        <main className="main">
          {tab === "claude" ? (
            <ClaudeView data={data} fmt={fmt} now={now} />
          ) : tab === "deen" ? (
            <DeenView v={data.docket} tz={tz} now={now} />
          ) : !data.docket ? (
            <NoDocket what={tab === "notes" ? "Your notes" : tab === "courses" ? "Your courses" : "Your classes and due dates"} />
          ) : tab === "courses" ? (
            <CoursesView v={data.docket} tz={tz} now={now} />
          ) : tab === "week" ? (
            <WeekView v={data.docket} tz={tz} now={now} onToggle={setDone} />
          ) : tab === "work" ? (
            <WorkView v={data.docket} tz={tz} now={now} onToggle={setDone} />
          ) : (
            <NotesView v={data.docket} tz={tz} />
          )}
        </main>
      )}

      {tab === "today" && (
      <main className="main">
        <section className="hero">
          <div>
            <h1>
              {greeting}, {owner}.
            </h1>
            <p>
              <strong>
                {open.length - overdue} thing{open.length - overdue === 1 ? "" : "s"}
              </strong>{" "}
              due today{overdue ? ` · ${overdue} overdue` : ""} · {running.length} Claude thread{running.length === 1 ? "" : "s"} active · {data.updates.length} updates
            </p>
          </div>
          <div className="hero-actions">
            <a className="btn btn-primary" href="#add-todo" style={{ display: "inline-flex", alignItems: "center" }}>
              + ADD TO-DO
            </a>
            <a className="btn" href="#notes" style={{ display: "inline-flex", alignItems: "center" }}>
              + NOTE
            </a>
          </div>
        </section>

        {data.docket && <ExamsStrip v={data.docket} tz={tz} now={now} />}

        <div className="grid">
          <TodayPanel tasks={data.tasks} onToggle={setDone} onAdded={refresh} />
          <SchedulePanel data={data} now={now} fmt={fmt} />
          <CanvasPanel data={data} now={now} fmt={fmt} />
        </div>

        <div className="grid">
          <ThreadsPanel data={data} running={running.length} />
          <UsagePanel data={data} fmt={fmt} now={now} />
          <UpdatesPanel updates={data.updates} fresh={freshIds} fmt={fmt} />
        </div>

        <section className="panel" aria-labelledby="graph-title">
          <div className="panel-head">
            <h2 id="graph-title">07 · PROJECT GRAPH</h2>
            <span className="aside">
              <a href="#claude" onClick={(e) => (e.preventDefault(), go("claude"))} style={{ color: "var(--blue-soft)" }}>
                EVERY PROJECT, FLOW CHART AND TOKEN →
              </a>
              <SourceBadge status={data.sources.claude} />
            </span>
          </div>
          {data.claude.graph.nodes.length ? (
            <ProjectGraph graph={data.claude.graph} />
          ) : (
            <p className="empty">No Claude feed yet. Your projects and threads show up here once it's connected.</p>
          )}
        </section>

        <div className="grid">
          <TrainingPanel data={data} onToggle={setDone} />
          <NotesPanel initial={data.notes} />
        </div>

        <p className="footnote">
          SOURCES · CALENDAR {data.sources.calendar.toUpperCase()} · GMAIL {data.sources.gmail.toUpperCase()} · CANVAS{" "}
          {data.sources.canvas.toUpperCase()} · CLAUDE {data.sources.claude.toUpperCase()} · REFRESHES EVERY 3 MIN
        </p>
      </main>
      )}
    </>
  );
}

function ago(iso: string, now: Date) {
  const m = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 60_000));
  return m < 1 ? "NOW" : m < 60 ? `${m}M AGO` : `${Math.round(m / 60)}H AGO`;
}

function SourceBadge({ status }: { status: SourceStatus }) {
  if (status === "live") return <span className="badge live">LIVE</span>;
  if (status === "error") return <span className="badge error">ERROR</span>;
  if (status === "off") return <span className="badge">NOT CONNECTED</span>;
  return <span className="badge">SAMPLE</span>;
}

type Fmt = (iso: string, opts: Intl.DateTimeFormatOptions) => string;

function TodayPanel({
  tasks,
  onToggle,
  onAdded,
}: {
  tasks: TaskItem[];
  onToggle: (id: string, done: boolean) => void;
  onAdded: () => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [saving, setSaving] = useState(false);
  const today = tasks.filter((t) => t.dueToday);
  const later = tasks.filter((t) => !t.dueToday);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    await fetch("/api/todos", {
      method: "POST",
      body: JSON.stringify({ title, due: due ? `${due}T23:59:00` : undefined }),
    });
    setTitle("");
    setDue("");
    await onAdded();
    setSaving(false);
  };

  return (
    <section className="panel" aria-labelledby="today-title">
      <div className="panel-head">
        <h2 id="today-title">01 · TODAY</h2>
        <span className="aside">
          {today.filter((t) => t.done).length}/{today.length} DONE
        </span>
      </div>
      <form className="add-row" id="add-todo" onSubmit={add}>
        <label htmlFor="todo-title" className="sr-only">
          New to-do
        </label>
        <input id="todo-title" placeholder="Add a to-do..." value={title} onChange={(e) => setTitle(e.target.value)} />
        <label htmlFor="todo-due" className="sr-only">
          Due date
        </label>
        <input id="todo-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        <button className="btn" type="submit" disabled={saving} aria-label="Add to-do">
          +
        </button>
      </form>
      {today.length === 0 && <p className="empty">Nothing due today. Clear skies.</p>}
      {[...today, ...later].map((t) => (
        <label key={t.id} className={`row${t.done ? " done" : ""}`}>
          <input type="checkbox" checked={t.done} onChange={(e) => onToggle(t.id, e.target.checked)} />
          <span className="row-main">
            <span className="row-title">{t.title}</span>
            <span className="row-meta">{t.meta}</span>
          </span>
          <span className="tag" style={{ color: SOURCE_COLOR[t.source] }}>
            {t.source}
          </span>
        </label>
      ))}
    </section>
  );
}

const DAY_START = 6;
const DAY_END = 23;

function SchedulePanel({ data, now, fmt }: { data: DashboardData; now: Date | null; fmt: Fmt }) {
  const hourOf = (iso: string) => {
    const [h, m] = fmt(iso, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).split(":").map(Number);
    return h + m / 60;
  };
  const pct = (h: number) => ((Math.min(Math.max(h, DAY_START), DAY_END) - DAY_START) / (DAY_END - DAY_START)) * 100;
  // Routine blocks (prayer, meals) stay off the timeline; gym stays on.
  const timed = data.calendar.today.filter((e) => !e.allDay && (!e.routine || e.kind === "gym"));
  const allDay = data.calendar.today.filter((e) => e.allDay);
  const hours = [];
  for (let h = DAY_START; h < DAY_END; h += 2) hours.push(h);

  return (
    <section className="panel" aria-labelledby="schedule-title">
      <div className="panel-head">
        <h2 id="schedule-title">02 · SCHEDULE</h2>
        <span className="aside">
          GOOGLE CALENDAR <SourceBadge status={data.sources.calendar} />
        </span>
      </div>
      <div className="week">
        {data.calendar.week.map((d, i) => {
          const date = new Date(`${d.date}T12:00:00Z`);
          return (
            <div key={d.date} className={`week-day${i === 0 ? " today" : ""}`}>
              <span className="dow">{date.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }).toUpperCase()}</span>
              <span className="num">{date.getUTCDate()}</span>
              <span className={`load${d.count >= 4 ? " heavy" : ""}`}>{d.count ? `${d.count} EVT` : "CLEAR"}</span>
            </div>
          );
        })}
      </div>
      {allDay.length > 0 && (
        <div className="allday">
          {allDay.map((e) => (
            <span key={e.id} className="badge">
              {e.title}
            </span>
          ))}
        </div>
      )}
      {data.sources.calendar === "off" && <p className="empty">Google Calendar isn&apos;t connected yet.</p>}
      <div className="timeline">
        {hours.map((h) => (
          <div key={h} className="hour" style={{ top: `${pct(h)}%` }}>
            <span>
              {h % 12 || 12}
              {h < 12 ? "A" : "P"}
            </span>
          </div>
        ))}
        {timed.map((e) => {
          const top = pct(hourOf(e.start));
          const height = Math.max(pct(hourOf(e.end)) - top, 4);
          return (
            <a
              key={e.id}
              className="event"
              title={`${e.title}, ${fmt(e.start, { hour: "numeric", minute: "2-digit" })} to ${fmt(e.end, { hour: "numeric", minute: "2-digit" })}`}
              href={e.url}
              target="_blank"
              rel="noreferrer"
              style={{ top: `${top}%`, height: `calc(${height}% - 3px)`, borderLeftColor: EVENT_COLOR[e.kind] }}
            >
              <div className="event-title">{e.title}</div>
              {hourOf(e.end) - hourOf(e.start) >= 1.5 && <div className="event-time">
                {fmt(e.start, { hour: "numeric", minute: "2-digit" })} to {fmt(e.end, { hour: "numeric", minute: "2-digit" })}
              </div>}
            </a>
          );
        })}
        {now && <div className="now-line" style={{ top: `${pct(hourOf(now.toISOString()))}%` }} aria-hidden="true" />}
      </div>
    </section>
  );
}

function CanvasPanel({ data, now, fmt }: { data: DashboardData; now: Date | null; fmt: Fmt }) {
  const today = now ? fmt(now.toISOString(), { year: "numeric", month: "2-digit", day: "2-digit" }) : "";
  const tomorrow = now ? fmt(new Date(now.getTime() + 86_400_000).toISOString(), { year: "numeric", month: "2-digit", day: "2-digit" }) : "";
  const upcoming = data.canvas.assignments
    .filter((a) => !a.submitted && (!now || new Date(a.due).getTime() > now.getTime() - 86_400_000))
    .sort((a, b) => a.due.localeCompare(b.due))
    .slice(0, 7);

  return (
    <section className="panel" aria-labelledby="canvas-title">
      <div className="panel-head">
        <h2 id="canvas-title">03 · CANVAS</h2>
        <span className="aside">
          NEXT 7 DAYS <SourceBadge status={data.sources.canvas} />
        </span>
      </div>
      {upcoming.length === 0 && <p className="empty">No open assignments in the next two weeks.</p>}
      {upcoming.map((a) => {
        const day = fmt(a.due, { year: "numeric", month: "2-digit", day: "2-digit" });
        const label = day === today ? "TODAY" : day === tomorrow ? "TMRW" : fmt(a.due, { weekday: "short" }).toUpperCase();
        const color = day === today || day === tomorrow ? "var(--amber)" : "var(--text-2)";
        return (
          <a key={a.id} className="row assignment" href={a.url} target="_blank" rel="noreferrer">
            <span className="when" style={{ color }}>
              {label}
            </span>
            <span className="row-main">
              <span className="row-title">{a.title}</span>
              <span className="row-meta">
                {a.course} · {fmt(a.due, { hour: "numeric", minute: "2-digit" })}
              </span>
            </span>
            <span className="row-meta">{a.points != null ? `${a.points} PTS` : ""}</span>
          </a>
        );
      })}
      {data.canvas.grades.length > 0 && (
        <div className="panel-body" style={{ borderTop: "1px solid var(--line)" }}>
          <span className="label">GRADES</span>
          <div className="grades">
            {data.canvas.grades.map((g) => (
              <div key={g.course} className="grade">
                <span>{g.course}</span>
                <span className="meter">
                  <span style={{ width: `${Math.min(g.score ?? 0, 100)}%`, background: "var(--silver)" }} />
                </span>
                <span style={{ textAlign: "right" }}>{g.score != null ? `${g.score.toFixed(1)}%` : "--"}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function ThreadsPanel({ data, running }: { data: DashboardData; running: number }) {
  return (
    <section className="panel" aria-labelledby="threads-title">
      <div className="panel-head">
        <h2 id="threads-title">04 · CLAUDE · LIVE</h2>
        <span className="aside">
          <span className="live-dot" style={{ background: "var(--blue)" }} />
          {running} ACTIVE <SourceBadge status={data.sources.claude} />
        </span>
      </div>
      {data.claude.threads.length === 0 && <p className="empty">No threads yet.</p>}
      {data.claude.threads.map((t) => {
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
              {t.project.toUpperCase()} · {t.step}
            </span>
            {t.progress != null && (
              <span className="meter">
                <span style={{ width: `${Math.round(t.progress * 100)}%`, background: s.color }} />
              </span>
            )}
          </>
        );
        return t.url ? (
          <a key={t.id} className="row thread" href={t.url} target="_blank" rel="noreferrer">
            {body}
          </a>
        ) : (
          <div key={t.id} className="row thread">
            {body}
          </div>
        );
      })}
    </section>
  );
}

function UsagePanel({ data, fmt, now }: { data: DashboardData; fmt: Fmt; now: Date | null }) {
  const u = data.claude.usage;
  const donut = useMemo(() => {
    let acc = 0;
    const stops = u.byProject.map((p, i) => {
      const from = acc;
      acc += p.pct;
      return `${SPLIT_COLORS[i % SPLIT_COLORS.length]} ${from}% ${acc}%`;
    });
    return `conic-gradient(${stops.join(", ")}${acc < 100 ? `, var(--line) ${acc}% 100%` : ""})`;
  }, [u.byProject]);
  const limits =
    u.limits && u.limits.length
      ? u.limits
      : [
          ...(u.session ? [{ label: "5-hour session", ...u.session }] : []),
          ...(u.weekly ? [{ label: "Weekly limit", ...u.weekly }] : []),
        ];
  const history = (u.history ?? []).filter((h) => h.weekly != null);
  const max = Math.max(1, ...u.daily);
  const threadCount = data.claude.threads.length;
  const resets = (iso?: string) => {
    if (!iso) return "";
    const mins = now ? Math.round((new Date(iso).getTime() - now.getTime()) / 60_000) : 0;
    if (mins > 0 && mins < 24 * 60) return ` · RESETS ${Math.floor(mins / 60)}H ${mins % 60}M`;
    return ` · RESETS ${fmt(iso, { weekday: "short" }).toUpperCase()}`;
  };

  return (
    <section className="panel" aria-labelledby="usage-title">
      <div className="panel-head">
        <h2 id="usage-title">05 · USAGE · {u.plan.toUpperCase()}</h2>
        <span className="aside">
          {u.estimated ? "ESTIMATED" : "FROM CLAUDE.AI"} <SourceBadge status={data.sources.claude} />
        </span>
      </div>
      <div className="panel-body">
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
        {u.byProject.length > 0 && (
          <div className="donut-wrap">
            <div className="donut" role="img" aria-label="Share of Claude threads by project" style={{ background: donut }}>
              <div className="donut-hole">
                <strong>{threadCount || u.daily.slice(-7).reduce((a, b) => a + b, 0)}</strong>
                <span>{threadCount ? "THREADS" : "MSGS / 7D"}</span>
              </div>
            </div>
            <div className="legend">
              {u.byProject.map((p, i) => (
                <div key={p.name} className="legend-row">
                  <i style={{ background: SPLIT_COLORS[i % SPLIT_COLORS.length] }} />
                  <span>{p.name}</span>
                  <span className="mono">{p.pct}%</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {limits.length === 0 && u.byProject.length === 0 && u.daily.length === 0 && (
          <p className="empty">No usage data yet. It comes in with the next sync, read from your Claude usage page.</p>
        )}
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
        {u.readAt && <span className="row-meta">READ FROM CLAUDE.AI · {fmt(u.readAt, { weekday: "short", hour: "numeric", minute: "2-digit" }).toUpperCase()}</span>}
        {u.daily.length > 0 && (
          <div className="limit">
            <span className="row-meta">MESSAGES · LAST {u.daily.length} DAYS</span>
            <div className="bars" role="img" aria-label={`Messages per day, most recent ${u.daily.at(-1)}`}>
              {u.daily.map((v, i) => (
                <div key={i} style={{ height: `${(v / max) * 100}%` }} />
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function UpdatesPanel({ updates, fresh, fmt }: { updates: UpdateItem[]; fresh: Set<string>; fmt: Fmt }) {
  return (
    <section className="panel" aria-labelledby="updates-title">
      <div className="panel-head">
        <h2 id="updates-title">06 · UPDATES</h2>
        <span className="aside">GMAIL · CANVAS · GITHUB · CLAUDE</span>
      </div>
      {updates.length === 0 && <p className="empty">Quiet so far.</p>}
      {updates.map((u) => {
        const inner = (
          <>
            <time dateTime={u.at}>{fmt(u.at, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })}</time>
            <span className="src" style={{ color: SOURCE_COLOR[u.source] }}>
              {u.source}
            </span>
            <p>{u.text}</p>
          </>
        );
        const cls = `update${fresh.has(u.id) ? " fresh" : ""}`;
        return u.url ? (
          <a key={u.id} className={cls} href={u.url} target="_blank" rel="noreferrer">
            {inner}
          </a>
        ) : (
          <div key={u.id} className={cls}>
            {inner}
          </div>
        );
      })}
    </section>
  );
}

function TrainingPanel({ data, onToggle }: { data: DashboardData; onToggle: (id: string, done: boolean) => void }) {
  return (
    <section className="panel" aria-labelledby="gym-title">
      <div className="panel-head">
        <h2 id="gym-title">08 · TRAINING</h2>
        <span className="aside">TAP A DAY TO LOG IT</span>
      </div>
      <div className="gym">
        {data.gym.map((g, i) => {
          const date = new Date(`${g.date}T12:00:00Z`);
          const color =
            g.status === "done" ? "var(--teal)" : g.status === "today" ? "var(--amber)" : g.status === "missed" ? "var(--dim)" : "var(--faint)";
          return (
            <button
              key={g.date}
              type="button"
              className={i === 1 ? "today" : ""}
              disabled={g.status === "rest"}
              aria-pressed={g.status === "done"}
              onClick={() => onToggle(`gym:${g.date}`, g.status !== "done")}
            >
              <span className="row-meta">{date.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }).toUpperCase()}</span>
              <span className="split">{g.split}</span>
              <span className="row-meta" style={{ color }}>
                {g.status === "rest" ? "·" : g.status === "missed" ? "NOT LOGGED" : g.status.toUpperCase()}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function NotesPanel({ initial }: { initial: string }) {
  const [text, setText] = useState(initial);
  const [state, setState] = useState<"saved" | "saving" | "error">("saved");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onChange = (value: string) => {
    setText(value);
    setState("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const res = await fetch("/api/notes", { method: "PUT", body: JSON.stringify({ text: value }) }).catch(() => null);
      setState(res?.ok ? "saved" : "error");
    }, 800);
  };

  return (
    <section className="panel" aria-labelledby="notes-title" id="notes">
      <div className="panel-head">
        <h2 id="notes-title">09 · NOTES</h2>
        <span className="aside" aria-live="polite">
          {state === "saved" ? "SAVED" : state === "saving" ? "SAVING..." : "NOT SAVED"}
        </span>
      </div>
      <label htmlFor="notes-text" className="sr-only">
        Notes
      </label>
      <textarea id="notes-text" className="notes" placeholder="Capture anything..." value={text} onChange={(e) => onChange(e.target.value)} />
    </section>
  );
}
