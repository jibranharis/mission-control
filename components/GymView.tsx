"use client";

import { useEffect, useMemo, useState } from "react";
import type { CalendarEvent } from "@/lib/types";
import { nextLift, planGym, type GymData, type SplitDay } from "@/lib/gym";

const WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

const keyOf = (d: Date, tz: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const addDays = (key: string, n: number) => {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const dayName = (key: string, opts: Intl.DateTimeFormatOptions) =>
  new Date(`${key}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", ...opts });

export function GymView({
  plan,
  calendar,
  tz,
  now,
  onChanged,
}: {
  plan: GymData;
  calendar: CalendarEvent[];
  tz: string;
  now: Date | null;
  onChanged: () => Promise<void>;
}) {
  const [g, setG] = useState(plan);
  const [draft, setDraft] = useState<SplitDay[]>(plan.split);
  const [days, setDays] = useState(plan.days);
  const [dirty, setDirty] = useState(false);
  const [state, setState] = useState<"saved" | "saving" | "error">("saved");
  useEffect(() => {
    setG(plan);
    if (!dirty) {
      setDraft(plan.split);
      setDays(plan.days);
    }
  }, [plan, dirty]);

  const today = keyOf(now ?? new Date(), tz);
  const monday = addDays(today, -((new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7));
  const week = useMemo(() => planGym(g, monday, addDays(monday, 6), today), [g, monday, today]);
  const todayPlan = week.find((p) => p.date === today);
  const lift = nextLift(g, today);
  const loggedToday = g.log.find((l) => l.date === today);
  const [swap, setSwap] = useState<string>("");
  const shown = (swap && !loggedToday ? g.split.find((d) => d.id === swap) : null) ?? lift;

  const doneThisWeek = week.filter((p) => p.status === "done").length;
  const last30 = g.log.filter((l) => l.date > addDays(today, -30)).length;
  const upcoming = calendar
    .filter((e) => e.kind === "gym" && /gym|lift|climb|workout/i.test(e.title))
    .filter((e) => {
      const k = keyOf(new Date(e.start), tz);
      return k >= today && k <= addDays(today, 6);
    })
    .slice(0, 8);

  const log = async (date: string, done: boolean, dayId?: string) => {
    setState("saving");
    const res = await fetch("/api/gym", { method: "POST", body: JSON.stringify({ date, done, dayId }) }).catch(() => null);
    if (res?.ok) setG((await res.json()) as GymData);
    setState(res?.ok ? "saved" : "error");
    setSwap("");
    await onChanged();
  };

  const save = async () => {
    setState("saving");
    const split = draft
      .map((d) => ({ ...d, name: d.name.trim(), exercises: d.exercises.map((e) => e.trim()).filter(Boolean) }))
      .filter((d) => d.name);
    const res = await fetch("/api/gym", { method: "PUT", body: JSON.stringify({ split, days }) }).catch(() => null);
    if (res?.ok) setG((await res.json()) as GymData);
    setState(res?.ok ? "saved" : "error");
    if (res?.ok) setDirty(false);
    await onChanged();
  };

  const editDay = (id: string, patch: Partial<SplitDay>) => {
    setDraft((ds) => ds.map((d) => (d.id === id ? { ...d, ...patch } : d)));
    setDirty(true);
  };

  return (
    <>
      <div className="view-head">
        <h1>Gym</h1>
        <span className="row-meta" aria-live="polite" style={{ color: state === "error" ? "var(--amber)" : undefined }}>
          {state === "saving" ? "SAVING..." : state === "error" ? "NOT SAVED · CHECK CONNECTION" : dirty ? "UNSAVED CHANGES" : "SAVED"}
        </span>
      </div>

      <div className="stats">
        <div className="stat">
          <strong>
            {doneThisWeek}/{g.days.length}
          </strong>
          <span>LIFTS THIS WEEK</span>
        </div>
        <div className="stat">
          <strong>{last30}</strong>
          <span>LAST 30 DAYS</span>
        </div>
        <div className="stat">
          <strong>{g.split.length}</strong>
          <span>DAY SPLIT</span>
        </div>
      </div>

      <div className="grid">
        <section className="panel" aria-labelledby="lift-title">
          <div className="panel-head">
            <h2 id="lift-title">TODAY · {todayPlan?.status === "rest" && !loggedToday ? "REST DAY" : "LIFT"}</h2>
            <span className="aside">{loggedToday ? <span style={{ color: "var(--teal)" }}>LOGGED</span> : "ROTATION"}</span>
          </div>
          {shown ? (
            <div className="panel-body">
              <div>
                <div className="lift-name">{shown.name}</div>
                <span className="row-meta">{shown.focus.toUpperCase()}</span>
              </div>
              <ol className="lift-list">
                {shown.exercises.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ol>
              {todayPlan?.status === "rest" && !loggedToday && (
                <p className="row-meta">Rest day on your schedule. Log it anyway if you train, and the rotation moves on.</p>
              )}
              <div className="gym-actions">
                {loggedToday ? (
                  <button type="button" className="btn" onClick={() => log(today, false)}>
                    UNDO LOG
                  </button>
                ) : (
                  <>
                    <button type="button" className="btn btn-primary" onClick={() => log(today, true, shown.id)}>
                      LOG WORKOUT
                    </button>
                    <label className="sr-only" htmlFor="gym-swap">
                      Do a different day
                    </label>
                    <select id="gym-swap" className="gym-select" value={swap || shown.id} onChange={(e) => setSwap(e.target.value)}>
                      {g.split.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.id === lift?.id ? `${d.name} (up next)` : `Swap to ${d.name}`}
                        </option>
                      ))}
                    </select>
                  </>
                )}
              </div>
            </div>
          ) : (
            <p className="empty">Add a day to your split below.</p>
          )}
        </section>

        <section className="panel" aria-labelledby="gymweek-title">
          <div className="panel-head">
            <h2 id="gymweek-title">THIS WEEK</h2>
            <span className="aside">TAP TO LOG</span>
          </div>
          {week.map((p) => {
            const color =
              p.status === "done" ? "var(--teal)" : p.status === "today" ? "var(--amber)" : p.status === "missed" ? "var(--dim)" : "var(--muted)";
            const label = p.status === "rest" ? "REST" : p.status === "missed" ? "MISSED" : p.status.toUpperCase();
            const canLog = p.date <= today && p.status !== "rest";
            return (
              <label key={p.date} className={`row${p.status === "done" ? " done" : ""}`}>
                <input
                  type="checkbox"
                  checked={p.status === "done"}
                  disabled={!canLog}
                  onChange={(e) => log(p.date, e.target.checked, p.day?.id)}
                />
                <span className="row-main">
                  <span className="row-title">{p.day?.name ?? (p.status === "rest" ? "Rest" : "Not logged")}</span>
                  <span className="row-meta">{dayName(p.date, { weekday: "long", month: "short", day: "numeric" }).toUpperCase()}</span>
                </span>
                <span className="tag" style={{ color }}>
                  {label}
                </span>
              </label>
            );
          })}
          {upcoming.length > 0 && (
            <div className="panel-body" style={{ borderTop: "1px solid var(--line)", gap: 8 }}>
              <span className="label">ON YOUR CALENDAR</span>
              {upcoming.map((e) => (
                <span key={e.id} className="row-meta">
                  {new Date(e.start).toLocaleString("en-US", { timeZone: tz, weekday: "short", hour: "numeric", minute: "2-digit" }).toUpperCase()} ·{" "}
                  {e.title.toUpperCase()}
                  {e.location ? ` · ${e.location.toUpperCase()}` : ""}
                </span>
              ))}
            </div>
          )}
        </section>
      </div>

      <section className="panel" aria-labelledby="split-title">
        <div className="panel-head">
          <h2 id="split-title">THE SPLIT</h2>
          <span className="aside">
            <button type="button" className="btn" disabled={!dirty || state === "saving"} onClick={save} style={{ minHeight: 32 }}>
              SAVE CHANGES
            </button>
          </span>
        </div>
        <div className="panel-body">
          <div>
            <span className="label">LIFT DAYS</span>
            <div className="seg" style={{ marginTop: 8 }}>
              {WEEKDAYS.map((w, i) => (
                <button
                  key={w}
                  type="button"
                  aria-pressed={days.includes(i)}
                  onClick={() => {
                    setDays((ds) => (ds.includes(i) ? ds.filter((d) => d !== i) : [...ds, i].sort()));
                    setDirty(true);
                  }}
                >
                  {w}
                </button>
              ))}
            </div>
          </div>
          <p className="row-meta">
            The split runs in order. Each lift day gets the next one after your last logged workout, so a skipped day never skips a muscle group.
          </p>
          <div className="split-grid">
            {draft.map((d, i) => (
              <div key={d.id} className={`split-card${lift?.id === d.id && !loggedToday ? " next" : ""}`}>
                <span className="row-meta">DAY {i + 1}{lift?.id === d.id && !loggedToday ? " · UP NEXT" : ""}</span>
                <label className="sr-only" htmlFor={`name-${d.id}`}>
                  Day {i + 1} name
                </label>
                <input id={`name-${d.id}`} className="split-name" value={d.name} onChange={(e) => editDay(d.id, { name: e.target.value })} />
                <label className="sr-only" htmlFor={`focus-${d.id}`}>
                  Day {i + 1} focus
                </label>
                <input id={`focus-${d.id}`} className="split-focus" value={d.focus} onChange={(e) => editDay(d.id, { focus: e.target.value })} />
                <label className="sr-only" htmlFor={`ex-${d.id}`}>
                  Day {i + 1} exercises, one per line
                </label>
                <textarea
                  id={`ex-${d.id}`}
                  className="split-ex"
                  rows={Math.max(5, d.exercises.length + 1)}
                  value={d.exercises.join("\n")}
                  onChange={(e) => editDay(d.id, { exercises: e.target.value.split("\n") })}
                />
              </div>
            ))}
          </div>
        </div>
      </section>

      <p className="footnote">GYM AND CLIMBING EVENTS COME FROM YOUR CALENDAR · WORKOUT LOG IS SAVED IN MISSION CONTROL</p>
    </>
  );
}
