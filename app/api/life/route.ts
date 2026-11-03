import { NextResponse, type NextRequest } from "next/server";
import { getJSON, setJSON } from "@/lib/store";
import { DEFAULT_PROJECTS, DEFAULT_STUDY, LIFE_KEYS, type LifeData } from "@/lib/life";

export const dynamic = "force-dynamic";

const MAX_BYTES = 500_000;

export async function GET() {
  const [projects, study, plan] = await Promise.all([
    getJSON(LIFE_KEYS.projects, DEFAULT_PROJECTS),
    getJSON(LIFE_KEYS.study, DEFAULT_STUDY),
    getJSON(LIFE_KEYS.plan, [] as LifeData["plan"]),
  ]);
  return NextResponse.json({ projects, study: { ...DEFAULT_STUDY, ...study }, plan } satisfies LifeData);
}

/** Replaces whichever of projects, study and plan the body carries. */
export async function PUT(req: NextRequest) {
  const raw = await req.text();
  if (raw.length > MAX_BYTES) return NextResponse.json({ error: "too large" }, { status: 413 });
  let body: Partial<LifeData>;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const writes: Promise<void>[] = [];
  if (Array.isArray(body.projects)) writes.push(setJSON(LIFE_KEYS.projects, body.projects));
  if (Array.isArray(body.plan)) writes.push(setJSON(LIFE_KEYS.plan, body.plan));
  if (body.study && typeof body.study === "object" && Array.isArray(body.study.sessions)) writes.push(setJSON(LIFE_KEYS.study, body.study));
  if (!writes.length) return NextResponse.json({ error: "nothing to save" }, { status: 400 });
  await Promise.all(writes);
  return NextResponse.json({ ok: true });
}
