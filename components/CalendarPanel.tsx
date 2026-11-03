"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CalendarEvent, DashboardData, SourceStatus } from "@/lib/types";

type Fmt = (iso: string, opts: Intl.DateTimeFormatOptions) => string;

const EVENT_COLOR = { class: "var(--blue-soft)", gym: "var(--teal)", focus: "var(--silver)", other: "var(--amber)" };
const HOUR_PX = 52;
const MIN_PX = 24;

function SourceBadge({ status }: { status: SourceStatus }) {
  if (status === "live") return <span className="badge live">LIVE</span>;
  if (status === "error") return <span className="badge error">ERROR</span>;
  if (status === "off") return <span className="badge">NOT CONNECTED</span>;
  return <span className="badge">SAMPLE</span>;
}

/** Local date key (YYYY-MM-DD) and hour-of-day of an instant, in the dashboard's time zone. */
function useLocal(fmt: Fmt) {
  return useMemo(() => {
    const key = (iso: string) => fmt(iso, { year: "numeric", month: "2-digit", day: "2-digit" }).replace(/(\d+)\/(\d+)\/(\d+)/, "$3-$1-$2");
    const hour = (iso: string) => {
      const [h, m] = fmt(iso, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).split(":").map(Number);
      return h + m / 60;
    };
    const hm = (iso: string) => fmt(iso, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    const time = (iso: string) => fmt(iso, { hour: "numeric", minute: "2-digit" }).replace(":00", "").replace(" ", "").toLowerCase();
    return { key, hour, hm, time };
  }, [fmt]);
}

function nextDayKey(k: string) {
  return new Date(Date.parse(`${k}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}

/** Splits overlapping events into side-by-side columns. */
function layout<T extends { top: number; bottom: number }>(items: T[]): (T & { col: number; cols: number })[] {
  const sorted = [...items].sort((a, b) => a.top - b.top || b.bottom - a.bottom);
  const out: (T & { col: number; cols: number })[] = [];
  let cluster: (T & { col: number; cols: number })[] = [];
  let clusterEnd = -1;
  const flush = () => {
    const cols = Math.max(1, ...cluster.map((c) => c.col + 1));
    for (const c of cluster) c.cols = cols;
    out.push(...cluster);
    cluster = [];
  };
  for (const it of sorted) {
    if (it.top >= clusterEnd) flush();
    const used = new Set(cluster.filter((c) => c.bottom > it.top).map((c) => c.col));
    let col = 0;
    while (used.has(col)) col++;
    cluster.push({ ...it, col, cols: 1 });
    clusterEnd = Math.max(clusterEnd, it.bottom);
  }
  flush();
  return out;
}

export interface Draft {
  title: string;
  date: string;
  start: string;
  end: string;
  endDate: string;
  allDay: boolean;
  location: string;
  description: string;
  /** Set when editing an existing Google event. */
  target?: { account: string; calendarId: string; eventId: string; url?: string; recurring?: boolean; calendarName?: string };
  /** Docket or read-only calendar events open as details only. */
  readOnly?: string;
}

export function SchedulePanel({
  data,
  now,
  fmt,
  onChanged,
}: {
  data: DashboardData;
  now: Date | null;
  fmt: Fmt;
  onChanged: () => Promise<void>;
}) {
  const L = useLocal(fmt);
  const todayKey = data.calendar.week[0]?.date;
  const [day, setDay] = useState(todayKey);
  const [draft, setDraft] = useState<Draft | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const canWrite = data.mail.accounts.some((a) => a.status === "ok");

  useEffect(() => {
    if (!data.calendar.week.some((d) => d.date === day)) setDay(todayKey);
  }, [data.calendar.week, day, todayKey]);

  const all = data.calendar.events ?? data.calendar.today;
  const dayEvents = all.filter((e) =>
    e.allDay ? e.start.slice(0, 10) <= day && (e.end.slice(0, 10) > day || e.end.slice(0, 10) === e.start.slice(0, 10)) : L.key(e.start) === day,
  );
  // Prayer and meal blocks stay off the timeline; gym stays on.
  const timed = dayEvents.filter((e) => !e.allDay && (!e.routine || e.kind === "gym"));
  const allDay = dayEvents.filter((e) => e.allDay);

  const blocks = layout(
    timed.map((e) => {
      const startH = L.hour(e.start);
      const endsLater = L.key(e.end) !== day;
      const endH = endsLater ? 24 : Math.max(L.hour(e.end), startH);
      return { e, top: startH * HOUR_PX, bottom: Math.max(endH * HOUR_PX, startH * HOUR_PX + MIN_PX) };
    }),
  );

  // Open the timeline on the part of the day that matters: an hour before now, or the first event.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const first = blocks.length ? Math.min(...blocks.map((b) => b.top)) : 8 * HOUR_PX;
    const nowH = now && day === todayKey ? L.hour(now.toISOString()) : null;
    const target = nowH !== null ? Math.min(nowH - 1.5, first / HOUR_PX - 0.5) : first / HOUR_PX - 0.5;
    el.scrollTop = Math.max(0, Math.min(target, 15) * HOUR_PX);
    // Only when the day changes or data first arrives, not on every clock tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day, blocks.length > 0]);

  const open = (e: CalendarEvent) => {
    const base: Draft = {
      title: e.title,
      date: e.allDay ? e.start.slice(0, 10) : L.key(e.start),
      start: e.allDay ? "09:00" : L.hm(e.start),
      end: e.allDay ? "10:00" : L.hm(e.end),
      endDate: e.allDay ? new Date(Date.parse(`${e.end.slice(0, 10)}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10) : L.key(e.start),
      allDay: e.allDay,
      location: e.location ?? "",
      description: e.description ?? "",
    };
    if (e.account && e.calendarId && e.editable) {
      setDraft({
        ...base,
        target: { account: e.account, calendarId: e.calendarId, eventId: e.id, url: e.url, recurring: e.recurring, calendarName: e.calendarName },
      });
    } else {
      setDraft({
        ...base,
        readOnly: e.account
          ? `On ${e.calendarName ?? "a calendar"} you can only view.`
          : "From your class schedule in Docket. Change it there.",
        target: e.url ? { account: "", calendarId: "", eventId: "", url: e.url } : undefined,
      });
    }
  };

  const create = (hour?: number) => {
    const h = hour ?? (now && day === todayKey ? Math.min(Math.ceil(L.hour(now.toISOString())), 22) : 9);
    const pad = (n: number) => String(n).padStart(2, "0");
    setDraft({ title: "", date: day, start: `${pad(h)}:00`, end: `${pad(Math.min(h + 1, 23))}:${h + 1 > 23 ? "59" : "00"}`, endDate: day, allDay: false, location: "", description: "" });
  };

  const nowTop = now && day === todayKey ? L.hour(now.toISOString()) * HOUR_PX : null;
  const hours = Array.from({ length: 24 }, (_, h) => h);

  return (
    <section className="panel" aria-labelledby="schedule-title">
      <div className="panel-head">
        <h2 id="schedule-title">02 · SCHEDULE</h2>
        <span className="aside">
          {canWrite && (
            <button className="mini-btn" type="button" onClick={() => create()}>
              + EVENT
            </button>
          )}
          GOOGLE CALENDAR <SourceBadge status={data.sources.calendar} />
        </span>
      </div>
      <div className="week" role="tablist" aria-label="Day">
        {data.calendar.week.map((d) => {
          const date = new Date(`${d.date}T12:00:00Z`);
          return (
            <button
              key={d.date}
              type="button"
              role="tab"
              aria-selected={d.date === day}
              className={`week-day${d.date === todayKey ? " is-today" : ""}${d.date === day ? " today" : ""}`}
              onClick={() => setDay(d.date)}
            >
              <span className="dow">{date.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }).toUpperCase()}</span>
              <span className="num">{date.getUTCDate()}</span>
              <span className={`load${d.count >= 4 ? " heavy" : ""}`}>{d.count ? `${d.count} EVT` : "CLEAR"}</span>
            </button>
          );
        })}
      </div>
      {allDay.length > 0 && (
        <div className="allday">
          {allDay.map((e) => (
            <button key={`${e.id}${e.start}`} type="button" className="allday-chip" onClick={() => open(e)} style={{ borderLeftColor: EVENT_COLOR[e.kind] }}>
              {e.title}
            </button>
          ))}
        </div>
      )}
      {data.sources.calendar === "off" && <p className="empty">Google Calendar isn&apos;t connected yet. Connect it from the Inbox tab.</p>}
      <div className="sched-scroll" ref={scroller}>
        <div
          className="sched-grid"
          style={{ height: 24 * HOUR_PX }}
          onClick={(ev) => {
            if (!canWrite || ev.target !== ev.currentTarget) return;
            const y = ev.clientY - ev.currentTarget.getBoundingClientRect().top;
            create(Math.min(23, Math.floor(y / HOUR_PX)));
          }}
        >
          {hours.map((h) => (
            <div key={h} className="sched-hour" style={{ top: h * HOUR_PX }}>
              <span>{h === 0 ? "" : `${h % 12 || 12}${h < 12 ? "AM" : "PM"}`}</span>
            </div>
          ))}
          {blocks.map(({ e, top, bottom, col, cols }) => {
            const h = bottom - top;
            const range = `${L.time(e.start)} – ${L.time(e.end)}`;
            return (
              <button
                key={`${e.id}${e.start}`}
                type="button"
                className={`sev${h < 40 ? " compact" : h < 64 ? " short" : ""}${e.routine ? " routine" : ""}`}
                title={`${e.title}, ${range}${e.location ? `, ${e.location}` : ""}`}
                onClick={() => open(e)}
                style={{
                  top: top + 1,
                  height: h - 2,
                  left: `calc(${(col / cols) * 100}% + 2px)`,
                  width: `calc(${100 / cols}% - 4px)`,
                  borderLeftColor: EVENT_COLOR[e.kind],
                }}
              >
                <span className="sev-title">{e.title}</span>
                <span className="sev-time">{range}</span>
                {h >= 72 && e.location && <span className="sev-loc">{e.location}</span>}
              </button>
            );
          })}
          {nowTop !== null && <div className="now-line" style={{ top: nowTop }} aria-hidden="true" />}
        </div>
      </div>
      {draft && (
        <EventEditor
          draft={draft}
          onClose={() => setDraft(null)}
          onSaved={async () => {
            setDraft(null);
            await onChanged();
          }}
        />
      )}
    </section>
  );
}

