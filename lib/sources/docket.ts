import type { CanvasData } from "@/lib/types";

/**
 * Docket is a separate Claude artifact whose scheduled syncs collect coursework
 * from Canvas, WebAssign, LabFlow and WeBWorK. Its syncs push a snapshot here.
 */
export interface DocketItem {
  id: string;
  course?: string | null;
  title: string;
  due?: string;
  kind?: string;
  source?: string;
  url?: string;
  pts?: number;
  status?: "todo" | "done" | "skipped";
  note?: string;
}

export interface DocketSnapshot {
  items: DocketItem[];
  tasks?: DocketItem[];
  /** Docket course ids to display codes, e.g. { mat21a: "MAT 21A" }. */
  courses?: Record<string, string>;
  announcements?: { id: string; title: string; at: string; url?: string }[];
  grades?: { course: string; score: number | null }[];
}

export const DOCKET_PREFIX = "docket:";

export function docketToCanvas(s: DocketSnapshot): CanvasData {
  const code = (c?: string | null) => (c ? s.courses?.[c] ?? c.toUpperCase() : "");
  const work = [...s.items, ...(s.tasks ?? []).map((t) => ({ ...t, id: `task:${t.id}` }))];
  return {
    assignments: work
      .filter((i) => i.due && i.status !== "skipped" && i.kind !== "class")
      .map((i) => ({
        id: `${DOCKET_PREFIX}${i.id}`,
        title: i.note ? `${i.title} (${i.note})` : i.title,
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
