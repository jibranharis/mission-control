import { getJSON, setJSON, KEYS } from "@/lib/store";
import { TIMEZONE, atLocal, dateKey, startOfDay } from "@/lib/time";

/**
 * Automations and logins. Every automated job (the Docket syncs, the Mac
 * collector, later the internship bot) reports each run here, along with the
 * accounts it is signed in to, so the dashboard can show what ran, what broke,
 * and which sign-ins need redoing.
 */

export type RunStatus = "success" | "partial" | "failure" | "running";
export type StepStatus = "ok" | "failed" | "skipped";
export type LoginStatus = "ok" | "expired" | "error" | "unchecked" | "pending";

export interface RunStep {
  name: string;
  status: StepStatus;
  note?: string;
}

export interface AutomationRun {
  id: string;
  automation: string;
  /** Display name for this particular run, e.g. "Docket morning sync". */
  name: string;
  status: RunStatus;
  startedAt: string;
  finishedAt?: string;
  summary?: string;
  steps?: RunStep[];
  url?: string;
  /** Consecutive successful runs folded into this one (frequent jobs). */
  count?: number;
  /** Recorded by the dashboard itself when data arrived, not reported by the job. */
  auto?: boolean;
}

export interface AutomationSchedule {
  /** Wall-clock times in the dashboard's zone, "HH:MM". */
  times?: string[];
  /** Runs roughly every N minutes. */
  everyMin?: number;
  /** Only runs while the Mac is awake, so a quiet stretch isn't a failure. */
  whenAwake?: boolean;
}

export interface Automation {
  id: string;
  name: string;
  description?: string;
  where?: string;
  schedule?: AutomationSchedule;
  url?: string;
}

export interface Login {
  id: string;
  name: string;
  account?: string;
  status: LoginStatus;
  checkedAt?: string;
  note?: string;
  loginUrl?: string;
  /** Plain steps for signing back in. */
  howTo?: string;
  usedBy: string[];
}

export type Health = "ok" | "failing" | "missed" | "stale" | "never";

export interface AutomationView extends Automation {
  health: Health;
  healthNote: string;
  lastRun?: AutomationRun;
  nextAt?: string;
  /** Runs in the last 7 days: successes, partials, failures. */
  week: { success: number; partial: number; failure: number };
}

export interface LoginView extends Login {
  /** Status as shown: an old check reads as stale. */
  shown: LoginStatus | "stale";
  needsYou: boolean;
}

export interface OpsView {
  automations: AutomationView[];
  runs: AutomationRun[];
  logins: LoginView[];
}

const IN_BROWSER_PANE =
  "On your Mac, open the Claude app, open its built-in browser (the globe icon), go to this site and sign in. Then come back here and press I SIGNED IN.";

/** What's known before anything reports in. Reports add to or override these. */
export const DEFAULT_AUTOMATIONS: Automation[] = [
  {
    id: "docket-sync",
    name: "Docket sync",
    description: "Reads Canvas, WebAssign, LabFlow and WeBWorK, updates Docket, then sends everything here.",
    where: "Claude scheduled task · Mac browser",
    schedule: { times: ["06:00", "12:00", "21:30"] },
    url: "https://claude.ai/code/scheduled",
  },
  {
    id: "claude-collector",
    name: "Claude collector",
    description: "Reads Claude Code transcripts and git repos on the Mac for tokens and project maps.",
    where: "Mac · every 10 min",
    schedule: { everyMin: 10, whenAwake: true },
  },
];

export const DEFAULT_LOGINS: Login[] = [
  { id: "canvas", name: "Canvas (UC Davis)", loginUrl: "https://canvas.ucdavis.edu", howTo: IN_BROWSER_PANE, usedBy: ["docket-sync"], status: "unchecked" },
  { id: "webassign", name: "WebAssign", loginUrl: "https://canvas.ucdavis.edu/courses/1111257/modules/items/2787604", howTo: `${IN_BROWSER_PANE} WebAssign opens from the CHE 2A Canvas module.`, usedBy: ["docket-sync"], status: "unchecked" },
  { id: "labflow", name: "LabFlow", loginUrl: "https://canvas.ucdavis.edu/courses/1111257/modules/items/2771448", howTo: `${IN_BROWSER_PANE} LabFlow opens from the CHE 2A Canvas module.`, usedBy: ["docket-sync"], status: "unchecked" },
  { id: "webwork", name: "WeBWorK", loginUrl: "https://canvas.ucdavis.edu/courses/1096762", howTo: `${IN_BROWSER_PANE} WeBWorK opens from the MAT 21A Canvas assignments.`, usedBy: ["docket-sync"], status: "unchecked" },
  { id: "claude", name: "claude.ai usage page", loginUrl: "https://claude.ai/settings/usage", howTo: IN_BROWSER_PANE, usedBy: ["docket-sync"], status: "unchecked" },
  { id: "google-calendar", name: "Google Calendar connector", loginUrl: "https://claude.ai/settings/connectors", howTo: "Open claude.ai, go to Settings, then Connectors, find Google Calendar and press Connect (or Reconnect).", usedBy: ["docket-sync"], status: "unchecked" },
];

