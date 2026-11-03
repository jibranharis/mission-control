import { NextResponse, type NextRequest } from "next/server";
import { getJSON, setJSON } from "@/lib/store";
import { GYM_KEY, normalizeGym, type GymData, type SplitDay } from "@/lib/gym";

export const dynamic = "force-dynamic";

const load = async () => normalizeGym(await getJSON<Partial<GymData> | null>(GYM_KEY, null));
const isDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

export async function GET() {
  return NextResponse.json(await load());
}

/** Saves the split and the weekdays you lift. The log is left alone. */
export async function PUT(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Partial<GymData> | null;
  const g = await load();
  if (Array.isArray(body?.split)) {
    const split = body!.split
      .filter((d): d is SplitDay => !!d && typeof d.id === "string" && typeof d.name === "string")
      .slice(0, 10)
      .map((d) => ({
        id: d.id.slice(0, 60),
        name: d.name.slice(0, 60),
        focus: String(d.focus ?? "").slice(0, 120),
        exercises: (Array.isArray(d.exercises) ? d.exercises : []).map((e) => String(e).slice(0, 100)).slice(0, 15),
      }));
    if (split.length) g.split = split;
  }
  if (Array.isArray(body?.days)) g.days = [...new Set(body!.days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
  await setJSON(GYM_KEY, g);
  return NextResponse.json(g);
}

/** Logs (or un-logs) a workout: { date, done, dayId? }. dayId swaps which day you did. */
export async function POST(req: NextRequest) {
  const { date, done, dayId } = ((await req.json().catch(() => ({}))) ?? {}) as { date?: string; done?: boolean; dayId?: string };
  if (!isDate(date)) return NextResponse.json({ error: "date required" }, { status: 400 });
  const g = await load();
  g.log = g.log.filter((l) => l.date !== date);
  if (done) {
    const id = dayId && g.split.some((d) => d.id === dayId) ? dayId : null;
    // With no day given, log whatever the rotation had planned for that date.
    const planned = id ?? g.split[(g.split.findIndex((d) => d.id === [...g.log].reverse().find((l) => l.date < date)?.dayId) + 1) % g.split.length]?.id;
    if (planned) g.log.push({ date, dayId: planned });
  }
  g.log = g.log.sort((a, b) => a.date.localeCompare(b.date)).slice(-400);
  await setJSON(GYM_KEY, g);
  return NextResponse.json(g);
}
