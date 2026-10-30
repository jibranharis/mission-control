"use client";

import { useEffect, useMemo, useState } from "react";
import { DOCKET_PREFIX, eventsOn, type DocketItem, type DocketView } from "@/lib/sources/docket";
import { PRAYERS, PRAYER_ORDER, hijri, methodName, prayerTimes, upcomingOccasions } from "@/lib/deen";

type Toggle = (id: string, done: boolean) => void;

const COURSE_COLORS = ["var(--blue)", "var(--amber)", "var(--teal)", "var(--silver)"];
const KIND_LABEL: Record<string, string> = { homework: "HW", quiz: "QUIZ", exam: "EXAM", lab: "LAB", class: "SESSION", task: "TASK" };

function useFmt(tz: string) {
  return useMemo(() => {
    const f = (d: Date | string, opts: Intl.DateTimeFormatOptions) => new Date(d).toLocaleString("en-US", { timeZone: tz, ...opts });
    const key = (d: Date | string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(d));
    const time = (d: Date | string) => f(d, { hour: "numeric", minute: "2-digit" }).replace(" ", "").toLowerCase();
    return { f, key, time };
  }, [tz]);
}

const addDays = (key: string, n: number) => {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const dayName = (key: string, opts: Intl.DateTimeFormatOptions) => new Date(`${key}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", ...opts });

/** Keeps Docket's course hues (blue, orange, green) but in this palette. */
function courseColor(v: DocketView, id?: string | null) {
  const c = id ? v.courses[id] : undefined;
  if (!c || !id) return "var(--dim)";
  const m = c.color?.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (m) {
    const [r, g, b] = m.slice(1).map((x) => parseInt(x, 16));
    if (b > r && b > g) return "var(--blue)";
    if (g >= r && g >= b) return "var(--teal)";
    return "var(--amber)";
  }
  return COURSE_COLORS[Object.keys(v.courses).indexOf(id) % COURSE_COLORS.length];
}
const courseCode = (v: DocketView, i: DocketItem) => (i.course ? v.courses[i.course]?.code ?? i.course.toUpperCase() : i.source === "Clubs" ? "CLUBS" : "LIFE");

/** Items and Docket tasks as one list; task ids are prefixed so check-offs don't collide. */
function allWork(v: DocketView): (DocketItem & { doneId: string; isTask?: boolean })[] {
  return [
    ...v.items.filter((i) => i.status !== "skipped").map((i) => ({ ...i, doneId: `${DOCKET_PREFIX}${i.id}` })),
    ...(v.tasks ?? []).map((t) => ({ ...t, kind: "task", isTask: true, doneId: `${DOCKET_PREFIX}task:${t.id}` })),
  ];
}

export function NoDocket({ what }: { what: string }) {
  return (
    <section className="panel">
      <p className="empty">
        {what} come from Docket. They show up here after Docket&apos;s next sync sends them over (6 AM, 12 PM and 9:30 PM).
      </p>
    </section>
  );
}

function OpenInDocket({ v, view }: { v: DocketView; view: string }) {
  if (!v.url) return null;
  return (
    <a className="btn" href={`${v.url}#${view}`} target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center" }}>
      OPEN IN DOCKET ↗
    </a>
  );
}

function SyncedNote({ v, tz }: { v: DocketView; tz: string }) {
  const { f } = useFmt(tz);
  const at = v.syncedAt ?? v.receivedAt;
  return <span className="row-meta">FROM DOCKET · SYNCED {f(at, { weekday: "short", hour: "numeric", minute: "2-digit" }).toUpperCase()}</span>;
}

/* ---------- Exams ahead (shown on Today) ---------- */