const RUN_CAP = 400;
const RUN_DAYS = 30;
/** A report and the dashboard's own record of the same run land within this window. */
const MERGE_MIN = 45;
/** Back-to-back successes of a frequent job fold together when this close. */
const FOLD_MIN = 60;
/** A login check older than this reads as stale. */
const STALE_LOGIN_H = 36;

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);

const minutes = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 60000;

export interface RunReport {
  automation: string | (Partial<Automation> & { id: string });
  name?: string;
  status?: RunStatus;
  startedAt?: string;
  finishedAt?: string;
  summary?: string;
  steps?: RunStep[];
  url?: string;
  logins?: LoginReport[];
}

export interface LoginReport {
  service: string;
  name?: string;
  account?: string;
  status: LoginStatus | "needs_login";
  note?: string;
  loginUrl?: string;
  howTo?: string;
  checkedAt?: string;
}

const RUN_STATUSES: RunStatus[] = ["success", "partial", "failure", "running"];
const STEP_STATUSES: StepStatus[] = ["ok", "failed", "skipped"];
const text = (v: unknown, n: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : undefined);
const iso = (v: unknown) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : undefined);
const httpUrl = (v: unknown) => {
  const s = text(v, 500);
  return s && /^https?:\/\//.test(s) ? s : undefined;
};

/** Validates a run report from an outside job. Returns an error message, or the cleaned report. */
export function parseRunReport(b: Record<string, unknown>): RunReport | string {
  const a = b.automation;
  const automationId = typeof a === "string" ? slug(a) : a && typeof a === "object" ? slug(String((a as { id?: unknown }).id ?? "")) : "";
  if (!automationId) return "automation (an id string, or {id, name, schedule}) is required";
  const status = (b.status ?? "success") as RunStatus;
  if (!RUN_STATUSES.includes(status)) return `status must be one of ${RUN_STATUSES.join(", ")}`;
  const steps = Array.isArray(b.steps)
    ? b.steps
        .filter((s): s is Record<string, unknown> => Boolean(s) && typeof s === "object")
        .slice(0, 30)
        .map((s) => ({
          name: text(s.name, 80) ?? "Step",
          status: STEP_STATUSES.includes(s.status as StepStatus) ? (s.status as StepStatus) : "ok",
          note: text(s.note, 300),
        }))
    : undefined;
  let automation: RunReport["automation"] = automationId;
  if (a && typeof a === "object") {
    const o = a as Record<string, unknown>;
    const sch = o.schedule && typeof o.schedule === "object" ? (o.schedule as Record<string, unknown>) : undefined;
    automation = {
      id: automationId,
      name: text(o.name, 80),
      description: text(o.description, 300),
      where: text(o.where, 80),
      url: httpUrl(o.url),
      schedule: sch && {
        times: Array.isArray(sch.times) ? sch.times.filter((t): t is string => typeof t === "string" && /^\d{1,2}:\d{2}$/.test(t)).slice(0, 24) : undefined,
        everyMin: typeof sch.everyMin === "number" && sch.everyMin > 0 ? sch.everyMin : undefined,
        whenAwake: sch.whenAwake === true || undefined,
      },
    };
  }
  return {
    automation,
    name: text(b.name, 80),
    status,
    startedAt: iso(b.startedAt),
    finishedAt: iso(b.finishedAt),
    summary: text(b.summary, 600),
    steps,
    url: httpUrl(b.url),
    logins: Array.isArray(b.logins) ? (b.logins as LoginReport[]) : undefined,
  };
}

