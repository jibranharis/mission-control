import { NextResponse, type NextRequest } from "next/server";
import { setMailState } from "@/lib/mail";
import type { MailState } from "@/lib/types";

export const dynamic = "force-dynamic";

const STATES: MailState[] = ["new", "done", "dismissed", "added"];

/** Triage an alert: { id, state: "done" | "dismissed" | "new" }. */
export async function POST(req: NextRequest) {
  const { id, state } = (await req.json().catch(() => ({}))) as { id?: string; state?: MailState };
  if (!id || id.length > 300 || !state || !STATES.includes(state)) {
    return NextResponse.json({ error: "id and state required" }, { status: 400 });
  }
  await setMailState(id, state);
  return NextResponse.json({ ok: true });
}
