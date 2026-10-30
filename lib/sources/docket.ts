import type { CalendarData, CalendarEvent, CanvasData } from "@/lib/types";
import { atLocal, dateKey, startOfDay, weekdayMon } from "@/lib/time";

/**
 * Docket is a separate Claude artifact whose scheduled syncs collect coursework
 * from Canvas, WebAssign, LabFlow and WeBWorK. Each sync pushes a snapshot of
 * its database here, and Docket stays the source of truth.
 */
export interface DocketItem {
  id: string;
  course?: string | null;
  title: string;
  due?: string;
  start?: string | null;
  kind?: string;
  source?: string;
  url?: string;
  pts?: number;
  status?: "todo" | "done" | "skipped";
  note?: string;
  location?: string | null;
}

export interface DocketCourse {
  code: string;
  /** Docket's hex color for the course; only its hue is used. */
  color?: string;
  name?: string;
  instructor?: string;
  section?: string;
  lecture?: string;
  discussion?: string;
  lab?: string;
  officeHours?: string;
  textbook?: string;
  email?: string;
  grading?: [string, number | null][];
  rules?: string[];
  links?: [string, string][];
}

/** A weekly block from Docket's schedule. `days` are Monday-first (0 = Monday). */
export interface DocketBlock {
  id: string;
  course: string | null;
  title: string;
  days: number[];
  start: string;
  end: string;
  location?: string;
}

export interface DocketNote {
  id: string;
  title?: string;
  body?: string;
  tags?: string[];
  created?: string;
  updated?: string;
}

export interface DocketEvent {
  id: string;
  title: string;
  start: string;
  end?: string;
  allDay?: boolean;
  location?: string;
}

export interface DocketSnapshot {
  /** Link to the Docket artifact, for "open in Docket" buttons. */
  url?: string;
  syncedAt?: string;
  items: DocketItem[];
  tasks?: DocketItem[];
  /** Docket course ids to course details (or just display codes). */
  courses?: Record<string, DocketCourse | string>;
  schedule?: DocketBlock[];
  holidays?: { date: string; title: string }[];
  notes?: DocketNote[];
  /** Google Calendar events for the next two weeks, as the sync read them. */
  calendar?: DocketEvent[];
  deen?: { method?: string; hijriOffset?: number };
  announcements?: { id: string; title: string; at: string; url?: string }[];
  grades?: { course: string; score: number | null }[];
}

/** The snapshot as the dashboard uses it: course details always objects. */
export interface DocketView extends Omit<DocketSnapshot, "courses"> {
  courses: Record<string, DocketCourse>;
  receivedAt: string;
}

export const DOCKET_PREFIX = "docket:";

/** Docket's own routine blocks; they stay off the day timeline's to-dos. */
export const ROUTINE = /^(Fajr|Gym|Breakfast|Morning lift|Climbing)$/;

export function toView(s: DocketSnapshot, receivedAt: string): DocketView {
  const courses: Record<string, DocketCourse> = {};
  for (const [id, c] of Object.entries(s.courses ?? {})) courses[id] = typeof c === "string" ? { code: c } : c;
  return { ...s, courses, receivedAt };
}

const isNoClassDay = (v: DocketView, key: string) =>
  (v.holidays ?? []).some((h) => h.date === key && /no class|Thanksgiving|Veterans/i.test(h.title));

/** Schedule blocks and calendar events that happen on a local date. */
export function eventsOn(v: DocketView, key: string): CalendarEvent[] {
  const noClass = isNoClassDay(v, key);
  const blocks: CalendarEvent[] = (v.schedule ?? [])
    .filter((b) => b.days.includes(weekdayMon(key)) && !(noClass && b.course))
    .map((b) => ({
      id: `${b.id}:${key}`,
      title: b.title,
      start: atLocal(key, b.start).toISOString(),
      end: atLocal(key, b.end).toISOString(),
      allDay: false,
      kind: b.course ? "class" : /gym|lift|climb/i.test(b.title) ? "gym" : "other",
      routine: ROUTINE.test(b.title),
      location: b.location || undefined,
    }));
  const cal: CalendarEvent[] = (v.calendar ?? [])
    .filter((e) => dateKey(new Date(e.start)) === key || (e.allDay && e.start.slice(0, 10) === key))
    .map((e) => ({
      id: `gcal:${e.id}`,
      title: e.title,
      start: e.start,
      end: e.end ?? e.start,
      allDay: Boolean(e.allDay),
      kind: "other",
      location: e.location || undefined,
    }));
  return [...blocks, ...cal].sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
}

/** Builds the schedule panel from Docket when Google Calendar isn't connected directly. */
export function docketCalendar(v: DocketView): CalendarData {
  const week = Array.from({ length: 7 }, (_, i) => {
    const key = dateKey(startOfDay(i));
    return { date: key, count: eventsOn(v, key).filter((e) => !e.routine).length };
  });
  return { today: eventsOn(v, dateKey(startOfDay(0))), week };
}

export function docketToCanvas(s: DocketSnapshot): CanvasData {
  const code = (c?: string | null) => {
    if (!c) return "";
    const v = s.courses?.[c];
    return typeof v === "string" ? v : v?.code ?? c.toUpperCase();
  };
  const work = [...s.items, ...(s.tasks ?? []).map((t) => ({ ...t, id: `task:${t.id}` }))];
  return {
    assignments: work
      .filter((i) => i.due && i.status !== "skipped" && i.kind !== "class")
      .map((i) => ({
        id: `${DOCKET_PREFIX}${i.id}`,
        title: i.title,
        course: code(i.course) || (i.id.startsWith("task:") ? "Task" : i.source ?? ""),
        due: i.due!,
        points: i.pts,
        submitted: i.status === "done",
        url: i.url,
      })),
    grades: s.grades ?? [],
    updates: (s.announcements ?? []).map((a) => ({
      id: `${DOCKET_PREFIX}ann:${a.id}`,
      at: a.at,
      source: "CANVAS" as const,
      text: a.title,
      url: a.url,
    })),
  };
}