/** Saves a run. Folds repeats of frequent jobs and merges a job's report with the dashboard's own record of it. */
export async function recordRun(report: RunReport, opts: { auto?: boolean } = {}): Promise<AutomationRun> {
  const now = new Date().toISOString();
  const def = typeof report.automation === "string" ? { id: report.automation } : report.automation;
  if (Object.keys(def).length > 1) {
    const registry = await getJSON<Record<string, Automation>>(KEYS.automations, {});
    const prev = registry[def.id];
    registry[def.id] = { ...prev, ...Object.fromEntries(Object.entries(def).filter(([, v]) => v !== undefined)), name: def.name ?? prev?.name ?? def.id } as Automation;
    await setJSON(KEYS.automations, registry);
  }

  const runs = await getJSON<AutomationRun[]>(KEYS.runs, []);
  const startedAt = report.startedAt ?? report.finishedAt ?? now;
  const run: AutomationRun = {
    id: `${def.id}:${Date.parse(startedAt).toString(36)}`,
    automation: def.id,
    name: report.name ?? def.name ?? DEFAULT_AUTOMATIONS.find((a) => a.id === def.id)?.name ?? def.id,
    status: report.status ?? "success",
    startedAt,
    finishedAt: report.finishedAt ?? (report.status === "running" ? undefined : now),
    summary: report.summary,
    steps: report.steps,
    url: report.url,
    auto: opts.auto || undefined,
  };

  const i = runs.findIndex((r) => r.automation === run.automation);
  const last = i >= 0 ? runs[i] : undefined;
  let saved = run;
  if (last && minutes(last.finishedAt ?? last.startedAt, run.startedAt) < MERGE_MIN && (last.auto !== run.auto || last.status === "running")) {
    // The job's own report wins over the dashboard's record; the dashboard's adds what arrived.
    const [report_, record] = run.auto ? [last, run] : [run, last];
    saved = {
      ...record,
      ...Object.fromEntries(Object.entries(report_).filter(([, v]) => v !== undefined)),
      id: last.id,
      startedAt: last.startedAt < run.startedAt ? last.startedAt : run.startedAt,
      summary: [report_.summary, record.summary && record.summary !== report_.summary ? record.summary : undefined].filter(Boolean).join(" · ") || undefined,
      auto: undefined,
    } as AutomationRun;
    runs[i] = saved;
  } else if (
    last &&
    last.status === "success" &&
    run.status === "success" &&
    last.auto === run.auto &&
    minutes(last.finishedAt ?? last.startedAt, run.startedAt) < FOLD_MIN &&
    !run.steps?.length
  ) {
    saved = { ...last, finishedAt: run.finishedAt, summary: run.summary ?? last.summary, count: (last.count ?? 1) + 1 };
    runs[i] = saved;
  } else {
    runs.unshift(run);
  }

  const cutoff = Date.now() - RUN_DAYS * 86_400_000;
  runs.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  await setJSON(
    KEYS.runs,
    runs.filter((r) => Date.parse(r.finishedAt ?? r.startedAt) > cutoff).slice(0, RUN_CAP),
  );
  if (report.logins?.length) await recordLogins(report.logins, def.id);
  return saved;
}

/** Saves login checks. Unknown services are added. */
export async function recordLogins(reports: LoginReport[], usedBy?: string): Promise<number> {
  const logins = await getJSON<Record<string, Login>>(KEYS.logins, {});
  let n = 0;
  for (const r of reports.slice(0, 50)) {
    if (!r || typeof r !== "object") continue;
    const id = slug(String(r.service ?? ""));
    if (!id) continue;
    const status: LoginStatus = r.status === "needs_login" ? "expired" : (["ok", "expired", "error", "unchecked", "pending"] as const).includes(r.status as LoginStatus) ? (r.status as LoginStatus) : "error";
    const base = logins[id] ?? DEFAULT_LOGINS.find((l) => l.id === id) ?? { id, name: text(r.name, 80) ?? r.service, usedBy: [], status };
    logins[id] = {
      ...base,
      name: text(r.name, 80) ?? base.name,
      account: text(r.account, 120) ?? base.account,
      loginUrl: httpUrl(r.loginUrl) ?? base.loginUrl,
      howTo: text(r.howTo, 600) ?? base.howTo,
      status,
      note: text(r.note, 300),
      checkedAt: iso(r.checkedAt) ?? new Date().toISOString(),
      usedBy: usedBy && !base.usedBy.includes(usedBy) ? [...base.usedBy, usedBy] : base.usedBy,
    };
    n++;
  }
  await setJSON(KEYS.logins, logins);
  return n;
}

/** Your own actions from the Logins page: say you signed back in, or forget a login. */
export async function updateLogin(id: string, action: "signed_in" | "remove"): Promise<boolean> {
  const logins = await getJSON<Record<string, Login>>(KEYS.logins, {});
  const known = logins[id] ?? DEFAULT_LOGINS.find((l) => l.id === id);
  if (!known) return false;
  if (action === "remove") {
    delete logins[id];
    if (DEFAULT_LOGINS.some((l) => l.id === id)) logins[id] = { ...known, status: "unchecked", note: undefined, checkedAt: undefined };
  } else {
    logins[id] = { ...known, status: "pending", note: "You said you signed back in. The next run will confirm it.", checkedAt: new Date().toISOString() };
  }
  await setJSON(KEYS.logins, logins);
  return true;
}

