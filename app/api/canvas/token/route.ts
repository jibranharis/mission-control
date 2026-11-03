import { NextResponse, type NextRequest } from "next/server";
import { clearCanvasToken, saveCanvasToken } from "@/lib/sources/canvas";

export const dynamic = "force-dynamic";

/** From the Logins page, behind the dashboard password: {"token"} checks and saves a Canvas access token. */
export async function POST(req: NextRequest) {
  const { token } = (await req.json().catch(() => ({}))) as { token?: string };
  if (typeof token !== "string") return NextResponse.json({ error: "token required" }, { status: 400 });
  const r = await saveCanvasToken(token);
  return r.ok ? NextResponse.json(r) : NextResponse.json(r, { status: 422 });
}

/** Forgets the saved token. */
export async function DELETE() {
  await clearCanvasToken();
  return NextResponse.json({ ok: true });
}
