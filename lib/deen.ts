/**
 * Prayer times and the Hijri calendar, ported from Docket's Deen page so both
 * show the same times. Pure functions; safe to run in the browser.
 */

export const PRAYER_LOCATION = {
  lat: Number(process.env.NEXT_PUBLIC_PRAYER_LAT ?? 38.5449),
  lng: Number(process.env.NEXT_PUBLIC_PRAYER_LNG ?? -121.7405),
};

const METHODS: Record<string, { name: string; fajr: number; maghrib: number; isha: number }> = {
  jafari: { name: "Jafari · Leva Institute, Qum", fajr: 16, maghrib: 4, isha: 14 },
  tehran: { name: "Tehran · Institute of Geophysics", fajr: 17.7, maghrib: 4.5, isha: 14 },
};

export const methodName = (m = "jafari") => (METHODS[m] ?? METHODS.jafari).name;

const rad = (x: number) => (x * Math.PI) / 180;
const deg = (x: number) => (x * 180) / Math.PI;
const dsin = (x: number) => Math.sin(rad(x));
const dcos = (x: number) => Math.cos(rad(x));
const dtan = (x: number) => Math.tan(rad(x));
const fixA = (a: number) => ((a % 360) + 360) % 360;
const fixH = (h: number) => ((h % 24) + 24) % 24;

function julianDay(y: number, m: number, d: number) {
  if (m <= 2) {
    y -= 1;
    m += 12;
  }
  const A = Math.floor(y / 100);
  const B = 2 - A + Math.floor(A / 4);
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + d + B - 1524.5;
}

function sunPos(jd: number) {
  const D = jd - 2451545;
  const g = fixA(357.529 + 0.98560028 * D);
  const q = fixA(280.459 + 0.98564736 * D);
  const L = fixA(q + 1.915 * dsin(g) + 0.02 * dsin(2 * g));
  const e = 23.439 - 0.00000036 * D;
  const decl = deg(Math.asin(dsin(e) * dsin(L)));
  const RA = fixH(deg(Math.atan2(dcos(e) * dsin(L), dcos(L))) / 15);
  return { decl, eqt: q / 15 - RA };
}

function tzOffsetHours(y: number, m: number, d: number, tz: string) {
  const utc = Date.UTC(y, m - 1, d, 12);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" })
      .formatToParts(new Date(utc))
      .map((p) => [p.type, Number(p.value)]),
  );
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  return Math.round((asUtc - utc) / 9e5) / 4;
}

export type PrayerKey = "fajr" | "sunrise" | "dhuhr" | "asr" | "maghrib" | "isha" | "midnight";
export const PRAYER_ORDER: [PrayerKey, string][] = [
  ["fajr", "Fajr"],
  ["sunrise", "Sunrise"],
  ["dhuhr", "Dhuhr"],
  ["asr", "Asr"],
  ["maghrib", "Maghrib"],
  ["isha", "Isha"],
  ["midnight", "Midnight"],
];
export const PRAYERS: PrayerKey[] = ["fajr", "dhuhr", "asr", "maghrib", "isha"];

/** Prayer times for a local date (YYYY-MM-DD). */
export function prayerTimes(key: string, tz: string, method = "jafari", loc = PRAYER_LOCATION): Record<PrayerKey, Date> {
  const [y, m, d] = key.split("-").map(Number);
  const M = METHODS[method] ?? METHODS.jafari;
  const { lat, lng } = loc;
  const tzh = tzOffsetHours(y, m, d, tz);
  const jd = julianDay(y, m, d) - lng / (15 * 24);
  const midDay = (t: number) => fixH(12 - sunPos(jd + t / 24).eqt);
  const sunAngleTime = (angle: number, t: number, ccw: boolean) => {
    const decl = sunPos(jd + t / 24).decl;
    const v = (-dsin(angle) - dsin(decl) * dsin(lat)) / (dcos(decl) * dcos(lat));
    const T = deg(Math.acos(Math.max(-1, Math.min(1, v)))) / 15;
    return midDay(t) + (ccw ? -T : T);
  };
  const asrTime = (f: number, t: number) => {
    const decl = sunPos(jd + t / 24).decl;
    return sunAngleTime(-deg(Math.atan(1 / (f + dtan(Math.abs(lat - decl))))), t, false);
  };
  const rs = 0.833;
  const o: Record<string, number> = {
    fajr: sunAngleTime(M.fajr, 5, true),
    sunrise: sunAngleTime(rs, 6, true),
    dhuhr: midDay(12),
    asr: asrTime(1, 13),
    sunset: sunAngleTime(rs, 18, false),
    maghrib: sunAngleTime(M.maghrib, 18, false),
    isha: sunAngleTime(M.isha, 18, false),
  };
  for (const k in o) o[k] = o[k] + tzh - lng / 15;
  o.midnight = o.sunset + fixH(o.fajr - o.sunset) / 2;
  const out = {} as Record<PrayerKey, Date>;
  for (const [k] of PRAYER_ORDER) out[k] = new Date(Date.UTC(y, m - 1, d) + (o[k] - tzh) * 36e5);
  return out;
}

export const HIJRI_MONTHS = ["Muharram", "Safar", "Rabi' al-Awwal", "Rabi' al-Thani", "Jumada al-Ula", "Jumada al-Thani", "Rajab", "Sha'ban", "Ramadan", "Shawwal", "Dhu al-Qa'dah", "Dhu al-Hijjah"];