/** The latest scheduled time at or before `now` (and the next one after it). */
function slots(times: string[], now: Date, tz: string) {
  const all = [-1, 0, 1].flatMap((d) => {
    const key = dateKey(startOfDay(d, tz, now), tz);
    return times.map((t) => atLocal(key, t.padStart(5, "0"), tz));
  });
  all.sort((a, b) => a.getTime() - b.getTime());
  const past = all.filter((d) => d <= now);
  return { prev: past[past.length - 1], next: all.find((d) => d > now) };
}

function health(a: Automation, runs: AutomationRun[], now: Date, tz: string): Pick<AutomationView, "health" | "healthNote" | "nextAt"> {
  const last = runs[0];
  const s = a.schedule ?? {};
  let nextAt: string | undefined;
  if (s.times?.length) {
    const { prev, next } = slots(s.times, now, tz);
    nextAt = next?.toISOString();
    // Scheduled runs start up to ~15 min late and take ~15 min; after 90 min a slot without a run is missed.
    if (prev && now.getTime() - prev.getTime() > 90 * 60000) {
      const ran = runs.some((r) => Date.parse(r.startedAt) >= prev.getTime() - 30 * 60000);
      if (!ran && last) return { health: "missed", healthNote: `No run came in for the ${fmtTime(prev, tz)} slot`, nextAt };
    }
  } else if (s.everyMin && last) {
    nextAt = new Date(Date.parse(last.finishedAt ?? last.startedAt) + s.everyMin * 60000).toISOString();
  }
  if (!last) return { health: "never", healthNote: "Hasn't reported a run yet", nextAt };
  if (last.status === "failure") return { health: "failing", healthNote: last.summary ?? "Last run failed", nextAt };
  if (s.everyMin) {
    const quiet = (now.getTime() - Date.parse(last.finishedAt ?? last.startedAt)) / 60000;
    if (quiet > s.everyMin * 4 + 15)
      return { health: "stale", healthNote: s.whenAwake ? "Quiet; it only runs while the Mac is awake" : "Hasn't reported in a while", nextAt };
  }
  if (last.status === "partial") return { health: "ok", healthNote: "Last run finished with some steps skipped", nextAt };
  return { health: "ok", healthNote: "Running on schedule", nextAt };
}

const fmtTime = (d: Date, tz: string) => d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz });

export async function buildOps(now = new Date(), tz = TIMEZONE): Promise<OpsView> {
  const [runs, registry, stored] = await Promise.all([
    getJSON<AutomationRun[]>(KEYS.runs, []),
    getJSON<Record<string, Automation>>(KEYS.automations, {}),
    getJSON<Record<string, Login>>(KEYS.logins, {}),
  ]);

  const defs = new Map(DEFAULT_AUTOMATIONS.map((a) => [a.id, a]));
  for (const [id, a] of Object.entries(registry)) defs.set(id, { ...defs.get(id), ...a });
  for (const r of runs) if (!defs.has(r.automation)) defs.set(r.automation, { id: r.automation, name: r.name });

  const weekAgo = now.getTime() - 7 * 86_400_000;
  const automations: AutomationView[] = [...defs.values()].map((a) => {
    const mine = runs.filter((r) => r.automation === a.id);
    const week = { success: 0, partial: 0, failure: 0 };
    for (const r of mine) if (Date.parse(r.startedAt) > weekAgo && r.status !== "running") week[r.status] += r.count ?? 1;
    return { ...a, ...health(a, mine, now, tz), lastRun: mine[0], week };
  });

  const loginMap = new Map(DEFAULT_LOGINS.map((l) => [l.id, l]));
  for (const [id, l] of Object.entries(stored)) loginMap.set(id, { ...loginMap.get(id), ...l });
  const order: Record<string, number> = { expired: 0, error: 1, stale: 2, pending: 3, unchecked: 4, ok: 5 };
  const logins: LoginView[] = [...loginMap.values()]
    .map((l) => {
      const old = l.status === "ok" && l.checkedAt && now.getTime() - Date.parse(l.checkedAt) > STALE_LOGIN_H * 3600000;
      return { ...l, shown: old ? ("stale" as const) : l.status, needsYou: l.status === "expired" || l.status === "error" };
    })
    .sort((a, b) => order[a.shown] - order[b.shown] || a.name.localeCompare(b.name));

  return { automations, runs: runs.slice(0, 150), logins };
}
