import type { CanvasData } from "@/lib/types";
import { getJSON, setJSON, KEYS } from "@/lib/store";
import { startOfDay } from "@/lib/time";
import { DOCKET_PREFIX } from "@/lib/sources/docket";

const base = (process.env.CANVAS_BASE_URL ?? "https://canvas.ucdavis.edu").replace(/\/$/, "");
const envToken = process.env.CANVAS_TOKEN;

/** A Canvas access token pasted on the Logins page, and what the last call with it said. */
export interface CanvasAuth {
  token?: string;
  savedAt?: string;
  user?: string;
  okAt?: string;
  error?: string;
  errorAt?: string;
}

export const CANVAS_AUTH_KEY = "mc:canvas:auth";

async function auth(): Promise<CanvasAuth> {
  const stored = await getJSON<CanvasAuth>(CANVAS_AUTH_KEY, {});
  return envToken ? { ...stored, token: envToken } : stored;
}

/** For the Logins page: whether the token works, without the token itself. */
export async function canvasTokenStatus(): Promise<Omit<CanvasAuth, "token"> & { set: boolean; fromEnv: boolean }> {
  const { token, ...rest } = await auth();
  return { ...rest, set: Boolean(token), fromEnv: Boolean(envToken) };
}

class CanvasAuthError extends Error {}

