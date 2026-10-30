import { NextResponse } from "next/server";
import { buildDashboard } from "@/lib/aggregate";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await buildDashboard(), { headers: { "Cache-Control": "no-store" } });
}
