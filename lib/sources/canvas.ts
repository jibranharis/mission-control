import type { CanvasData } from "@/lib/types";
import { getJSON, KEYS } from "@/lib/store";
import { startOfDay } from "@/lib/time";

const base = process.env.CANVAS_BASE_URL?.replace(/\/$/, "");
const token = process.env.CANVAS_TOKEN;

export const canvasApiConfigured = Boolean(base && token);

async function canvas<T>(path: string, params: [string, string][] = []): Promise<T> {
  const u = new URL(`${base}/api/v1${path}`);
  for (const [k, v] of params) u.searchParams.append(k, v);
  const res = await fetch(u, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  if (!res.ok) throw new Error(`canvas ${path}: ${res.status}`);
  return (await res.json()) as T;
}

interface PlannerItem {
  plannable_id: number;
  plannable_type: string;
  plannable_date: string;
  context_name?: string;
  html_url?: string;
  plannable: { title: string; points_possible?: number };
  submissions?: { submitted?: boolean; graded?: boolean; posted_at?: string } | false;
}

interface Course {
  id: number;
  course_code: string;
  enrollments?: { type: string; computed_current_score?: number | null }[];
}

/** Pulls straight from the Canvas API using a personal access token. */
async function fromApi(): Promise<CanvasData> {
  const [items, courses] = await Promise.all([
    canvas<PlannerItem[]>("/planner/items", [
      ["start_date", startOfDay(-1).toISOString()],
      ["end_date", startOfDay(14).toISOString()],
      ["per_page", "100"],
    ]),
    canvas<Course[]>("/courses", [
      ["enrollment_state", "active"],
      ["include[]", "total_scores"],
      ["per_page", "50"],
    ]),
  ]);
  const work = items.filter((i) => ["assignment", "quiz", "discussion_topic"].includes(i.plannable_type));
  return {
    assignments: work.map((i) => ({
      id: `canvas:${i.plannable_type}:${i.plannable_id}`,
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

/**
 * Canvas data comes from the API when a token is set, otherwise from the
 * last snapshot an external scraper pushed to /api/ingest/canvas.
 */
export async function fetchCanvas(): Promise<{ data: CanvasData; live: boolean } | null> {
  if (canvasApiConfigured) return { data: await fromApi(), live: true };
  const pushed = await getJSON<CanvasData | null>(KEYS.canvas, null);
  return pushed ? { data: pushed, live: true } : null;
}
