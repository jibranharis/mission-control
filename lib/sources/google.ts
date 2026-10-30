import type { CalendarData, CalendarEvent, UpdateItem } from "@/lib/types";
import { TIMEZONE, dateKey, startOfDay } from "@/lib/time";

const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN } = process.env;

export const googleConfigured = Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_REFRESH_TOKEN);

let cached: { token: string; expires: number } | null = null;

async function accessToken(): Promise<string> {
  if (cached && cached.expires > Date.now() + 60_000) return cached.token;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID!,
      client_secret: GOOGLE_CLIENT_SECRET!,
      refresh_token: GOOGLE_REFRESH_TOKEN!,
      grant_type: "refresh_token",
    }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`google token: ${res.status}`);
  const body = (await res.json()) as { access_token: string; expires_in: number };
  cached = { token: body.access_token, expires: Date.now() + body.expires_in * 1000 };
  return cached.token;
}

async function google<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const u = new URL(path, "https://www.googleapis.com");
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const res = await fetch(u, { headers: { Authorization: `Bearer ${await accessToken()}` }, cache: "no-store" });
  if (!res.ok) throw new Error(`google ${path}: ${res.status}`);
  return (await res.json()) as T;
}

interface GEvent {
  id: string;
  summary?: string;
  htmlLink?: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
}

const GYM = /\b(gym|lift|legs?|push|pull|arc|workout|run)\b/i;
const CLASS = /\b(lecture|lab|discussion|section|seminar|class|[A-Z]{2,4}\s?\d{1,3}[A-Z]?)\b/;
const FOCUS = /\b(focus|deep work|study)\b/i;

function kindOf(title: string): CalendarEvent["kind"] {
  if (GYM.test(title)) return "gym";
  if (CLASS.test(title)) return "class";
  if (FOCUS.test(title)) return "focus";
  return "other";
}

export async function fetchCalendar(): Promise<CalendarData> {
  const res = await google<{ items: GEvent[] }>("/calendar/v3/calendars/primary/events", {
    timeMin: startOfDay(0).toISOString(),
    timeMax: startOfDay(7).toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "250",
    timeZone: TIMEZONE,
  });
  const events: CalendarEvent[] = res.items.map((e) => ({
    id: e.id,
    title: e.summary ?? "(no title)",
    start: e.start.dateTime ?? `${e.start.date}T00:00:00`,
    end: e.end.dateTime ?? `${e.end.date}T00:00:00`,
    allDay: !e.start.dateTime,
    kind: kindOf(e.summary ?? ""),
    url: e.htmlLink,
  }));
  const todayKey = dateKey(new Date());
  const week = Array.from({ length: 7 }, (_, i) => {
    const key = dateKey(startOfDay(i));
    return { date: key, count: events.filter((e) => (e.allDay ? e.start.slice(0, 10) : dateKey(new Date(e.start))) === key).length };
  });
  return {
    today: events.filter((e) => (e.allDay ? e.start.slice(0, 10) : dateKey(new Date(e.start))) === todayKey),
    week,
  };
}

interface GMessageList {
  messages?: { id: string }[];
}
interface GMessage {
  id: string;
  internalDate: string;
  payload: { headers: { name: string; value: string }[] };
}

/** Unread inbox mail from the last day, as update items. */
export async function fetchGmail(): Promise<UpdateItem[]> {
  const list = await google<GMessageList>("/gmail/v1/users/me/messages", {
    q: "is:unread in:inbox category:primary newer_than:1d",
    maxResults: "8",
  });
  const msgs = await Promise.all(
    (list.messages ?? []).map((m) =>
      google<GMessage>(`/gmail/v1/users/me/messages/${m.id}`, { format: "metadata", metadataHeaders: "Subject" }).catch(
        () => null,
      ),
    ),
  );
  return msgs
    .filter((m): m is GMessage => m !== null)
    .map((m) => {
      const header = (n: string) => m.payload.headers.find((h) => h.name.toLowerCase() === n)?.value ?? "";
      return {
        id: `gmail:${m.id}`,
        at: new Date(Number(m.internalDate)).toISOString(),
        source: "GMAIL" as const,
        text: header("subject") || "(no subject)",
        url: `https://mail.google.com/mail/u/0/#inbox/${m.id}`,
      };
    });
}