export function EventEditor({ draft, onClose, onSaved }: { draft: Draft; onClose: () => void; onSaved: () => Promise<void> }) {
  const [d, setD] = useState(draft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const first = useRef<HTMLInputElement>(null);
  const ro = Boolean(d.readOnly);
  const editing = Boolean(d.target?.eventId);

  useEffect(() => {
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const send = async (method: "POST" | "PATCH" | "DELETE") => {
    setBusy(true);
    setError("");
    const payload =
      method === "DELETE"
        ? d.target
        : {
            ...d.target,
            title: d.title.trim(),
            date: d.date,
            start: d.start,
            end: d.end,
            endDate: d.allDay ? d.endDate : undefined,
            allDay: d.allDay,
            location: d.location,
            description: d.description,
          };
    const res = await fetch("/api/calendar", { method, body: JSON.stringify(payload) }).catch(() => null);
    if (!res?.ok) {
      const body = (await res?.json().catch(() => ({}))) as { error?: string } | undefined;
      setError(body?.error === "reconnect" ? "Google signed this account out. Reconnect it from the Inbox tab." : body?.error ?? "Couldn't reach Google. Try again.");
      setBusy(false);
      return;
    }
    await onSaved();
  };

  const field = (label: string, el: React.ReactNode) => (
    <label className="ed-field">
      <span>{label}</span>
      {el}
    </label>
  );

  return (
    <div className="ed-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="ed" role="dialog" aria-modal="true" aria-label={editing ? "Edit event" : ro ? "Event" : "New event"}>
        <div className="panel-head">
          <h2>{ro ? "EVENT" : editing ? "EDIT EVENT" : "NEW EVENT"}</h2>
          <button className="mini-btn" type="button" onClick={onClose} aria-label="Close">
            ESC
          </button>
        </div>
        <form
          className="ed-body"
          onSubmit={(e) => {
            e.preventDefault();
            if (!ro && d.title.trim()) send(editing ? "PATCH" : "POST");
          }}
        >
          {field("Title", <input ref={first} value={d.title} readOnly={ro} required onChange={(e) => setD({ ...d, title: e.target.value })} />)}
          <div className="ed-row">
            {field("Date", <input type="date" value={d.date} readOnly={ro} required onChange={(e) => setD({ ...d, date: e.target.value, endDate: e.target.value > d.endDate ? e.target.value : d.endDate })} />)}
            {d.allDay
              ? field("Until", <input type="date" value={d.endDate} min={d.date} readOnly={ro} onChange={(e) => setD({ ...d, endDate: e.target.value })} />)
              : (
                <>
                  {field("Start", <input type="time" value={d.start} readOnly={ro} onChange={(e) => setD({ ...d, start: e.target.value })} />)}
                  {field("End", <input type="time" value={d.end} readOnly={ro} onChange={(e) => setD({ ...d, end: e.target.value })} />)}
                </>
              )}
          </div>
          <label className="ed-check">
            <input type="checkbox" checked={d.allDay} disabled={ro} onChange={(e) => setD({ ...d, allDay: e.target.checked })} />
            All day
          </label>
          {field("Location", <input value={d.location} readOnly={ro} onChange={(e) => setD({ ...d, location: e.target.value })} />)}
          {field("Notes", <textarea rows={3} value={d.description} readOnly={ro} onChange={(e) => setD({ ...d, description: e.target.value })} />)}
          {d.readOnly && <p className="ed-note">{d.readOnly}</p>}
          {d.target?.recurring && !ro && <p className="ed-note">This is one occurrence of a repeating event. Changes apply to this day only.</p>}
          {error && <p className="ed-error">{error}</p>}
          <div className="ed-actions">
            {!ro && (
              <button className="btn btn-primary" type="submit" disabled={busy || !d.title.trim()}>
                {busy ? "SAVING..." : editing ? "SAVE" : "ADD TO CALENDAR"}
              </button>
            )}
            {editing && !ro && (
              <button
                className={`btn${confirmDelete ? " btn-danger" : ""}`}
                type="button"
                disabled={busy}
                onClick={() => (confirmDelete ? send("DELETE") : setConfirmDelete(true))}
              >
                {confirmDelete ? "CONFIRM DELETE" : "DELETE"}
              </button>
            )}
            {d.target?.url && (
              <a className="btn ed-link" href={d.target.url} target="_blank" rel="noreferrer">
                OPEN IN GOOGLE ↗
              </a>
            )}
          </div>
          {editing && d.target?.calendarName && <p className="ed-note mono">{d.target.calendarName.toUpperCase()} · {d.target.account.toUpperCase()}</p>}
        </form>
      </div>
    </div>
  );
}
