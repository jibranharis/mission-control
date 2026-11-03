"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DocketItem, DocketView } from "@/lib/sources/docket";
import { DOCKET_PREFIX } from "@/lib/sources/docket";
import type { LifeData, LifeProject, PlanBlock, ProjectTask, StudySession } from "@/lib/life";

type Toggle = (id: string, done: boolean) => void;
type SaveState = "loading" | "saved" | "saving" | "error";

const uid = () => crypto.randomUUID().slice(0, 8);
const COLORS = ["var(--blue)", "var(--amber)", "var(--teal)", "var(--silver)", "var(--blue-soft)"];

/* ---------- Dates ---------- */

const keyOf = (d: Date, tz: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const addDays = (key: string, n: number) => {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const mondayOf = (key: string) => addDays(key, -((new Date(`${key}T12:00:00Z`).getUTCDay() + 6) % 7));
const dayName = (key: string, opts: Intl.DateTimeFormatOptions) =>
  new Date(`${key}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", ...opts });
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 864e5);
const hm = (mins: number) => (mins >= 60 ? `${Math.floor(mins / 60)}h${mins % 60 ? ` ${mins % 60}m` : ""}` : `${mins}m`);

function dueLabel(due: string, today: string) {
  const d = daysBetween(today, due);
  if (d < 0) return { text: `${-d}D OVERDUE`, color: "var(--amber)" };
  if (d === 0) return { text: "DUE TODAY", color: "var(--amber)" };
  if (d === 1) return { text: "DUE TMRW", color: "var(--text-2)" };
  return { text: `DUE ${dayName(due, { weekday: "short", month: "short", day: "numeric" }).toUpperCase()}`, color: "var(--muted)" };
}

/* ---------- Store ---------- */

/** Loads /api/life once and saves each collection shortly after it changes. */
function useLife() {
  const [life, setLife] = useState<LifeData | null>(null);
  const [state, setState] = useState<SaveState>("loading");
  const ref = useRef<LifeData | null>(null);
  const timers = useRef<Partial<Record<keyof LifeData, ReturnType<typeof setTimeout>>>>({});
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  const load = useCallback(async () => {
    const res = await fetch("/api/life", { cache: "no-store" }).catch(() => null);
    if (!res?.ok) return setState("error");
    ref.current = (await res.json()) as LifeData;
    setLife(ref.current);
    setState("saved");
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const update = useCallback(<K extends keyof LifeData>(k: K, fn: (prev: LifeData[K]) => LifeData[K]) => {
    if (!ref.current) return;
    ref.current = { ...ref.current, [k]: fn(ref.current[k]) };
    setLife(ref.current);
    setState("saving");
    clearTimeout(timers.current[k]);
    timers.current[k] = setTimeout(() => {
      const body = JSON.stringify({ [k]: ref.current![k] });
      queue.current = queue.current.then(async () => {
        const res = await fetch("/api/life", { method: "PUT", body }).catch(() => null);
        setState(res?.ok ? "saved" : "error");
      });
    }, 400);
  }, []);

  return { life, update, state };
}

function SaveBadge({ state }: { state: SaveState }) {
  return (
    <span className="row-meta" aria-live="polite" style={{ color: state === "error" ? "var(--amber)" : undefined }}>
      {state === "loading" ? "LOADING..." : state === "saving" ? "SAVING..." : state === "error" ? "NOT SAVED · CHECK CONNECTION" : "SAVED"}
    </span>
  );
}

/* ---------- Projects ---------- */

export function ProjectsView({ tz, now }: { tz: string; now: Date | null }) {
  const { life, update, state } = useLife();
  const [sel, setSel] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const today = keyOf(now ?? new Date(), tz);
  const projects = life?.projects ?? [];
  const current = projects.find((p) => p.id === sel) ?? projects[0];

  const setProject = (id: string, fn: (p: LifeProject) => LifeProject) =>
    update("projects", (ps) => ps.map((p) => (p.id === id ? fn(p) : p)));

  const addProject = (e: React.FormEvent) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    const id = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 32)}-${uid()}`;
    update("projects", (ps) => [...ps, { id, name, blurb: "", tasks: [] }]);
    setSel(id);
    setNewName("");
  };

  const open = projects.flatMap((p) => p.tasks.filter((t) => !t.done));
  const weekEnd = addDays(today, 7);
  const dueSoon = open.filter((t) => t.due && t.due <= weekEnd).length;
  const overdue = open.filter((t) => t.due && t.due < today).length;

  return (
    <>
      <div className="view-head">
        <h1>Projects</h1>
        <SaveBadge state={state} />
      </div>
      <div className="stats">
        <div className="stat">
          <strong>{projects.length}</strong>
          <span>PROJECTS</span>
        </div>
        <div className="stat">
          <strong>{open.length}</strong>
          <span>OPEN TO-DOS</span>
        </div>
        <div className="stat">
          <strong>{dueSoon}</strong>
          <span>DUE IN 7 DAYS</span>
        </div>
        <div className="stat">
          <strong style={{ color: overdue ? "var(--amber)" : undefined }}>{overdue}</strong>
          <span>OVERDUE</span>
        </div>
      </div>
      <section className="panel">
        <div className="projects">
          <div className="project-list">
            {projects.map((p, i) => {
              const left = p.tasks.filter((t) => !t.done);
              const next = left.filter((t) => t.due).sort((a, b) => a.due!.localeCompare(b.due!))[0];
              return (
                <button
                  key={p.id}
                  type="button"
                  className="project-card"
                  aria-pressed={current?.id === p.id}
                  onClick={() => setSel(p.id)}
                  style={{ boxShadow: current?.id === p.id ? `inset 3px 0 0 ${COLORS[i % COLORS.length]}` : undefined }}
                >
                  <strong>{p.name || "Untitled"}</strong>
                  <span className="row-meta">
                    {left.length} OPEN{p.tasks.length - left.length ? ` · ${p.tasks.length - left.length} DONE` : ""}
                    {next ? ` · ${dueLabel(next.due!, today).text}` : ""}
                  </span>
                  {p.tasks.length > 0 && (
                    <span className="meter" style={{ width: "100%" }}>
                      <span style={{ width: `${((p.tasks.length - left.length) / p.tasks.length) * 100}%`, background: COLORS[i % COLORS.length] }} />
                    </span>
                  )}
                </button>
              );
            })}
            <form className="add-row" onSubmit={addProject} style={{ borderBottom: 0 }}>
              <label htmlFor="new-project" className="sr-only">
                New project
              </label>
              <input id="new-project" placeholder="New project..." value={newName} onChange={(e) => setNewName(e.target.value)} />
              <button className="btn" type="submit" aria-label="Add project">
                +
              </button>
            </form>
          </div>
          {current ? (
            <ProjectDetail
              key={current.id}
              p={current}
              today={today}
              onChange={(fn) => setProject(current.id, fn)}
              onDelete={() => {
                update("projects", (ps) => ps.filter((x) => x.id !== current.id));
                setSel(null);
              }}
            />
          ) : (
            <p className="empty">{life ? "No projects yet. Add one on the left." : "Loading projects..."}</p>
          )}
        </div>
      </section>
    </>
  );
}

function ProjectDetail({
  p,
  today,
  onChange,
  onDelete,
}: {
  p: LifeProject;
  today: string;
  onChange: (fn: (p: LifeProject) => LifeProject) => void;
  onDelete: () => void;
}) {
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const open = p.tasks.filter((t) => !t.done).sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999"));
  const done = p.tasks.filter((t) => t.done);

  const setTask = (id: string, patch: Partial<ProjectTask>) =>
    onChange((x) => ({ ...x, tasks: x.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)) }));
  const add = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    const task: ProjectTask = { id: uid(), title: title.trim().slice(0, 200), done: false, due: due || undefined, createdAt: new Date().toISOString() };
    onChange((x) => ({ ...x, tasks: [...x.tasks, task] }));
    setTitle("");
    setDue("");
  };

  const row = (t: ProjectTask) => {
    const d = t.due ? dueLabel(t.due, today) : null;
    return (
      <div key={t.id} className={`row${t.done ? " done" : ""}`}>
        <input type="checkbox" checked={t.done} onChange={(e) => setTask(t.id, { done: e.target.checked })} aria-label={`Done: ${t.title}`} />
        <span className="row-main">
          <input className="inline-edit row-title" value={t.title} onChange={(e) => setTask(t.id, { title: e.target.value })} aria-label="To-do" />
          <span className="row-meta" style={{ display: "flex", gap: 10, alignItems: "center" }}>
            {d && !t.done && <span style={{ color: d.color }}>{d.text}</span>}
            <input
              type="date"
              className="inline-date"
              value={t.due ?? ""}
              onChange={(e) => setTask(t.id, { due: e.target.value || undefined })}
              aria-label="Due date"
            />
          </span>
        </span>
        <button type="button" className="icon-btn" onClick={() => onChange((x) => ({ ...x, tasks: x.tasks.filter((y) => y.id !== t.id) }))} aria-label={`Remove ${t.title}`}>
          ×
        </button>
      </div>
    );
  };

  return (
    <div className="project-detail">
      <div className="project-meta" style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}>
        <input className="inline-edit project-name" value={p.name} onChange={(e) => onChange((x) => ({ ...x, name: e.target.value }))} aria-label="Project name" />
        <input
          className="inline-edit"
          placeholder="What this project is about..."
          value={p.blurb ?? ""}
          onChange={(e) => onChange((x) => ({ ...x, blurb: e.target.value }))}
          aria-label="Project description"
          style={{ color: "var(--text-2)", fontSize: 14 }}
        />
      </div>
      <form className="add-row wrap-sm" onSubmit={add}>
        <label htmlFor="task-title" className="sr-only">
          New to-do
        </label>
        <input id="task-title" placeholder={`Add a to-do to ${p.name || "this project"}...`} value={title} onChange={(e) => setTitle(e.target.value)} />
        <label htmlFor="task-due" className="sr-only">
          Due date
        </label>
        <input id="task-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        <button className="btn" type="submit" aria-label="Add to-do">
          +
        </button>
      </form>
      {open.length === 0 && <p className="empty">Nothing left to do here.</p>}
      {open.map(row)}
      {done.length > 0 && (
        <>
          <button type="button" className="group-head group-toggle" onClick={() => setShowDone(!showDone)} aria-expanded={showDone}>
            <span>{showDone ? "HIDE" : "SHOW"} DONE</span>
            <span>{done.length}</span>
          </button>
          {showDone && done.map(row)}
        </>
      )}
      <div style={{ marginTop: "auto", padding: "14px 18px", borderTop: "1px solid var(--line)", display: "flex", gap: 10, alignItems: "center" }}>
        {confirm ? (
          <>
            <span className="row-meta">DELETE {p.name.toUpperCase()} AND ITS {p.tasks.length} TO-DOS?</span>
            <button type="button" className="btn" style={{ color: "var(--amber)", minHeight: 36 }} onClick={onDelete}>
              DELETE
            </button>
            <button type="button" className="btn" style={{ minHeight: 36 }} onClick={() => setConfirm(false)}>
              KEEP
            </button>
          </>
        ) : (
          <button type="button" className="link-btn" onClick={() => setConfirm(true)}>
            DELETE PROJECT
          </button>
        )}
      </div>
    </div>
  );
}

