import { NextResponse, type NextRequest } from "next/server";
import { ingestAuthorized } from "@/lib/auth";
import { parseRunReport, recordRun } from "@/lib/ops";

export const dynamic = "force-dynamic";

/**
 * Any automation reports a run here, with the logins it used:
 *
 *   POST /api/ingest/run
 *   Authorization: Bearer $INGEST_TOKEN
 *   {
 *     "automation": "job-apply"                       // or {"id","name","description","where","schedule":{"times":["07:00"]}|{"everyMin":10}}
 *     "name": "Job applications · morning",           // optional label for this run
 *     "status": "success" | "partial" | "failure" | "running",
 *     "startedAt": "...", "finishedAt": "...",        // optional ISO times
 *     "summary": "Applied to 6 roles, 1 needed a cover letter",
 *     "steps": [{"name":"LinkedIn","status":"ok"|"failed"|"skipped","note":"..."}],
 *     "logins": [{"service":"linkedin","name":"LinkedIn","status":"ok"|"expired","loginUrl":"https://...","note":"..."}]
 *   }
 *
 * A "running" report can be followed by a final one; they merge into one run.
 */
export async function POST(req: NextRequest) {
  if (!ingestAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "json body required" }, { status: 400 });
  const report = parseRunReport(body as Record<string, unknown>);
  if (typeof report === "string") return NextResponse.json({ error: report }, { status: 422 });
  const run = await recordRun(report);
  return NextResponse.json({ ok: true, run: run.id });
}
