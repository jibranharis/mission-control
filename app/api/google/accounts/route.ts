import { NextResponse, type NextRequest } from "next/server";
import { accountStatuses, removeAccount } from "@/lib/sources/google";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await accountStatuses());
}

/** Disconnects an account from Mission Control (Google access can be revoked at myaccount.google.com too). */
export async function DELETE(req: NextRequest) {
  const { email } = (await req.json().catch(() => ({}))) as { email?: string };
  if (!email) return NextResponse.json({ error: "email required" }, { status: 400 });
  await removeAccount(email);
  return NextResponse.json({ ok: true });
}