async function canvas<T>(token: string, path: string, params: [string, string][] = []): Promise<T> {
  const u = new URL(`${base}/api/v1${path}`);
  for (const [k, v] of params) u.searchParams.append(k, v);
  const res = await fetch(u, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  if (res.status === 401) throw new CanvasAuthError("Canvas didn't accept the access token (it may have expired or been deleted).");
  if (!res.ok) throw new Error(`canvas ${path}: ${res.status}`);
  return (await res.json()) as T;
}

/** Checks a pasted token against Canvas and saves it if it works. */
export async function saveCanvasToken(token: string): Promise<{ ok: true; user: string } | { ok: false; error: string }> {
  const t = token.trim();
  if (t.length < 20 || /\s/.test(t)) return { ok: false, error: "That doesn't look like a Canvas access token." };
  try {
    const me = await canvas<{ name?: string; short_name?: string }>(t, "/users/self");
    const user = me.short_name ?? me.name ?? "you";
    const now = new Date().toISOString();
    await setJSON(CANVAS_AUTH_KEY, { token: t, savedAt: now, user, okAt: now } satisfies CanvasAuth);
    return { ok: true, user };
  } catch (err) {
    return { ok: false, error: err instanceof CanvasAuthError ? "Canvas said that token isn't valid. Make a new one and paste it again." : "Couldn't reach Canvas. Try again in a minute." };
  }
}

export async function clearCanvasToken(): Promise<void> {
  await setJSON(CANVAS_AUTH_KEY, {});
}

interface PlannerItem {
  plannable_id: number;
  plannable_type: string;
  plannable_date: string;
  context_name?: string;
  html_url?: string;
  plannable: { title: string; points_possible?: number; assignment_id?: number };
  submissions?: { submitted?: boolean; graded?: boolean; posted_at?: string } | false;
}

interface Course {
  id: number;
  course_code: string;
  enrollments?: { type: string; computed_current_score?: number | null }[];
}

/** Pulls straight from the Canvas API using a personal access token. */
type ApiCanvas = Omit<CanvasData, "assignments"> & { assignments: (CanvasData["assignments"][number] & { canvasId?: number })[] };

async function fromApi(token: string): Promise<ApiCanvas> {
  const [items, courses] = await Promise.all([
    canvas<PlannerItem[]>(token, "/planner/items", [
      ["start_date", startOfDay(-1).toISOString()],
      ["end_date", startOfDay(14).toISOString()],
      ["per_page", "100"],
    ]),
    canvas<Course[]>(token, "/courses", [
      ["enrollment_state", "active"],
      ["include[]", "total_scores"],
      ["per_page", "50"],
    ]),
  ]);
  const work = items.filter((i) => ["assignment", "quiz", "discussion_topic"].includes(i.plannable_type));
  return {
    assignments: work.map((i) => ({
      id: `canvas:${i.plannable_type}:${i.plannable_id}`,
      canvasId: i.plannable.assignment_id ?? (i.plannable_type === "assignment" ? i.plannable_id : undefined),
      title: i.plannable.title,
      course: i.context_name ?? "",
      due: i.plannable_date,
      points: i.plannable.points_possible,
      submitted: Boolean(i.submissions && i.submissions.submitted),
      url: i.html_url ? `${base}${i.html_url}` : undefined,
    })),
    grades: courses
      .map((c) => ({
        course: c.course_code,
        score: c.enrollments?.find((e) => e.type === "student")?.computed_current_score ?? null,
      }))
      .filter((g) => g.score !== null),
    updates: work
      .filter((i) => i.submissions && i.submissions.graded && i.submissions.posted_at)
      .map((i) => ({
        id: `canvas-grade:${i.plannable_id}`,
        at: (i.submissions as { posted_at: string }).posted_at,
        source: "CANVAS" as const,
        text: `Grade posted: ${i.context_name ?? ""} ${i.plannable.title}`.trim(),
        url: i.html_url ? `${base}${i.html_url}` : undefined,
      })),
  };
}

const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Canvas straight from the API, merged with what the Docket sync pushed:
 * WebAssign, LabFlow and WeBWorK items and your own tasks only come from
 * Docket, and Canvas items Docket already knows keep their Docket id (so
 * check-offs still flow back) but take dates and submissions from the API.
 */
function merge(api: ApiCanvas, pushed: CanvasData | null): CanvasData {
  if (!pushed) return { ...api, assignments: api.assignments.map(({ canvasId: _, ...a }) => a) };
  const byId = new Map<number, CanvasData["assignments"][number]>();
  const byTitle = new Map<string, CanvasData["assignments"][number]>();
  for (const a of pushed.assignments) {
    const m = a.id.match(new RegExp(`^${DOCKET_PREFIX}canvas-(\\d+)$`));
    if (m) byId.set(Number(m[1]), a);
    byTitle.set(norm(a.title), a);
  }
  const used = new Set<string>();
  const fromApi = api.assignments.map(({ canvasId, ...a }) => {
    const d = (canvasId !== undefined && byId.get(canvasId)) || byTitle.get(norm(a.title));
    if (!d) return a;
    used.add(d.id);
    return { ...a, id: d.id, course: d.course || a.course, submitted: a.submitted || d.submitted, url: a.url ?? d.url };
  });
  // Docket's Canvas items the API didn't return are outside its window or gone; keep everything else.
  const rest = pushed.assignments.filter((a) => !used.has(a.id) && !a.id.startsWith(`${DOCKET_PREFIX}canvas-`));
  return {
    assignments: [...fromApi, ...rest],
    grades: api.grades.length ? api.grades : pushed.grades,
    updates: [...api.updates, ...pushed.updates],
  };
}

/**
 * Canvas data comes from the API when an access token is set (on the Logins
 * page or as CANVAS_TOKEN), merged with the last Docket push; otherwise from
 * the Docket push alone. A token Canvas rejects falls back to the push and
 * shows up as a login that needs you.
 */
export async function fetchCanvas(): Promise<{ data: CanvasData; live: boolean } | null> {
  const [a, pushed] = await Promise.all([auth(), getJSON<CanvasData | null>(KEYS.canvas, null)]);
  if (a.token) {
    try {
      const data = merge(await fromApi(a.token), pushed);
      if (!envToken && (!a.okAt || a.error || Date.now() - Date.parse(a.okAt) > 3600_000))
        await setJSON(CANVAS_AUTH_KEY, { ...a, okAt: new Date().toISOString(), error: undefined, errorAt: undefined });
      return { data, live: true };
    } catch (err) {
      console.error(err);
      if (err instanceof CanvasAuthError && !envToken) await setJSON(CANVAS_AUTH_KEY, { ...a, error: err.message, errorAt: new Date().toISOString() });
      if (!pushed) throw err;
    }
  }
  return pushed ? { data: pushed, live: true } : null;
}
