import { NextResponse, type NextRequest } from "next/server";
import { ingestAuthorized } from "@/lib/auth";
import { recordLogins, type LoginReport } from "@/lib/ops";

export const dynamic = "force-dynamic";

/**
 * Login checks without a run:
 *   POST /api/ingest/logins  {"usedBy":"job-apply","logins":[{"service","name","status":"ok"|"expired","loginUrl","note"}]}
 */
export async function POST(req: NextRequest) {
  if (!(await ingestAuthorized(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { logins?: LoginReport[]; usedBy?: string } | null;
  if (!body || !Array.isArray(body.logins)) return NextResponse.json({ error: "expected logins" }, { status: 422 });
  const saved = await recordLogins(body.logins, typeof body.usedBy === "string" ? body.usedBy.slice(0, 60) : undefined);
  return NextResponse.json({ ok: true, saved });
}