export function ExamsStrip({ v, tz, now }: { v: DocketView; tz: string; now: Date | null }) {
  const { f, key } = useFmt(tz);
  if (!now) return null;
  const today = key(now);
  const exams = v.items
    .filter((i) => i.kind === "exam" && i.due && i.status !== "skipped" && key(i.start ?? i.due) >= today)
    .sort((a, b) => (a.start ?? a.due!).localeCompare(b.start ?? b.due!))
    .slice(0, 6);
  if (!exams.length) return null;
  return (
    <section className="panel" aria-labelledby="exams-title">
      <div className="panel-head">
        <h2 id="exams-title">EXAMS AHEAD</h2>
        <SyncedNote v={v} tz={tz} />
      </div>
      <div className="exams">
        {exams.map((e) => {
          const at = e.start ?? e.due!;
          const days = Math.round((new Date(`${key(at)}T12:00:00Z`).getTime() - new Date(`${today}T12:00:00Z`).getTime()) / 864e5);
          return (
            <a key={e.id} className="exam" href={e.url} target="_blank" rel="noreferrer" style={{ borderTopColor: courseColor(v, e.course) }}>
              <span className="exam-days">
                {days}
                <small>{days === 1 ? "DAY" : "DAYS"}</small>
              </span>
              <span className="exam-name">
                <span style={{ color: courseColor(v, e.course) }}>{courseCode(v, e)}</span> · {e.title}
              </span>
              <span className="row-meta">{f(at, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).toUpperCase()}</span>
            </a>
          );
        })}
      </div>
    </section>
  );
}

/* ---------- Courses ---------- */

