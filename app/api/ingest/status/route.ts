import { NextResponse, type NextRequest } from "next/server";
import { ingestAuthorized } from "@/lib/auth";
import { buildDashboard } from "@/lib/aggregate";
import { canvasTokenStatus } from "@/lib/sources/canvas";
import { storeIsPersistent } from "@/lib/store";

export const dynamic = "force-dynamic";

const latest = (dates: (string | null | undefined)[]) => dates.filter(Boolean).sort().pop();

/**
 * GET /api/ingest/status: a health check of every tab's data, with what
 * each source last delivered, counts and sign-in states. No mail, notes or
 * assignment text, so a check-up job can read it with the ingest token.
 */
export async function GET(req: NextRequest) {
  if (!(await ingestAuthorized(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const [d, token] = await Promise.all([buildDashboard(), canvasTokenStatus()]);
  const now = Date.now();
  const upcoming = d.canvas.assignments.filter((a) => Date.parse(a.due) >= now);
  const bySource: Record<string, number> = {};
  for (const i of d.docket?.items ?? []) bySource[i.source ?? "?"] = (bySource[i.source ?? "?"] ?? 0) + 1;
  const tasksBySource: Record<string, number> = {};
  for (const t of d.tasks) tasksBySource[t.source] = (tasksBySource[t.source] ?? 0) + 1;
  return NextResponse.json(
    {
      generatedAt: d.generatedAt,
      store: storeIsPersistent ? "redis" : "memory",
      sources: d.sources,
      docket: d.docket && {
        syncedAt: d.docket.syncedAt,
        receivedAt: d.docket.receivedAt,
        items: d.docket.items.length,
        itemsBySource: bySource,
        latestItemDue: latest(d.docket.items.map((i) => i.due)),
        tasks: d.docket.tasks?.length ?? 0,
        notes: d.docket.notes?.length ?? 0,
        calendar: d.docket.calendar?.length ?? 0,
        courses: Object.keys(d.docket.courses ?? {}),
      },
      canvas: {
        token: { set: token.set, fromEnv: token.fromEnv, user: token.user, okAt: token.okAt, error: token.error },
        assignments: d.canvas.assignments.length,
        upcoming: upcoming.length,
        nextDue: upcoming.map((a) => a.due).sort()[0],
        grades: d.canvas.grades.length,
      },
      calendar: { today: d.calendar.today.length, events: d.calendar.events?.length ?? 0, week: d.calendar.week.map((w) => w.count) },
      mail: { alerts: d.mail.alerts.length, canConnect: d.mail.canConnect, claude: d.mail.claude, accounts: d.mail.accounts },
      claude: {
        generatedAt: d.claude.generatedAt,
        usageReadAt: d.claude.usage.readAt,
        limits: d.claude.usage.limits?.length ?? 0,
        threads: d.claude.threads.length,
        projects: d.claude.projects?.length ?? 0,
        repos: d.claude.repos?.length ?? 0,
      },
      tasks: { total: d.tasks.length, bySource: tasksBySource },
      gym: d.gym,
      notesChars: d.notes.length,
      updates: d.updates.length,
      automations: d.ops.automations.map((a) => ({
        id: a.id,
        health: a.health,
        note: a.healthNote,
        lastRun: a.lastRun && { at: a.lastRun.finishedAt ?? a.lastRun.startedAt, status: a.lastRun.status, summary: a.lastRun.summary },
        nextAt: a.nextAt,
      })),
      logins: d.ops.logins.map((l) => ({ id: l.id, status: l.status, shown: l.shown, checkedAt: l.checkedAt, note: l.note })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
