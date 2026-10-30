import type { ClaudeSnapshot, DashboardData, GymDay, SourceStatus, TaskItem, UpdateItem } from "@/lib/types";
import { demoCalendar, demoCanvas, demoClaude, demoGmail } from "@/lib/demo";
import { fetchCalendar, fetchGmail, googleConfigured } from "@/lib/sources/google";
import { fetchCanvas } from "@/lib/sources/canvas";
import { getJSON, KEYS } from "@/lib/store";
import { GYM_SPLIT } from "@/lib/config";
import { TIMEZONE, dateKey, isToday, startOfDay } from "@/lib/time";

export interface Todo {
  id: string;
  title: string;
  due?: string;
  createdAt: string;
}

/** Resolves a source, falling back to demo data when it is not set up or fails. */
async function resolve<T>(
  configured: boolean,
  load: () => Promise<T | null>,
  demo: () => T,
): Promise<{ data: T; status: SourceStatus }> {
  if (!configured) return { data: demo(), status: "demo" };
  try {
    const data = await load();
    return data === null ? { data: demo(), status: "demo" } : { data, status: "live" };
  } catch (err) {
    console.error(err);
    return { data: demo(), status: "error" };
  }
}

const timeFmt = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: TIMEZONE });

export async function buildDashboard(): Promise<DashboardData> {
  const [calendar, gmail, canvas, claude, todos, done, notes] = await Promise.all([
    resolve(googleConfigured, fetchCalendar, demoCalendar),
    resolve(googleConfigured, fetchGmail, demoGmail),
    resolve(true, async () => (await fetchCanvas())?.data ?? null, demoCanvas),
    resolve(true, () => getJSON<ClaudeSnapshot | null>(KEYS.claude, null), demoClaude),
    getJSON<Todo[]>(KEYS.todos, []),
    getJSON<Record<string, string>>(KEYS.done, {}),
    getJSON<string>(KEYS.notes, ""),
  ]);

  const tomorrow = startOfDay(1).getTime();
  const tasks: TaskItem[] = [];

  for (const a of canvas.data.assignments) {
    const due = new Date(a.due).getTime();
    if (due >= tomorrow || a.submitted) continue;
    tasks.push({
      id: a.id,
      title: `${a.course ? a.course + " · " : ""}${a.title}`,
      meta: due < Date.now() ? "OVERDUE" : `DUE ${timeFmt(a.due).toUpperCase()}`,
      source: "CANVAS",
      due: a.due,
      dueToday: true,
      done: Boolean(done[a.id]),
      url: a.url,
    });
  }
  for (const e of calendar.data.today) {
    if (e.kind === "class") continue;
    tasks.push({
      id: `cal:${e.id}`,
      title: e.title,
      meta: e.allDay ? "ALL DAY" : timeFmt(e.start).toUpperCase(),
      source: "CAL",
      due: e.start,
      dueToday: true,
      done: Boolean(done[`cal:${e.id}`]),
      url: e.url,
    });
  }
  for (const t of claude.data.threads.filter((t) => t.state === "needs_you")) {
    tasks.push({
      id: `claude:${t.id}`,
      title: t.title,
      meta: `${t.project.toUpperCase()} · CLAUDE IS WAITING ON YOU`,
      source: "CLAUDE",
      dueToday: true,
      done: Boolean(done[`claude:${t.id}`]),
      url: t.url,
    });
  }
  for (const t of todos) {
    const isDone = Boolean(done[t.id]);
    // Finished to-dos drop off the list the day after they were checked.
    if (isDone && !isToday(done[t.id])) continue;
    tasks.push({
      id: t.id,
      title: t.title,
      meta: t.due ? `DUE ${new Date(t.due).toLocaleDateString("en-US", { weekday: "short", timeZone: TIMEZONE }).toUpperCase()}` : "TO-DO",
      source: "TODO",
      due: t.due,
      dueToday: !t.due || new Date(t.due).getTime() < tomorrow,
      done: isDone,
    });
  }
  tasks.sort((a, b) => Number(a.done) - Number(b.done) || (a.due ?? "9").localeCompare(b.due ?? "9"));

  const updates: UpdateItem[] = [...canvas.data.updates, ...gmail.data, ...claude.data.updates]
    .filter((u) => Date.now() - new Date(u.at).getTime() < 2 * 86_400_000)
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 12);

  const gym: GymDay[] = Array.from({ length: 7 }, (_, i) => {
    const day = startOfDay(i - 1);
    const key = dateKey(day);
    const weekday = new Date(`${key}T12:00:00Z`).getUTCDay();
    const split = GYM_SPLIT[weekday];
    const status: GymDay["status"] =
      split === "Rest" ? "rest" : done[`gym:${key}`] ? "done" : i === 1 ? "today" : i === 0 ? "missed" : "planned";
    return { date: key, split, status };
  });

  return {
    generatedAt: new Date().toISOString(),
    timezone: TIMEZONE,
    sources: { calendar: calendar.status, gmail: gmail.status, canvas: canvas.status, claude: claude.status },
    tasks,
    calendar: calendar.data,
    canvas: canvas.data,
    claude: claude.data,
    updates,
    gym,
    notes,
  };
}
