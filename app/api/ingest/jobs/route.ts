import { NextResponse, type NextRequest } from "next/server";
import { ingestAuthorized } from "@/lib/auth";
import { allJobs, emailReady, queue, saveJobs, type JobInput } from "@/lib/jobs";
import { runCloudSearch } from "@/lib/jobrun";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * For the Mac task (signed in to the dashboard in the Claude app's browser,
 * so the session cookie is enough).
 *
 *   GET /api/ingest/jobs?next=10
 *     Refreshes the public-list search if it's over 3 hours old, then returns
 *     the next openings to fill out, best first, and the ids already saved
 *     (so a search only sends what's new).
 *
 *   POST /api/ingest/jobs
 *     {"jobs":[{ "company","role","url","source":"LinkedIn","location","deadline":"YYYY-MM-DD","tier":1-4 }]}   new openings
 *     {"jobs":[{ "id","status":"ready"|"copy"|"link","answers":[{"q","a"}],"note" }]}                      after filling one
 *     {"final":true}   at the end of a run: emails Jibran if anything new is ready
 *   Never "submitted": only Jibran marks that.
 */
export async function GET(req: NextRequest) {
  if (!(await ingestAuthorized(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const n = Math.min(50, Math.max(1, Number(req.nextUrl.searchParams.get("next") ?? 10) || 10));
  const search = await runCloudSearch(180);
  const jobs = await allJobs();
  return NextResponse.json({
    search,
    next: queue(jobs, n),
    known: jobs.map((j) => j.url),
    counts: { total: jobs.length, new: jobs.filter((j) => j.status === "new").length },
  });
}

export async function POST(req: NextRequest) {
  if (!(await ingestAuthorized(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { jobs?: JobInput[]; final?: boolean } | null;
  if (!body || typeof body !== "object") return NextResponse.json({ error: "json body required" }, { status: 400 });
  const saved = Array.isArray(body.jobs) ? await saveJobs(body.jobs) : { added: 0, updated: 0, nowReady: [], errors: [] };
  const email = body.final ? await emailReady(req.nextUrl.origin) : undefined;
  return NextResponse.json({ ok: true, added: saved.added, updated: saved.updated, nowReady: saved.nowReady.length, errors: saved.errors, email });
}
