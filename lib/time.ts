export const TIMEZONE = process.env.TIMEZONE ?? "America/Los_Angeles";

/** Calendar date (YYYY-MM-DD) of an instant in the given time zone. */
export function dateKey(d: Date, tz = TIMEZONE): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** Minutes the zone is ahead of UTC at the given instant. */
function offsetMinutes(d: Date, tz: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  const asUTC = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return Math.round((asUTC - d.getTime()) / 60000);
}

/** Start of the local day `days` from today, as a UTC instant. */
export function startOfDay(days = 0, tz = TIMEZONE, now = new Date()): Date {
  const [y, m, d] = dateKey(now, tz).split("-").map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d + days));
  return new Date(guess.getTime() - offsetMinutes(guess, tz) * 60000);
}

export function isToday(iso: string, tz = TIMEZONE, now = new Date()): boolean {
  return dateKey(new Date(iso), tz) === dateKey(now, tz);
}
