import { NextResponse, type NextRequest } from "next/server";
import { ingestAuthorized } from "@/lib/auth";
import { getJSON, setJSON, KEYS } from "@/lib/store";
import { DOCKET_PREFIX, docketToCanvas, toView, type DocketSnapshot } from "@/lib/sources/docket";
import { normalizeClaude, type ClaudePush } from "@/lib/claude";
import type { ClaudeSnapshot } from "@/lib/types";
import { recordRun } from "@/lib/ops";

export const dynamic = "force-dynamic";

const authorized = ingestAuthorized;

const list = (v: unknown) => (Array.isArray(v) ? v : []);

type History = NonNullable<ClaudeSnapshot["usage"]["history"]>;

const CLAUDE_FIELDS = ["usage", "threads", "tokens", "projects", "repos", "graph", "updates"];

async function saveClaude(push: ClaudePush) {
  const [prev, prevSnap] = await Promise.all([getJSON<History>(KEYS.usageHistory, []), getJSON<ClaudeSnapshot | null>(KEYS.claude, null)]);
  const snap = normalizeClaude(push, prev, prevSnap);
  const { session, weekly } = snap.usage;
  if (push.usage && (session || weekly)) {
    const history = [...prev, { at: snap.usage.readAt ?? snap.generatedAt, session: session?.pct, weekly: weekly?.pct }].slice(-60);
    snap.usage.history = history;
    await setJSON(KEYS.usageHistory, history);
  }
  await setJSON(KEYS.claude, snap);
}

const n = (k: number, w: string) => `${k} ${w}${k === 1 ? "" : "s"}`;

function collectorSummary(b: Record<string, unknown>) {
  const projects = list(b.projects).length;
  const sessions = list(b.threads).length;
  return [projects && `${projects} projects`, sessions && `${sessions} sessions`].filter(Boolean).join(", ") || "Sent Claude data";
}

/**
 * Lets outside jobs push snapshots in:
 *   POST /api/ingest/claude  body: ClaudePush (usage, threads, tokens, projects, repos; fields left out keep their last value)
 *   POST /api/ingest/docket  body: DocketSnapshot, plus an optional `claude` push (from the Docket sync tasks)
 *   POST /api/ingest/canvas  body: CanvasData
 *   POST /api/ingest/run     body: RunReport (see app/api/ingest/run/route.ts)
 * Each Claude and Docket push is also logged as a run on the Automations page.
 * Authenticated with `Authorization: Bearer $INGEST_TOKEN`.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ source: string }> }) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { source } = await params;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "json body required" }, { status: 400 });
  const b = body as Record<string, unknown>;

  switch (source) {
    case "claude":
      if (!CLAUDE_FIELDS.some((k) => k in b)) return NextResponse.json({ error: `expected one of ${CLAUDE_FIELDS.join(", ")}` }, { status: 422 });
      await saveClaude(b as ClaudePush);
      await recordRun({ automation: "claude-collector", summary: collectorSummary(b) }, { auto: true });
      break;
    case "docket": {
      if (!Array.isArray(b.items)) return NextResponse.json({ error: "expected items" }, { status: 422 });
      const { claude, ...docket } = b as unknown as DocketSnapshot & { claude?: ClaudePush };
      await setJSON(KEYS.canvas, docketToCanvas(docket));
      await setJSON(KEYS.docket, toView(docket, new Date().toISOString()));
      if (claude && typeof claude === "object") await saveClaude(claude);
      await recordRun(
        { automation: "docket-sync", summary: `Sent ${n(docket.items.length, "item")}, ${n(docket.tasks?.length ?? 0, "task")}, ${n(docket.calendar?.length ?? 0, "event")}` },
        { auto: true },
      );
      break;
    }
    case "canvas":
      if (!("assignments" in b)) return NextResponse.json({ error: "expected assignments" }, { status: 422 });
      await setJSON(KEYS.canvas, { assignments: list(b.assignments), grades: list(b.grades), updates: list(b.updates) });
      break;
    default:
      return NextResponse.json({ error: "unknown source" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

/**
 * GET /api/ingest/docket returns Docket items and tasks checked off in
 * Mission Control, so the Docket sync can mark them done there too.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ source: string }> }) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { source } = await params;
  if (source !== "docket") return NextResponse.json({ error: "unknown source" }, { status: 404 });
  const done = await getJSON<Record<string, string>>(KEYS.done, {});
  const entries = Object.entries(done).filter(([id]) => id.startsWith(DOCKET_PREFIX));
  const taskPrefix = `${DOCKET_PREFIX}task:`;
  return NextResponse.json({
    items: entries.filter(([id]) => !id.startsWith(taskPrefix)).map(([id, at]) => ({ id: id.slice(DOCKET_PREFIX.length), doneAt: at })),
    tasks: entries.filter(([id]) => id.startsWith(taskPrefix)).map(([id, at]) => ({ id: id.slice(taskPrefix.length), doneAt: at })),
  });
}
