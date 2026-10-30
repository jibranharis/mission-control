import { NextResponse, type NextRequest } from "next/server";
import { setJSON, KEYS } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function PUT(req: NextRequest) {
  const { text } = (await req.json().catch(() => ({}))) as { text?: string };
  if (typeof text !== "string") return NextResponse.json({ error: "text required" }, { status: 400 });
  await setJSON(KEYS.notes, text.slice(0, 20_000));
  return NextResponse.json({ ok: true });
}
