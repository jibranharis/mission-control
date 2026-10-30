import type { ClaudeSnapshot, DashboardData, GymDay, SourceStatus, TaskItem, UpdateItem } from "@/lib/types";
import { SAMPLE_DATA, demoCalendar, demoCanvas, demoClaude, demoGmail, emptyCalendar, emptyCanvas, emptyClaude } from "@/lib/demo";
import { fetchCalendar, fetchGmail, googleConfigured } from "@/lib/sources/google";
import { fetchCanvas } from "@/lib/sources/canvas";
import { fetchGitHub } from "@/lib/sources/github";
import { mergeProjects } from "@/lib/claude";
import { getJSON, KEYS } from "@/lib/store";
import { GYM_SPLIT } from "@/lib/config";
import { DOCKET_PREFIX, docketCalendar, type DocketView } from "@/lib/sources/docket";
import { TIMEZONE, dateKey, isToday, startOfDay } from "@/lib/time";

export interface Todo {
  id: string;
  title: string;
  due?: string;
  createdAt: string;
}

/**
 * Resolves a source. When it isn't set up or fails it comes back empty,
 * or as sample data if SAMPLE_DATA=1.
 */
async function resolve<T>(
  configured: boolean,
  load: () => Promise<T | null>,
  empty: () => T,
  demo: () => T,
): Promise<{ data: T; status: SourceStatus }> {
  const fallback = (status: SourceStatus) =>
    SAMPLE_DATA ? { data: demo(), status: status === "off" ? ("demo" as const) : status } : { data: empty(), status };
  if (!configured) return fallback("off");
  try {
    const data = await load();
    return data === null ? fallback("off") : { data, status: "live" };
  } catch (err) {
    console.error(err);
    return fallback("error");
  }
}

const timeFmt = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: TIMEZONE });

export async function buildDashboard(): Promise<DashboardData> {
  const docket = await getJSON<DocketView | null>(KEYS.docket, null);
  // Google Calendar directly when it's set up, otherwise the calendar and schedule Docket's sync carried over.
  const loadCalendar = googleConfigured ? fetchCalendar : async () => (docket ? docketCalendar(docket) : null);
  const [calendar, gmail, canvas, claude, todos, done, notes, github] = await Promise.all([
    resolve(googleConfigured || Boolean(docket), loadCalendar, emptyCalendar, demoCalendar),
    resolve(googleConfigured, fetchGmail, () => [], demoGmail),
    resolve(true, async () => (await fetchCanvas())?.data ?? null, emptyCanvas, demoCanvas),
    resolve(true, () => getJSON<ClaudeSnapshot | null>(KEYS.claude, null), emptyClaude, demoClaude),
    getJSON<Todo[]>(KEYS.todos, []),
    getJSON<Record<string, string>>(KEYS.done, {}),
    getJSON<string>(KEYS.notes, ""),
    fetchGitHub(),
  ]);

  // GitHub fills in repositories and projects the Mac collector hasn't sent; pushed ones win.
  if (github) {
    const pushed = new Map((claude.data.repos ?? []).map((r) => [r.fullName.toLowerCase(), r]));
    claude.data.repos = [...github.repos.filter((r) => !pushed.has(r.fullName.toLowerCase())), ...pushed.values()].sort((a, b) =>
      b.pushedAt.localeCompare(a.pushedAt),
    );
    claude.data.projects = mergeProjects(claude.data.projects, github.projects);
  }

  const tomorrow = startOfDay(1).getTime();
  const tasks: TaskItem[] = [];

  for (const a of canvas.data.assignments) {
    const due = new Date(a.due).getTime();
    if (due >= tomorrow || a.submitted || due < Date.now() - 7 * 86_400_000) continue;
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
    if (e.kind === "class" || e.routine) continue;
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

  // Items checked off here show as done right away, before the next sync tells Docket.
  const docketView: DocketView | null = docket && {
    ...docket,
    items: docket.items.map((i) => (done[`${DOCKET_PREFIX}${i.id}`] ? { ...i, status: "done" as const } : i)),
    tasks: docket.tasks?.map((t) => (done[`${DOCKET_PREFIX}task:${t.id}`] ? { ...t, status: "done" as const } : t)),
  };

  return {
    docket: docketView,
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
