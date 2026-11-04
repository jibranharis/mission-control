import type { ClaudeSnapshot, DashboardData, GymDay, SourceStatus, TaskItem, UpdateItem } from "@/lib/types";
import { SAMPLE_DATA, demoCalendar, demoCanvas, demoClaude, demoMail, emptyCalendar, emptyCanvas, emptyClaude } from "@/lib/demo";
import { accountStatuses, calendarData, fetchCalendar, googleClientConfigured, listAccounts } from "@/lib/sources/google";
import { claudeConfigured, fetchMail } from "@/lib/mail";
import { fetchCanvas } from "@/lib/sources/canvas";
import { fetchGitHub } from "@/lib/sources/github";
import { mergeProjects } from "@/lib/claude";
import { getJSON, KEYS } from "@/lib/store";
import { GYM_KEY, normalizeGym, planGym, type GymData } from "@/lib/gym";
import { DOCKET_PREFIX, docketBlocks, docketCalendar, type DocketView } from "@/lib/sources/docket";
import { TIMEZONE, dateKey, isToday, startOfDay } from "@/lib/time";
import { buildOps } from "@/lib/ops";
import { DEFAULT_PROJECTS, LIFE_KEYS, type LifeProject, type PlanBlock } from "@/lib/life";

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
  const googleConfigured = googleClientConfigured && (await listAccounts()).some((a) => !a.needsReconnect);
  // Google Calendar directly when an account is connected (with Docket's class schedule on top),
  // otherwise the calendar and schedule Docket's sync carried over.
  const loadCalendar = googleConfigured
    ? async () => {
        const g = await fetchCalendar().catch((err) => {
          if (!docket) throw err;
          console.error(err);
          return null;
        });
        if (!docket) return g;
        if (!g) return docketCalendar(docket);
        return calendarData([...(g.events ?? []), ...docketBlocks(docket)].sort((a, b) => a.start.localeCompare(b.start)));
      }
    : async () => (docket ? docketCalendar(docket) : null);
  const [calendar, gmail, canvas, claude, todos, done, notes, github, ops] = await Promise.all([
    resolve(googleConfigured || Boolean(docket), loadCalendar, emptyCalendar, demoCalendar),
    resolve(googleConfigured, fetchMail, () => [], () => []),
    resolve(true, async () => (await fetchCanvas())?.data ?? null, emptyCanvas, demoCanvas),
    resolve(true, () => getJSON<ClaudeSnapshot | null>(KEYS.claude, null), emptyClaude, demoClaude),
    getJSON<Todo[]>(KEYS.todos, []),
    getJSON<Record<string, string>>(KEYS.done, {}),
    getJSON<string>(KEYS.notes, ""),
    fetchGitHub(),
    buildOps(),
  ]);
  // Read after the syncs so each account carries what went wrong just now.
  const accounts = await accountStatuses();

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
  // Claude sessions waiting on you have their own block at the top of Today, so they aren't repeated here.
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
  // Sign-ins that broke come first: every automation behind them is stuck until they're redone.
  for (const l of ops.logins.filter((l) => l.needsYou && l.status !== "unchecked")) {
    tasks.push({
      id: `login:${l.id}`,
      title: `Sign back in to ${l.name}`,
      meta: `RE-LOGIN NEEDED${l.usedBy.length ? ` · BLOCKS ${l.usedBy.length} AUTOMATION${l.usedBy.length > 1 ? "S" : ""}` : ""}`,
      source: "LOGIN",
      dueToday: true,
      done: false,
      url: l.loginUrl,
    });
  }
  // Accounts no check has confirmed yet: one to-do for all of them (each is listed on the Logins tab).
  const unconfirmed = ops.logins.filter((l) => l.status === "unchecked");
  if (unconfirmed.length) {
    tasks.push({
      id: "login-unconfirmed",
      title: unconfirmed.length === 1 ? `Log in to ${unconfirmed[0].name}` : `Log in to ${unconfirmed.length} accounts`,
      meta: `NOT LOGGED IN · ${unconfirmed.map((l) => l.name.replace(/ \(.*\)$/, "")).join(", ").toUpperCase()}`,
      source: "LOGIN",
      dueToday: true,
      done: false,
      url: "#logins",
    });
  }
  const gymPlan = normalizeGym(await getJSON<Partial<GymData> | null>(GYM_KEY, null));
  const todayKey = dateKey(startOfDay(0));
  const gym: GymDay[] = planGym(gymPlan, dateKey(startOfDay(-1)), dateKey(startOfDay(5)), todayKey).map((p) => ({
    date: p.date,
    split: p.day?.name ?? (p.status === "rest" ? "Rest" : "—"),
    status: p.status,
  }));

  // Today's lift, from the split's rotation. Checking it off logs the workout.
  const lift = gym.find((g) => g.date === todayKey);
  if (lift && (lift.status === "today" || lift.status === "done")) {
    tasks.push({
      id: `gym:${todayKey}`,
      title: `Lift: ${lift.split}`,
      meta: gymPlan.split.find((d) => d.name === lift.split)?.focus.toUpperCase() ?? "GYM",
      source: "GYM",
      dueToday: true,
      done: lift.status === "done",
    });
  }
  // Anything moved onto today in the Plan tab. When it's already on the list (an assignment due today), it isn't repeated.
  const [plan, projects] = await Promise.all([getJSON<PlanBlock[]>(LIFE_KEYS.plan, []), getJSON<LifeProject[]>(LIFE_KEYS.projects, DEFAULT_PROJECTS)]);
  const projectTask = (ref: string) => {
    const [, pid, tid] = ref.split(":");
    return projects.find((p) => p.id === pid)?.tasks.find((t) => t.id === tid);
  };
  const listed = new Set(tasks.map((t) => t.id));
  for (const b of plan) {
    if (b.date !== todayKey || (b.ref && listed.has(b.ref))) continue;
    const refDone = b.ref ? (b.ref.startsWith("project:") ? projectTask(b.ref)?.done : Boolean(done[b.ref])) : false;
    const [h, m] = (b.time ?? "").split(":").map(Number);
    const at = Number.isFinite(h) && Number.isFinite(m) ? new Date(startOfDay(0).getTime() + (h * 60 + m) * 60_000).toISOString() : undefined;
    tasks.push({
      id: `plan:${b.id}`,
      title: b.title,
      meta: `PLANNED TODAY${at ? ` · ${timeFmt(at).toUpperCase()}` : ""}${b.minutes ? ` · ${b.minutes}M` : ""}`,
      source: "PLAN",
      due: at,
      dueToday: true,
      done: b.done || Boolean(refDone),
    });
  }
  const first = (t: TaskItem) => (t.source === "LOGIN" ? 0 : 1);
  tasks.sort((a, b) => Number(a.done) - Number(b.done) || first(a) - first(b) || (a.due ?? "9").localeCompare(b.due ?? "9"));

  const updates: UpdateItem[] = [...canvas.data.updates, ...claude.data.updates]
    .filter((u) => Date.now() - new Date(u.at).getTime() < 2 * 86_400_000)
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 12);

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
    mail:
      SAMPLE_DATA && !accounts.length
        ? demoMail()
        : { alerts: gmail.data, accounts, canConnect: googleClientConfigured, claude: claudeConfigured },
    canvas: canvas.data,
    claude: claude.data,
    updates,
    gym,
    gymPlan,
    notes,
    ops,
  };
}
