import { NextResponse, type NextRequest } from "next/server";
import { safeEqual } from "@/lib/auth";
import { runCloudSearch } from "@/lib/jobrun";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Vercel cron at 18:00 and 04:00 UTC: 10 AM and 8 PM Pacific in winter,
 * an hour later in summer. The Mac task also refreshes the search when it
 * starts, so the exact minute doesn't matter.
 * With CRON_SECRET set, Vercel sends it; without it, only Vercel's cron
 * agent is accepted, and a run within 30 minutes of the last is skipped.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const ok = secret ? safeEqual(given, secret) : /vercel-cron/i.test(req.headers.get("user-agent") ?? "");
  if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ ok: true, ...(await runCloudSearch(30)) });
}