/** Hijri date (Umm al-Qura), shifted by `offset` days for local moon sighting. */
export function hijri(key: string, offset = 0) {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  const p: Record<string, number> = {};
  new Intl.DateTimeFormat("en-u-ca-islamic-umalqura", { day: "numeric", month: "numeric", year: "numeric", timeZone: "UTC" })
    .formatToParts(d)
    .forEach((x) => {
      if (x.type === "day" || x.type === "month" || x.type === "year") p[x.type] = parseInt(x.value, 10);
    });
  return { y: p.year, m: p.month, d: p.day, name: HIJRI_MONTHS[p.month - 1] ?? "" };
}

export type OccasionKind = "eid" | "grief" | "fast" | "qadr" | "amal" | "info";

/** [Hijri month, day, title, kind], as in Docket. */
export const OCCASIONS: [number, number, string, OccasionKind][] = [
  [1, 1, "1 Muharram · new Hijri year; majalis begin", "grief"], [1, 9, "Tasu'a", "grief"], [1, 10, "Ashura · martyrdom of Imam Husayn (a) and his companions", "grief"], [1, 25, "Martyrdom of Imam Zayn al-Abidin (a)", "grief"],
  [2, 7, "Martyrdom of Imam Hasan (a), per one narration", "grief"], [2, 20, "Arbaeen · 40 days after Ashura", "grief"], [2, 28, "Demise of the Prophet (s); martyrdom of Imam Hasan (a)", "grief"], [2, 29, "Martyrdom of Imam Rida (a) (end of Safar)", "grief"],
  [3, 8, "Martyrdom of Imam Hasan al-Askari (a)", "grief"], [3, 9, "Start of the Imamate of Imam al-Mahdi (aj)", "eid"], [3, 17, "Birth of the Prophet (s) and Imam Ja'far al-Sadiq (a) · recommended fast", "eid"],
  [4, 8, "Birth of Imam Hasan al-Askari (a)", "eid"],
  [5, 5, "Birth of Sayyida Zaynab (s)", "eid"], [5, 13, "Fatimiyya · martyrdom of Sayyida Fatima (s), first narration", "grief"], [5, 15, "Birth of Imam Zayn al-Abidin (a) · recommended fast", "eid"],
  [6, 3, "Fatimiyya · martyrdom of Sayyida Fatima (s), second narration", "grief"], [6, 20, "Birth of Sayyida Fatima al-Zahra (s)", "eid"],
  [7, 1, "Birth of Imam Muhammad al-Baqir (a); Rajab begins (fasting recommended all month)", "eid"], [7, 3, "Martyrdom of Imam Ali al-Hadi (a)", "grief"], [7, 10, "Birth of Imam Muhammad al-Jawad (a)", "eid"], [7, 13, "Birth of Imam Ali (a) in the Ka'ba", "eid"], [7, 15, "Umm Dawud amal · Ayyam al-Beed of Rajab", "amal"], [7, 25, "Martyrdom of Imam Musa al-Kadhim (a)", "grief"], [7, 27, "Mab'ath · the Prophet (s) receives revelation · recommended fast", "eid"],
  [8, 3, "Birth of Imam Husayn (a)", "eid"], [8, 4, "Birth of Abbas ibn Ali (a)", "eid"], [8, 5, "Birth of Imam Zayn al-Abidin (a), per one narration", "eid"], [8, 11, "Birth of Ali al-Akbar (a)", "eid"], [8, 15, "Nisf Sha'ban · birth of Imam al-Mahdi (aj); night of worship", "eid"],
  [9, 1, "Ramadan begins", "info"], [9, 10, "Demise of Khadija (s)", "grief"], [9, 15, "Birth of Imam Hasan (a)", "eid"], [9, 19, "Laylat al-Qadr (1st) · Imam Ali (a) struck in Kufa", "qadr"], [9, 21, "Laylat al-Qadr (2nd) · martyrdom of Imam Ali (a)", "qadr"], [9, 23, "Laylat al-Qadr (3rd, most emphasized)", "qadr"],
  [10, 1, "Eid al-Fitr · zakat al-fitra due before Eid prayer", "eid"], [10, 25, "Martyrdom of Imam Ja'far al-Sadiq (a)", "grief"],
  [11, 1, "Birth of Sayyida Fatima al-Ma'suma (s)", "eid"], [11, 11, "Birth of Imam Ali al-Rida (a)", "eid"], [11, 25, "Dahw al-Ard · recommended fast", "fast"], [11, 29, "Martyrdom of Imam al-Jawad (a)", "grief"],
  [12, 1, "First ten days of Dhu al-Hijjah · fasting 1–9 recommended", "fast"], [12, 7, "Martyrdom of Imam al-Baqir (a)", "grief"], [12, 9, "Day of Arafah · Dua Arafah", "amal"], [12, 10, "Eid al-Adha", "eid"], [12, 18, "Eid al-Ghadir · recommended fast", "eid"], [12, 24, "Mubahala · recommended fast", "eid"], [12, 25, "Surah al-Insan revealed about the Ahl al-Bayt (a)", "info"],
];

/** Occasions in the next `days` days, starting from local date `fromKey`. */
export function upcomingOccasions(fromKey: string, days: number, offset = 0) {
  const out: { key: string; title: string; kind: OccasionKind; inDays: number; hijri: string }[] = [];
  const base = new Date(`${fromKey}T12:00:00Z`);
  for (let i = 0; i <= days; i++) {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() + i);
    const key = d.toISOString().slice(0, 10);
    const h = hijri(key, offset);
    for (const o of OCCASIONS) if (o[0] === h.m && o[1] === h.d) out.push({ key, title: o[2], kind: o[3], inDays: i, hijri: `${h.d} ${h.name}` });
  }
  return out;
}