/* ---------- Plan ---------- */

interface Plannable {
  ref: string;
  title: string;
  meta: string;
  due?: string;
  color: string;
}

function schoolWork(v: DocketView | null, tz: string): (Plannable & { done: boolean })[] {
  if (!v) return [];
  const code = (i: DocketItem) => (i.course ? v.courses[i.course]?.code ?? i.course.toUpperCase() : "LIFE");
  const ids = Object.keys(v.courses);
  const color = (i: DocketItem) => (i.course ? COLORS[Math.max(0, ids.indexOf(i.course)) % 3] : "var(--silver)");
  return [
    ...v.items.filter((i) => i.status !== "skipped").map((i) => ({ i, ref: `${DOCKET_PREFIX}${i.id}` })),
    ...(v.tasks ?? []).map((i) => ({ i, ref: `${DOCKET_PREFIX}task:${i.id}` })),
  ]
    .filter(({ i }) => i.due && i.kind !== "class")
    .map(({ i, ref }) => ({
      ref,
      title: i.title,
      meta: `${code(i)}${i.kind ? ` · ${i.kind.toUpperCase()}` : ""}`,
      due: keyOf(new Date(i.due!), tz),
      color: color(i),
      done: i.status === "done",
    }));
}

export function PlanView({ v, tz, now, onToggle }: { v: DocketView | null; tz: string; now: Date | null; onToggle: Toggle }) {
  const { life, update, state } = useLife();
  const [offset, setOffset] = useState(0);
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [time, setTime] = useState("");
  const today = keyOf(now ?? new Date(), tz);
  const monday = addDays(mondayOf(today), offset * 7);
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const [day, setDay] = useState(today);

  const school = useMemo(() => schoolWork(v, tz), [v, tz]);
  const projectTasks = useMemo(
    () =>
      (life?.projects ?? []).flatMap((p, i) =>
        p.tasks.map((t) => ({ ref: `project:${p.id}:${t.id}`, title: t.title, meta: p.name.toUpperCase(), due: t.due, color: COLORS[i % COLORS.length], done: t.done })),
      ),
    [life?.projects],
  );
  const plan = life?.plan ?? [];
  const planned = new Set(plan.filter((b) => !b.done && b.ref).map((b) => b.ref));
  const horizon = addDays(today, 21);
  const pool = [
    ...school.filter((s) => !s.done && s.due! <= horizon && s.due! >= addDays(today, -7)),
    ...projectTasks.filter((t) => !t.done && (!t.due || t.due <= addDays(today, 60))),
  ]
    .filter((x) => !planned.has(x.ref))
    .sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999"));
  const lookup = new Map([...school, ...projectTasks].map((x) => [x.ref, x]));

  const schedule = (item: Plannable, date: string) =>
    update("plan", (ps) => [...ps, { id: uid(), title: item.title, date, ref: item.ref, done: false }]);
  const move = (id: string, date: string) => update("plan", (ps) => ps.map((b) => (b.id === id ? { ...b, date } : b)));
  const setBlock = (id: string, patch: Partial<PlanBlock>) => update("plan", (ps) => ps.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  const remove = (id: string) => update("plan", (ps) => ps.filter((b) => b.id !== id));

  /** Checking off a planned block checks off what it plans, too. */
  const toggleBlock = (b: PlanBlock, done: boolean) => {
    setBlock(b.id, { done });
    if (!b.ref) return;
    if (b.ref.startsWith(DOCKET_PREFIX)) onToggle(b.ref, done);
    else if (b.ref.startsWith("project:")) {
      const [, pid, tid] = b.ref.split(":");
      update("projects", (ps) => ps.map((p) => (p.id === pid ? { ...p, tasks: p.tasks.map((t) => (t.id === tid ? { ...t, done } : t)) } : p)));
    }
  };

  const drop = (date: string) => {
    if (!drag) return;
    if (drag.startsWith("block:")) move(drag.slice(6), date);
    else {
      const item = pool.find((x) => x.ref === drag);
      if (item) schedule(item, date);
    }
    setDrag(null);
    setOver(null);
  };

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    update("plan", (ps) => [...ps, { id: uid(), title: title.trim().slice(0, 200), date: day, time: time || undefined, done: false }]);
    setTitle("");
    setTime("");
  };

  return (
    <>
      <div className="view-head">
        <h1>Plan</h1>
        <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
          <SaveBadge state={state} />
          <div className="seg">
            <button type="button" onClick={() => setOffset(offset - 1)} aria-label="Previous week">
              ←
            </button>
            <button type="button" onClick={() => setOffset(0)} aria-pressed={offset === 0}>
              {dayName(days[0], { month: "short", day: "numeric" }).toUpperCase()} – {dayName(days[6], { month: "short", day: "numeric" }).toUpperCase()}
            </button>
            <button type="button" onClick={() => setOffset(offset + 1)} aria-label="Next week">
              →
            </button>
          </div>
        </div>
      </div>
      <p className="row-meta" style={{ margin: 0 }}>
        PICK A DAY FOR EACH THING BELOW, OR DRAG IT ONTO A DAY. CHECKING IT OFF HERE CHECKS IT OFF EVERYWHERE.
      </p>

      <div className="plan-layout">
        <section className="panel plan-pool">
          <div className="panel-head">
            <h2>TO SCHEDULE</h2>
            <span className="aside">{pool.length}</span>
          </div>
          {!life && <p className="empty">Loading...</p>}
          {life && pool.length === 0 && <p className="empty">Everything coming up has a day. Nice.</p>}
          {pool.map((x) => {
            const d = x.due ? dueLabel(x.due, today) : null;
            return (
              <div key={x.ref} className="row pool-item" draggable onDragStart={() => setDrag(x.ref)} onDragEnd={() => setDrag(null)} style={{ borderLeft: `2px solid ${x.color}` }}>
                <span className="row-main">
                  <span className="row-title">{x.title}</span>
                  <span className="row-meta">
                    {x.meta}
                    {d && <span style={{ color: d.color }}> · {d.text}</span>}
                  </span>
                  <label className="sr-only" htmlFor={`plan-${x.ref}`}>
                    Plan {x.title} for
                  </label>
                  <select
                    id={`plan-${x.ref}`}
                    className="plan-select pool-select"
                    value=""
                    onChange={(e) => e.target.value && schedule(x, e.target.value)}
                  >
                    <option value="">PLAN…</option>
                    {Array.from({ length: 14 }, (_, i) => addDays(today, i)).map((k) => (
                      <option key={k} value={k}>
                        {k === today ? "Today" : k === addDays(today, 1) ? "Tomorrow" : dayName(k, { weekday: "short", month: "short", day: "numeric" })}
                        {x.due && k > x.due ? " (after due)" : ""}
                      </option>
                    ))}
                  </select>
                </span>
              </div>
            );
          })}
        </section>

        <div className="plan-main">
          <form className="panel add-row plan-add wrap-sm" onSubmit={add}>
            <label htmlFor="plan-title" className="sr-only">
              Plan something
            </label>
            <input id="plan-title" placeholder="Plan something else..." value={title} onChange={(e) => setTitle(e.target.value)} />
            <label htmlFor="plan-day" className="sr-only">
              Day
            </label>
            <select id="plan-day" className="plan-select" value={day} onChange={(e) => setDay(e.target.value)}>
              {Array.from({ length: 21 }, (_, i) => addDays(today, i)).map((k) => (
                <option key={k} value={k}>
                  {k === today ? "Today" : dayName(k, { weekday: "short", month: "short", day: "numeric" })}
                </option>
              ))}
            </select>
            <label htmlFor="plan-time" className="sr-only">
              Time
            </label>
            <input id="plan-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} style={{ flex: "0 0 auto", width: 120 }} />
            <button className="btn" type="submit" aria-label="Add to plan">
              +
            </button>
          </form>

          <div className="week-grid">
            {days.map((k) => {
              const blocks = plan.filter((b) => b.date === k).sort((a, b) => (a.time ?? "99").localeCompare(b.time ?? "99"));
              const dueHere = [...school, ...projectTasks].filter((x) => x.due === k && !x.done);
              return (
                <section
                  key={k}
                  className={`panel day${k === today ? " today" : ""}${over === k ? " drop" : ""}${k < today ? " past" : ""}`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setOver(k);
                  }}
                  onDragLeave={() => setOver((o) => (o === k ? null : o))}
                  onDrop={() => drop(k)}
                >
                  <div className="day-head">
                    <span>{dayName(k, { weekday: "short" }).toUpperCase()}</span>
                    <span className="mono">{dayName(k, { day: "numeric" })}</span>
                  </div>
                  {blocks.map((b) => {
                    const src = b.ref ? lookup.get(b.ref) : undefined;
                    const late = src?.due && k > src.due;
                    return (
                      <div
                        key={b.id}
                        className={`ev due${b.done ? " done" : ""}`}
                        draggable
                        onDragStart={() => setDrag(`block:${b.id}`)}
                        onDragEnd={() => setDrag(null)}
                        style={{ borderLeftColor: src?.color ?? "var(--silver)" }}
                      >
                        <span className="ev-title">
                          <input type="checkbox" checked={b.done} onChange={(e) => toggleBlock(b, e.target.checked)} aria-label={`Done: ${b.title}`} />
                          <span style={{ flex: 1 }}>{b.title}</span>
                          <button type="button" className="icon-btn" onClick={() => remove(b.id)} aria-label={`Unplan ${b.title}`}>
                            ×
                          </button>
                        </span>
                        <span className="row-meta">
                          {b.time ? `${b.time} · ` : ""}
                          {src?.meta ?? "PLANNED"}
                          {src?.due && <span style={{ color: late ? "var(--amber)" : undefined }}> · {late ? "AFTER DUE" : `DUE ${dayName(src.due, { weekday: "short" }).toUpperCase()}`}</span>}
                        </span>
                        <select className="plan-select mini" value={k} onChange={(e) => move(b.id, e.target.value)} aria-label={`Move ${b.title}`}>
                          {Array.from({ length: 21 }, (_, i) => addDays(monday, i - 7))
                            .filter((d) => d >= today || d === k)
                            .map((d) => (
                              <option key={d} value={d}>
                                {d === k ? "Move to…" : dayName(d, { weekday: "short", month: "short", day: "numeric" })}
                              </option>
                            ))}
                        </select>
                      </div>
                    );
                  })}
                  {dueHere.map((x) => (
                    <div key={x.ref} className="due-mark" style={{ borderLeftColor: x.color }}>
                      <span className="row-meta" style={{ color: "var(--amber)" }}>DUE</span> {x.title}
                    </div>
                  ))}
                  {!blocks.length && !dueHere.length && <p className="day-empty">{drag ? "DROP HERE" : "OPEN"}</p>}
                </section>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}

/* ---------- Study ---------- */

export function StudyView({ v, tz, now }: { v: DocketView | null; tz: string; now: Date | null }) {
  const { life, update, state } = useLife();
  const study = life?.study;
  const today = keyOf(now ?? new Date(), tz);
  const monday = mondayOf(today);
  const courses = v ? Object.values(v.courses).map((c) => c.code) : [];
  const subjects = [...new Set([...courses, ...(study?.subjects ?? [])])];
  const [subject, setSubject] = useState("");
  const [mins, setMins] = useState("");
  const [date, setDate] = useState("");
  const [newSubject, setNewSubject] = useState("");
  const pick = subject || study?.timer?.subject || subjects[0] || "General";

  const sessions = study?.sessions ?? [];
  const week = sessions.filter((s) => s.date >= monday && s.date <= addDays(monday, 6));
  const weekTotal = week.reduce((a, s) => a + s.minutes, 0);
  const todayTotal = sessions.filter((s) => s.date === today).reduce((a, s) => a + s.minutes, 0);
  const byDay = new Map<string, number>();
  for (const s of sessions) byDay.set(s.date, (byDay.get(s.date) ?? 0) + s.minutes);
  let streak = 0;
  for (let k = byDay.has(today) ? today : addDays(today, -1); byDay.has(k); k = addDays(k, -1)) streak++;
  const last14 = Array.from({ length: 14 }, (_, i) => addDays(today, i - 13));
  const max14 = Math.max(30, ...last14.map((k) => byDay.get(k) ?? 0));
  const shownSubjects = [...new Set([...subjects, ...week.map((s) => s.subject)])];

  const log = (s: Omit<StudySession, "id">) => update("study", (st) => ({ ...st, sessions: [{ id: uid(), ...s }, ...st.sessions].slice(0, 2000) }));

  const timer = study?.timer;
  const elapsed = timer && now ? Math.max(0, Math.floor((now.getTime() - Date.parse(timer.startedAt)) / 1000)) : 0;
  const clock = `${String(Math.floor(elapsed / 3600)).padStart(2, "0")}:${String(Math.floor((elapsed % 3600) / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;
  const start = () => update("study", (st) => ({ ...st, timer: { subject: pick, startedAt: new Date().toISOString() } }));
  const stop = (keep: boolean) => {
    if (!timer) return;
    const m = Math.max(1, Math.round(elapsed / 60));
    update("study", (st) => ({
      ...st,
      timer: null,
      sessions: keep ? [{ id: uid(), subject: timer.subject, minutes: m, date: keyOf(new Date(timer.startedAt), tz) }, ...st.sessions] : st.sessions,
    }));
  };

  const addManual = (e: React.FormEvent) => {
    e.preventDefault();
    const m = Math.round(Number(mins));
    if (!m || m <= 0 || m > 24 * 60) return;
    log({ subject: pick, minutes: m, date: date || today });
    setMins("");
    setDate("");
  };

  return (
    <>
      <div className="view-head">
        <h1>Study</h1>
        <SaveBadge state={state} />
      </div>
      <div className="stats">
        <div className="stat">
          <strong>{hm(todayTotal)}</strong>
          <span>TODAY</span>
        </div>
        <div className="stat">
          <strong>{hm(weekTotal)}</strong>
          <span>THIS WEEK</span>
        </div>
        <div className="stat">
          <strong>{streak}</strong>
          <span>DAY STREAK</span>
        </div>
        <div className="stat">
          <strong>{sessions.length}</strong>
          <span>SESSIONS</span>
        </div>
      </div>

      <div className="grid">
        <section className="panel">
          <div className="panel-head">
            <h2>SESSION</h2>
            <span className="aside">{timer ? <><span className="live-dot" style={{ background: "var(--teal)" }} /> RUNNING · {timer.subject}</> : "READY"}</span>
          </div>
          <div className="panel-body">
            <span className="study-clock mono" style={{ color: timer ? "var(--text)" : "var(--dim)" }}>
              {clock}
            </span>
            <div className="filters">
              {(subjects.length ? subjects : ["General"]).map((s) => (
                <button key={s} type="button" aria-pressed={(timer?.subject ?? pick) === s} disabled={Boolean(timer)} onClick={() => setSubject(s)}>
                  {s.toUpperCase()}
                </button>
              ))}
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {timer ? (
                <>
                  <button type="button" className="btn btn-primary" onClick={() => stop(true)}>
                    STOP AND LOG
                  </button>
                  <button type="button" className="btn" onClick={() => stop(false)}>
                    DISCARD
                  </button>
                </>
              ) : (
                <button type="button" className="btn btn-primary" onClick={start} disabled={!study}>
                  START {pick.toUpperCase()}
                </button>
              )}
            </div>
            <span className="row-meta">THE TIMER KEEPS RUNNING IF YOU CLOSE THE PAGE OR SWITCH TO YOUR PHONE.</span>
          </div>
          <form className="add-row wrap-sm" onSubmit={addManual} style={{ borderTop: "1px solid var(--line)", borderBottom: 0 }}>
            <label htmlFor="study-mins" className="sr-only">
              Minutes studied
            </label>
            <input id="study-mins" type="number" min={1} max={1440} placeholder={`Log minutes of ${pick}...`} value={mins} onChange={(e) => setMins(e.target.value)} />
            <label htmlFor="study-date" className="sr-only">
              Date
            </label>
            <input id="study-date" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} />
            <button className="btn" type="submit" aria-label="Log session">
              +
            </button>
          </form>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>THIS WEEK BY SUBJECT</h2>
            <span className="aside">WEEKLY GOAL IN HOURS</span>
          </div>
          <div className="panel-body">
            {shownSubjects.length === 0 && <p className="empty" style={{ padding: 0 }}>Add a subject below to start tracking.</p>}
            {shownSubjects.map((s, i) => {
              const done = week.filter((x) => x.subject === s).reduce((a, x) => a + x.minutes, 0);
              const goal = study?.goals[s] ?? 0;
              const pct = goal ? Math.min(100, (done / goal) * 100) : 0;
              return (
                <div key={s} className="limit">
                  <div className="limit-head">
                    <span>{s.toUpperCase()}</span>
                    <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      {hm(done)} /
                      <input
                        type="number"
                        min={0}
                        max={80}
                        step={0.5}
                        className="goal-input"
                        value={goal ? goal / 60 : ""}
                        placeholder="–"
                        onChange={(e) => {
                          const h = Number(e.target.value);
                          update("study", (st) => ({ ...st, goals: { ...st.goals, [s]: h > 0 ? Math.round(h * 60) : 0 } }));
                        }}
                        aria-label={`Weekly goal for ${s}, hours`}
                      />
                      H
                    </span>
                  </div>
                  <div className="meter">
                    <span style={{ width: `${goal ? pct : done ? 100 : 0}%`, background: goal && pct >= 100 ? "var(--teal)" : COLORS[i % COLORS.length] }} />
                  </div>
                </div>
              );
            })}
            <form
              className="filters"
              onSubmit={(e) => {
                e.preventDefault();
                const n = newSubject.trim().slice(0, 40);
                if (n && !subjects.includes(n)) update("study", (st) => ({ ...st, subjects: [...st.subjects, n] }));
                setNewSubject("");
              }}
            >
              <input className="search" placeholder="Add a subject (e.g. LSAT, Spanish)..." value={newSubject} onChange={(e) => setNewSubject(e.target.value)} aria-label="New subject" />
              <button type="submit">ADD</button>
            </form>
          </div>
        </section>
      </div>

      <div className="grid">
        <section className="panel">
          <div className="panel-head">
            <h2>LAST 14 DAYS</h2>
            <span className="aside">{hm(last14.reduce((a, k) => a + (byDay.get(k) ?? 0), 0))} TOTAL</span>
          </div>
          <div className="panel-body">
            <div className="bars tall" role="img" aria-label="Minutes studied per day, last 14 days">
              {last14.map((k) => (
                <div key={k} title={`${dayName(k, { weekday: "short", month: "short", day: "numeric" })}: ${hm(byDay.get(k) ?? 0)}`} style={{ height: `${((byDay.get(k) ?? 0) / max14) * 100}%` }} />
              ))}
            </div>
            <div className="row-meta" style={{ display: "flex", justifyContent: "space-between" }}>
              <span>{dayName(last14[0], { month: "short", day: "numeric" }).toUpperCase()}</span>
              <span>TODAY</span>
            </div>
          </div>
        </section>
        <section className="panel">
          <div className="panel-head">
            <h2>RECENT SESSIONS</h2>
            <span className="aside">{sessions.length}</span>
          </div>
          {sessions.length === 0 && <p className="empty">{life ? "No sessions yet. Start the timer or log one." : "Loading..."}</p>}
          {sessions
            .slice()
            .sort((a, b) => b.date.localeCompare(a.date))
            .slice(0, 12)
            .map((s) => (
              <div key={s.id} className="row">
                <span className="when mono">{s.date === today ? "TODAY" : dayName(s.date, { month: "short", day: "numeric" }).toUpperCase()}</span>
                <span className="row-main">
                  <span className="row-title">{s.subject}</span>
                </span>
                <span className="mono" style={{ fontSize: 12 }}>
                  {hm(s.minutes)}
                </span>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => update("study", (st) => ({ ...st, sessions: st.sessions.filter((x) => x.id !== s.id) }))}
                  aria-label="Remove session"
                >
                  ×
                </button>
              </div>
            ))}
        </section>
      </div>
    </>
  );
}
