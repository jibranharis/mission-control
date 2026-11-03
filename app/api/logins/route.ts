import { NextResponse, type NextRequest } from "next/server";
import { updateLogin } from "@/lib/ops";

export const dynamic = "force-dynamic";

/** From the Logins page: {"id","action":"signed_in"|"remove"}. Behind the dashboard password. */
export async function POST(req: NextRequest) {
  const { id, action } = (await req.json().catch(() => ({}))) as { id?: string; action?: string };
  if (!id || (action !== "signed_in" && action !== "remove")) return NextResponse.json({ error: "id and action required" }, { status: 400 });
  const ok = await updateLogin(id, action);
  return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "unknown login" }, { status: 404 });
}
