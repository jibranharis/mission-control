import { NextResponse, type NextRequest } from "next/server";
import { safeEqual } from "@/lib/auth";
import { setJSON, KEYS } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * Lets outside jobs push snapshots in:
 *   POST /api/ingest/claude  body: ClaudeSnapshot
 *   POST /api/ingest/canvas  body: CanvasData   (for a scraper instead of the Canvas API)
 * Authenticated with `Authorization: Bearer $INGEST_TOKEN`.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ source: string }> }) {
  const secret = process.env.INGEST_TOKEN;
  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!secret || !safeEqual(given, secret)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { source } = await params;
  const key = source === "claude" ? KEYS.claude : source === "canvas" ? KEYS.canvas : null;
  if (!key) return NextResponse.json({ error: "unknown source" }, { status: 404 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "json body required" }, { status: 400 });
  if (source === "claude" && !("threads" in body && "usage" in body && "graph" in body)) {
    return NextResponse.json({ error: "expected usage, threads and graph" }, { status: 422 });
  }
  if (source === "canvas" && !("assignments" in body)) {
    return NextResponse.json({ error: "expected assignments" }, { status: 422 });
  }
  const b = body as Record<string, unknown>;
  const list = (v: unknown) => (Array.isArray(v) ? v : []);
  const snapshot =
    source === "claude"
      ? { ...b, threads: list(b.threads), updates: list(b.updates), generatedAt: new Date().toISOString() }
      : { assignments: list(b.assignments), grades: list(b.grades), updates: list(b.updates) };
  await setJSON(key, snapshot);
  return NextResponse.json({ ok: true });
}
