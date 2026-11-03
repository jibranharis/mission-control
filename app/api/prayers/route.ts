import { NextResponse, type NextRequest } from "next/server";
import { getJSON, setJSON } from "@/lib/store";
import { PRAYER_KEEP_DAYS, PRAYER_KEY, isDayKey, isPrayer, type PrayerLog } from "@/lib/prayers";

export const dynamic = "force-dynamic";

/** The prayer log checked off on the Deen page. */
export async function GET() {
  return NextResponse.json({ log: await getJSON<PrayerLog>(PRAYER_KEY, {}) });
}

/** Checks a prayer off for a day, or unchecks it. Body: { date: "YYYY-MM-DD", prayer: "fajr", done: true } */
export async function POST(req: NextRequest) {
  const { date, prayer, done } = (await req.json().catch(() => ({}))) as { date?: unknown; prayer?: unknown; done?: unknown };
  if (!isDayKey(date) || !isPrayer(prayer)) return NextResponse.json({ error: "date and prayer required" }, { status: 400 });
  const log = await getJSON<PrayerLog>(PRAYER_KEY, {});
  const day = { ...log[date] };
  if (done) day[prayer] = new Date().toISOString();
  else delete day[prayer];
  if (Object.keys(day).length) log[date] = day;
  else delete log[date];
  const cutoff = new Date(Date.now() - PRAYER_KEEP_DAYS * 86_400_000).toISOString().slice(0, 10);
  for (const k of Object.keys(log)) if (k < cutoff) delete log[k];
  await setJSON(PRAYER_KEY, log);
  return NextResponse.json({ ok: true, log });
}
