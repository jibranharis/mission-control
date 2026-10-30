import { NextResponse, type NextRequest } from "next/server";
import { safeEqual } from "@/lib/auth";
import { getJSON, setJSON, KEYS } from "@/lib/store";
import { DOCKET_PREFIX, docketToCanvas, toView, type DocketSnapshot } from "@/lib/sources/docket";
import { normalizeClaude, type ClaudePush } from "@/lib/claude";
import type { ClaudeSnapshot } from "@/lib/types";

export const dynamic = "force-dynamic";

function authorized(req: NextRequest) {
  const secret = process.env.INGEST_TOKEN;
  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  return Boolean(secret) && safeEqual(given, secret!);
}

const list = (v: unknown) => (Array.isArray(v) ? v : []);

type History = NonNullable<ClaudeSnapshot["usage"]["history"]>;

async function saveClaude(push: ClaudePush) {
  const prev = await getJSON<History>(KEYS.usageHistory, []);
  const snap = normalizeClaude(push, prev);
  const { session, weekly } = snap.usage;
  if (session || weekly) {
    const history = [...prev, { at: snap.usage.readAt ?? snap.generatedAt, session: session?.pct, weekly: weekly?.pct }].slice(-60);
    snap.usage.history = history;
    await setJSON(KEYS.usageHistory, history);
  }
  await setJSON(KEYS.claude, snap);
}

/**
 * Lets outside jobs push snapshots in:
 *   POST /api/ingest/claude  body: ClaudeSnapshot
 *   POST /api/ingest/docket  body: DocketSnapshot, plus an optional `claude` push (from the Docket sync tasks)
 *   POST /api/ingest/canvas  body: CanvasData
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
      if (!("threads" in b || "usage" in b)) return NextResponse.json({ error: "expected usage or threads" }, { status: 422 });
      await saveClaude(b as ClaudePush);
      break;
    case "docket": {
      if (!Array.isArray(b.items)) return NextResponse.json({ error: "expected items" }, { status: 422 });
      const { claude, ...docket } = b as unknown as DocketSnapshot & { claude?: ClaudePush };
      await setJSON(KEYS.canvas, docketToCanvas(docket));
      await setJSON(KEYS.docket, toView(docket, new Date().toISOString()));
      if (claude && typeof claude === "object") await saveClaude(claude);
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