export function CoursesView({ v, tz, now }: { v: DocketView; tz: string; now: Date | null }) {
  const { f } = useFmt(tz);
  return (
    <>
      <div className="view-head">
        <h1>Courses</h1>
        <OpenInDocket v={v} view="courses" />
      </div>
      <div className="grid">
        {Object.entries(v.courses).map(([id, c]) => {
          const color = courseColor(v, id);
          const next = v.items
            .filter((i) => i.course === id && i.due && i.status === "todo" && (!now || new Date(i.due).getTime() > now.getTime()))
            .sort((a, b) => a.due!.localeCompare(b.due!))
            .slice(0, 4);
          return (
            <section key={id} className="panel course" style={{ borderTopColor: color }}>
              <div className="panel-body">
                <div>
                  <span className="mono" style={{ color, fontSize: 12 }}>
                    {c.code}
                    {c.section ? ` · ${c.section}` : ""}
                  </span>
                  <h2 className="course-name">{c.name ?? c.code}</h2>
                  {c.instructor && <p className="course-who">{c.instructor}</p>}
                </div>
                <dl className="kv">
                  {(
                    [
                      ["LECTURE", c.lecture],
                      ["DISCUSSION", c.discussion],
                      ["LAB", c.lab],
                      ["OFFICE HRS", c.officeHours],
                      ["TEXT", c.textbook],
                    ] as [string, string | undefined][]
                  )
                    .filter(([, val]) => val)
                    .map(([k, val]) => (
                      <div key={k}>
                        <dt>{k}</dt>
                        <dd>{val}</dd>
                      </div>
                    ))}
                </dl>
                {c.grading && c.grading.length > 0 && (
                  <div>
                    <span className="label">GRADING</span>
                    {c.grading.every(([, w]) => typeof w === "number") && (
                      <div className="grading-bar">
                        {c.grading.map(([label, w], i) => (
                          <span key={label} title={`${label}: ${w}%`} style={{ flex: w ?? 0, background: color, opacity: 1 - i * 0.12 }} />
                        ))}
                      </div>
                    )}
                    <p className="row-meta" style={{ marginTop: 8, lineHeight: 1.6 }}>
                      {c.grading.map(([label, w]) => (typeof w === "number" ? `${label} ${w}%` : label)).join(" · ")}
                    </p>
                  </div>
                )}
                {next.length > 0 && (
                  <div>
                    <span className="label">NEXT UP</span>
                    {next.map((i) => (
                      <a key={i.id} className="mini-row" href={i.url} target="_blank" rel="noreferrer">
                        <span>{i.title}</span>
                        <span className="row-meta">{f(i.due!, { weekday: "short", month: "short", day: "numeric" }).toUpperCase()}</span>
                      </a>
                    ))}
                  </div>
                )}
                {c.rules && c.rules.length > 0 && (
                  <details>
                    <summary className="label">RULES</summary>
                    <ul className="rules">
                      {c.rules.map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
                  </details>
                )}
                {c.links && c.links.length > 0 && (
                  <div className="links">
                    {c.links.map(([label, href]) => (
                      <a key={href} href={href} target="_blank" rel="noreferrer">
                        {label}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}

/* ---------- Week ---------- */

export function WeekView({ v, tz, now, onToggle }: { v: DocketView; tz: string; now: Date | null; onToggle: Toggle }) {
  const { f, key, time } = useFmt(tz);
  const [offset, setOffset] = useState(0);
  const [routine, setRoutine] = useState(false);
  const today = now ? key(now) : key(new Date());
  const monday = addDays(today, -((new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7) + offset * 7);
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const work = allWork(v);

  return (
    <>
      <div className="view-head">
        <h1>Week</h1>
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
          <button type="button" onClick={() => setRoutine(!routine)} aria-pressed={routine}>
            ROUTINE
          </button>
        </div>
      </div>
      <div className="week-grid">
        {days.map((k) => {
          const hol = (v.holidays ?? []).filter((h) => h.date === k);
          const events = eventsOn(v, k).filter((e) => routine || !e.routine);
          const due = work.filter((i) => i.due && key(i.due) === k && i.kind !== "class");
          return (
            <section key={k} className={`panel day${k === today ? " today" : ""}`}>
              <div className="day-head">
                <span>{dayName(k, { weekday: "short" }).toUpperCase()}</span>
                <span className="mono">{dayName(k, { day: "numeric" })}</span>
              </div>
              {hol.map((h) => (
                <div key={h.title} className="hol">
                  {h.title}
                </div>
              ))}
              {events.map((e) => (
                <div key={e.id} className="ev" style={{ borderLeftColor: e.kind === "class" ? "var(--blue-soft)" : e.kind === "gym" ? "var(--teal)" : "var(--silver)" }}>
                  <span className="ev-title">{e.title}</span>
                  <span className="row-meta">
                    {e.allDay ? "ALL DAY" : time(e.start)}
                    {e.location ? ` · ${e.location}` : ""}
                  </span>
                </div>
              ))}
              {due.map((i) => (
                <label key={i.doneId} className={`ev due${i.status === "done" ? " done" : ""}`} style={{ borderLeftColor: courseColor(v, i.course) }}>
                  <span className="ev-title">
                    <input type="checkbox" checked={i.status === "done"} onChange={(e) => onToggle(i.doneId, e.target.checked)} />
                    {i.title}
                  </span>
                  <span className="row-meta">
                    DUE {time(i.due!)} · {courseCode(v, i)}
                  </span>
                </label>
              ))}
              {!hol.length && !events.length && !due.length && <p className="day-empty">CLEAR</p>}
            </section>
          );
        })}
      </div>
      <p className="footnote">
        WEEK OF {f(`${monday}T12:00:00Z`, { month: "long", day: "numeric" }).toUpperCase()} · CLASSES, CALENDAR AND DUE DATES FROM DOCKET
      </p>
    </>
  );
}

/* ---------- Work ---------- */

export function WorkView({ v, tz, now, onToggle }: { v: DocketView; tz: string; now: Date | null; onToggle: Toggle }) {
  const { f, key, time } = useFmt(tz);
  const [course, setCourse] = useState("all");
  const [status, setStatus] = useState<"open" | "done" | "all">("open");
  const today = now ? key(now) : key(new Date());
  const rows = allWork(v)
    .filter((i) => i.due && i.kind !== "class")
    .filter((i) => course === "all" || (course === "life" ? !i.course : i.course === course))
    .filter((i) => status === "all" || (status === "done" ? i.status === "done" : i.status !== "done"))
    .sort((a, b) => (status === "done" ? b.due!.localeCompare(a.due!) : a.due!.localeCompare(b.due!)));

  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const k = status !== "done" && key(r.due!) < today ? "overdue" : key(r.due!);
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }

  return (
    <>
      <div className="view-head">
        <h1>Work</h1>
        <OpenInDocket v={v} view="work" />
      </div>
      <div className="filters">
        {[["all", "ALL"], ...Object.entries(v.courses).map(([id, c]) => [id, c.code]), ["life", "LIFE"]].map(([id, label]) => (
          <button key={id} type="button" aria-pressed={course === id} onClick={() => setCourse(id)}>
            {label}
          </button>
        ))}
        <span className="filter-gap" />
        {(["open", "done", "all"] as const).map((s) => (
          <button key={s} type="button" aria-pressed={status === s} onClick={() => setStatus(s)}>
            {s.toUpperCase()}
          </button>
        ))}
      </div>
      <section className="panel">
        {rows.length === 0 && <p className="empty">Nothing here.</p>}
        {[...groups].map(([k, items]) => (
          <div key={k}>
            <div className={`group-head${k === today ? " today" : k === "overdue" ? " overdue" : ""}`}>
              <span>{k === "overdue" ? "OVERDUE" : k === today ? "TODAY" : dayName(k, { weekday: "long", month: "short", day: "numeric" }).toUpperCase()}</span>
              <span>{items.length}</span>
            </div>
            {items.map((i) => (
              <label key={i.doneId} className={`row${i.status === "done" ? " done" : ""}`}>
                <input type="checkbox" checked={i.status === "done"} onChange={(e) => onToggle(i.doneId, e.target.checked)} />
                <span className="when mono" style={{ color: k === "overdue" ? "var(--amber)" : "var(--text-2)" }}>
                  {k === "overdue" ? f(i.due!, { month: "short", day: "numeric" }).toUpperCase() : time(i.due!)}
                </span>
                <span className="row-main">
                  <span className="row-title">{i.title}</span>
                  <span className="row-meta">
                    <span style={{ color: courseColor(v, i.course) }}>{courseCode(v, i)}</span> · {KIND_LABEL[i.kind ?? ""] ?? (i.kind ?? "").toUpperCase()}
                    {i.source && !i.isTask ? ` · ${i.source.toUpperCase()}` : ""}
                    {i.pts ? ` · ${i.pts} PTS` : ""}
                  </span>
                  {i.note && <span className="row-note">{i.note}</span>}
                </span>
                {i.url && (
                  <a className="row-link" href={i.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                    OPEN ↗
                  </a>
                )}
              </label>
            ))}
          </div>
        ))}
      </section>
    </>
  );
}

/* ---------- Deen ---------- */

export function DeenView({ v, tz, now }: { v: DocketView | null; tz: string; now: Date | null }) {
  const { f, key, time } = useFmt(tz);
  const method = v?.deen?.method ?? "jafari";
  const offset = v?.deen?.hijriOffset ?? 0;
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  if (!now) return null;
  void tick;
  const today = key(now);
  const pt = prayerTimes(today, tz, method);
  const h = hijri(today, offset);
  const nextId = PRAYERS.find((p) => pt[p] > now);
  const next = nextId ? { id: nextId, at: pt[nextId] } : { id: "fajr" as const, at: prayerTimes(addDays(today, 1), tz, method).fajr };
  const current = [...PRAYER_ORDER].reverse().find(([id]) => pt[id] <= now)?.[0];
  const mins = Math.max(0, Math.round((next.at.getTime() - now.getTime()) / 60000));
  const occasions = upcomingOccasions(today, 60, offset);
  const name = PRAYER_ORDER.find(([id]) => id === next.id)![1];

  return (
    <>
      <div className="view-head">
        <h1>Deen</h1>
        {v && <OpenInDocket v={v} view="deen" />}
      </div>
      <div className="grid">
        <section className="panel">
          <div className="panel-head">
            <h2>NEXT PRAYER</h2>
            <span className="aside">
              {h.d} {h.name.toUpperCase()} {h.y}
            </span>
          </div>
          <div className="panel-body">
            <div className="next-prayer">
              <span className="np-name">{name}</span>
              <span className="np-in mono">
                IN {Math.floor(mins / 60) ? `${Math.floor(mins / 60)}H ` : ""}
                {mins % 60}M · {time(next.at).toUpperCase()}
              </span>
            </div>
            <div className="ptimes">
              {PRAYER_ORDER.map(([id, label]) => (
                <div key={id} className={`pt${id === current ? " now" : ""}${id === next.id ? " next" : ""}`}>
                  <span>{label.toUpperCase()}</span>
                  <b className="mono">{time(pt[id])}</b>
                </div>
              ))}
            </div>
            <p className="row-meta">{methodName(method).toUpperCase()} · DAVIS, CA</p>
          </div>
        </section>
        <section className="panel">
          <div className="panel-head">
            <h2>COMING UP</h2>
            <span className="aside">NEXT 60 DAYS</span>
          </div>
          {occasions.length === 0 && <p className="empty">No occasions in the next 60 days.</p>}
          {occasions.map((o) => (
            <div key={o.key + o.title} className="row">
              <span className={`when mono occ-${o.kind}`}>{o.inDays === 0 ? "TODAY" : `${o.inDays}D`}</span>
              <span className="row-main">
                <span className="row-title">{o.title}</span>
                <span className="row-meta">
                  {o.hijri.toUpperCase()} · {f(`${o.key}T12:00:00Z`, { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).toUpperCase()}
                </span>
              </span>
            </div>
          ))}
        </section>
      </div>
      <p className="footnote">PRAYER LOGS, QUR&apos;AN, DHIKR AND THE REST STAY PRIVATE IN DOCKET · OPEN IN DOCKET TO LOG</p>
    </>
  );
}

/* ---------- Notes ---------- */

export function NotesView({ v, tz }: { v: DocketView; tz: string }) {
  const { f } = useFmt(tz);
  const [q, setQ] = useState("");
  const [tag, setTag] = useState("all");
  const [open, setOpen] = useState<string | null>(null);
  const notes = (v.notes ?? []).slice().sort((a, b) => (b.updated ?? b.created ?? "").localeCompare(a.updated ?? a.created ?? ""));
  const tags = [...new Set(notes.flatMap((n) => n.tags ?? []))];
  const shown = notes.filter(
    (n) => (tag === "all" || n.tags?.includes(tag)) && (!q || `${n.title} ${n.body}`.toLowerCase().includes(q.toLowerCase())),
  );

  return (
    <>
      <div className="view-head">
        <h1>Notes</h1>
        <OpenInDocket v={v} view="notes" />
      </div>
      <div className="filters">
        <input className="search" placeholder="Search notes..." value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search notes" />
        {["all", ...tags].map((t) => (
          <button key={t} type="button" aria-pressed={tag === t} onClick={() => setTag(t)}>
            {t.toUpperCase()}
          </button>
        ))}
      </div>
      {shown.length === 0 && (
        <section className="panel">
          <p className="empty">No notes match.</p>
        </section>
      )}
      <div className="grid">
        {shown.map((n) => (
          <button key={n.id} type="button" className={`panel note-card${open === n.id ? " open" : ""}`} onClick={() => setOpen(open === n.id ? null : n.id)}>
            <span className="note-title">{n.title || "Untitled"}</span>
            <span className="note-body">{n.body}</span>
            <span className="note-meta">
              {(n.tags ?? []).map((t) => (
                <span key={t} className="badge">
                  {t}
                </span>
              ))}
              <span className="row-meta" style={{ marginLeft: "auto" }}>
                {n.updated || n.created ? f((n.updated ?? n.created)!, { weekday: "short", month: "short", day: "numeric" }).toUpperCase() : ""}
              </span>
            </span>
          </button>
        ))}
      </div>
    </>
  );
}

