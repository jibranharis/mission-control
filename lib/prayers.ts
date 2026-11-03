import { PRAYERS, type PrayerKey } from "@/lib/deen";

/** Prayers checked off in Mission Control: day (YYYY-MM-DD) → prayer → when it was checked. */
export type PrayerLog = Record<string, Partial<Record<PrayerKey, string>>>;

export const PRAYER_KEY = "mc:prayers";

/** How long the log keeps days, so streaks and the history grid have something to read. */
export const PRAYER_KEEP_DAYS = 400;

export const isPrayer = (p: unknown): p is PrayerKey => typeof p === "string" && (PRAYERS as string[]).includes(p);
export const isDayKey = (d: unknown): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d);

export const prayedCount = (log: PrayerLog, day: string) => PRAYERS.filter((p) => log[day]?.[p]).length;

/** Days in a row with all five prayed, ending today (or yesterday, if today isn't finished yet). */
export function streak(log: PrayerLog, today: string): number {
  const back = (key: string) => {
    const d = new Date(`${key}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  };
  let day = prayedCount(log, today) === PRAYERS.length ? today : back(today);
  let n = 0;
  while (prayedCount(log, day) === PRAYERS.length) {
    n++;
    day = back(day);
  }
  return n;
}
