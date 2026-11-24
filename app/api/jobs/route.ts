import { NextResponse, type NextRequest } from "next/server";
import { JOB_STATUSES, allJobs, jobsMeta, setJobStatus, type JobStatus } from "@/lib/jobs";

export const dynamic = "force-dynamic";

/** Everything the bot has found, best first, for the Job applications page. */
export async function GET() {
  const [jobs, meta] = await Promise.all([allJobs(), jobsMeta()]);
  return NextResponse.json({ jobs, meta });
}

/** Marks a job submitted or skipped, or puts it back ("new"). */
export async function PATCH(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { id?: string; status?: JobStatus } | null;
  if (!body?.id || !body.status || !JOB_STATUSES.includes(body.status)) {
    return NextResponse.json({ error: "id and status required" }, { status: 400 });
  }
  const job = await setJobStatus(body.id, body.status);
  if (!job) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true, job });
}
