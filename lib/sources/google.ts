import type { CalendarData, CalendarEvent, GoogleAccountStatus } from "@/lib/types";
import { TIMEZONE, dateKey, startOfDay } from "@/lib/time";
import { getJSON, setJSON } from "@/lib/store";

/**
 * Google Calendar and Gmail for one or more Google accounts (say, a personal
 * account and a UC Davis one). Accounts are connected from the dashboard
 * (/api/google/connect) and their refresh tokens live in the database, never
 * in the repo. GOOGLE_REFRESH_TOKEN still works as a single legacy account.
 */

const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN } = process.env;

export const googleClientConfigured = Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET);

export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/gmail.readonly",
];

export function redirectUri(origin: string) {
  return process.env.GOOGLE_REDIRECT_URI ?? `${origin}/api/google/callback`;
}

const ACCOUNTS_KEY = "mc:google:accounts";

export interface GoogleAccount {
  email: string;
  /** "UC Davis", "Personal", ... */
  label: string;
  refreshToken: string;
  addedAt: string;
  /** Set when Google refuses the refresh token; the account must be connected again. */
  needsReconnect?: string;
}

export function labelFor(email: string): string {
  const domain = email.split("@")[1]?.toLowerCase() ?? "";
  if (domain === "ucdavis.edu" || domain.endsWith(".ucdavis.edu")) return "UC Davis";
  if (domain === "gmail.com" || domain === "googlemail.com") return "Personal";
  return domain || "Google";
}

export async function listAccounts(): Promise<GoogleAccount[]> {
  const stored = await getJSON<GoogleAccount[]>(ACCOUNTS_KEY, []);
  if (stored.length || !GOOGLE_REFRESH_TOKEN) return stored;
  return [{ email: "primary", label: "Google", refreshToken: GOOGLE_REFRESH_TOKEN, addedAt: "" }];
}

export async function saveAccount(account: GoogleAccount): Promise<void> {
  const all = (await getJSON<GoogleAccount[]>(ACCOUNTS_KEY, [])).filter((a) => a.email !== account.email);
  // Personal accounts first: the first account is where new events go.
  all.push(account);
  all.sort((a, b) => Number(a.label === "UC Davis") - Number(b.label === "UC Davis"));
  await setJSON(ACCOUNTS_KEY, all);
}

export async function removeAccount(email: string): Promise<void> {
  const all = await getJSON<GoogleAccount[]>(ACCOUNTS_KEY, []);
  await setJSON(
    ACCOUNTS_KEY,
    all.filter((a) => a.email !== email),
  );
}

async function markReconnect(email: string, reason: string) {
  const all = await getJSON<GoogleAccount[]>(ACCOUNTS_KEY, []);
  const a = all.find((x) => x.email === email);
  if (!a || a.needsReconnect) return;
  a.needsReconnect = reason;
  await setJSON(ACCOUNTS_KEY, all);
}

/** Problems from the latest reads in this server instance, by account and area. */
const problems = new Map<string, Partial<Record<"mail" | "calendar", string>>>();

/** Turns a Google API error into something a person can act on. */
export function plainError(err: unknown, area: "mail" | "calendar"): string {
  const msg = err instanceof Error ? err.message : String(err);
  const api = area === "mail" ? "Gmail API" : "Google Calendar API";
  if (/SERVICE_DISABLED|has not been used|is disabled|accessNotConfigured/i.test(msg))
    return `The ${api} isn't turned on. In Google Cloud, search "${api}" and click Enable, then wait 2 minutes.`;
  if (/insufficient|ACCESS_TOKEN_SCOPE_INSUFFICIENT|PERMISSION_DENIED/i.test(msg))
    return `Google didn't grant ${area} access. Click Remove, connect again, and tick every box.`;
  if (/admin|domain policy|restricted/i.test(msg)) return "Your school blocks this app for this account.";
  if (err instanceof ReconnectError) return "Google signed this account out.";
  return `Couldn't read ${area}: ${msg.slice(0, 140)}`;
}

export function noteProblem(email: string, area: "mail" | "calendar", err?: unknown) {
  const cur = problems.get(email) ?? {};
  if (err === undefined) delete cur[area];
  else cur[area] = plainError(err, area);
  problems.set(email, cur);
}

export async function accountStatuses(): Promise<GoogleAccountStatus[]> {
  return (await listAccounts()).map((a) => {
    const p = problems.get(a.email);
    const problem = [p?.mail, p?.calendar].filter(Boolean).join(" ");
    return {
      email: a.email,
      label: a.label,
      status: a.needsReconnect ? "reconnect" : "ok",
      detail: a.needsReconnect,
      ...(problem ? { problem } : {}),
    };
  });
}

export class ReconnectError extends Error {}

const tokens = new Map<string, { token: string; expires: number }>();

async function accessToken(a: GoogleAccount): Promise<string> {
  const hit = tokens.get(a.email);
  if (hit && hit.expires > Date.now() + 60_000) return hit.token;
  if (a.needsReconnect) throw new ReconnectError(`${a.email}: ${a.needsReconnect}`);
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID!,
      client_secret: GOOGLE_CLIENT_SECRET!,
      refresh_token: a.refreshToken,
      grant_type: "refresh_token",
    }),
    cache: "no-store",
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    // invalid_grant: revoked, expired (7-day test tokens), or password changed.
    if (body.error === "invalid_grant") {
      await markReconnect(a.email, "Google signed this account out");
      throw new ReconnectError(`${a.email}: sign-in expired`);
    }
    throw new Error(`google token ${a.email}: ${res.status} ${body.error ?? ""}`);
  }
  const body = (await res.json()) as { access_token: string; expires_in: number };
  tokens.set(a.email, { token: body.access_token, expires: Date.now() + body.expires_in * 1000 });
  return body.access_token;
}

export async function google<T>(
  a: GoogleAccount,
  path: string,
  init: { params?: Record<string, string>; method?: string; body?: unknown } = {},
): Promise<T> {
  const u = new URL(path, "https://www.googleapis.com");
  for (const [k, v] of Object.entries(init.params ?? {})) u.searchParams.set(k, v);
  const res = await fetch(u, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${await accessToken(a)}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  if (res.status === 401) {
    tokens.delete(a.email);
    throw new Error(`google ${path}: 401`);
  }
  if (!res.ok) throw new Error(`google ${init.method ?? "GET"} ${path}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/* ---------------------------------------------------------------- Calendar */

interface GCalendar {
  id: string;
  summary?: string;
  summaryOverride?: string;
  primary?: boolean;
  selected?: boolean;
  hidden?: boolean;
  accessRole: "owner" | "writer" | "reader" | "freeBusyReader";
  backgroundColor?: string;
}

export interface GEvent {
  id: string;
  iCalUID?: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  recurringEventId?: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
}

const GYM = /\b(gym|lift|legs?|push|pull|arc|workout|run|climb(ing)?)\b/i;
const CLASS = /\b(lecture|lab|discussion|section|seminar|class|[A-Z]{2,4}\s?\d{1,3}[A-Z]?)\b/;
const FOCUS = /\b(focus|deep work|study)\b/i;

function kindOf(title: string): CalendarEvent["kind"] {
  if (GYM.test(title)) return "gym";
  if (CLASS.test(title)) return "class";
  if (FOCUS.test(title)) return "focus";
  return "other";
}

export function toEvent(e: GEvent, account: string, calendarId: string, editable: boolean, calendarName?: string): CalendarEvent {
  const title = e.summary ?? "(no title)";
  return {
    id: e.id,
    title,
    start: e.start.dateTime ?? e.start.date!,
    end: e.end.dateTime ?? e.end.date ?? e.start.dateTime ?? e.start.date!,
    allDay: !e.start.dateTime,
    kind: kindOf(title),
    url: e.htmlLink,
    location: e.location || undefined,
    description: e.description || undefined,
    account,
    calendarId,
    calendarName,
    editable,
    recurring: Boolean(e.recurringEventId),
  };
}

/** Local date keys an event covers (all-day events can span several days; end date is exclusive). */
export function eventDays(e: CalendarEvent): string[] {
  if (!e.allDay) return [dateKey(new Date(e.start))];
  const out: string[] = [];
  const start = e.start.slice(0, 10);
  const end = e.end.slice(0, 10);
  for (let d = new Date(`${start}T12:00:00Z`); out.length < 31; d = new Date(d.getTime() + 86_400_000)) {
    const k = d.toISOString().slice(0, 10);
    if (out.length && k >= end) break;
    out.push(k);
  }
  return out;
}

async function accountEvents(a: GoogleAccount, from: Date, to: Date): Promise<CalendarEvent[]> {
  const list = await google<{ items: GCalendar[] }>(a, "/calendar/v3/users/me/calendarList", {
    params: { minAccessRole: "reader" },
  });
  const cals = list.items.filter((c) => c.primary || (c.selected && !c.hidden));
  const per = await Promise.all(
    cals.map(async (c) => {
      const res = await google<{ items: GEvent[] }>(a, `/calendar/v3/calendars/${encodeURIComponent(c.id)}/events`, {
        params: {
          timeMin: from.toISOString(),
          timeMax: to.toISOString(),
          singleEvents: "true",
          orderBy: "startTime",
          maxResults: "250",
          timeZone: TIMEZONE,
        },
      }).catch((err) => {
        console.error(err);
        return { items: [] as GEvent[] };
      });
      const editable = c.accessRole === "owner" || c.accessRole === "writer";
      return res.items
        .filter((e) => e.status !== "cancelled")
        .map((e) => ({ ...toEvent(e, a.email, c.id, editable, c.summaryOverride ?? c.summary), _uid: e.iCalUID ?? e.id }));
    }),
  );
  return per.flat();
}

/** Every visible calendar of every connected account, today through the next 13 days. */
export async function fetchCalendar(): Promise<CalendarData | null> {
  const accounts = (await listAccounts()).filter((a) => !a.needsReconnect);
  if (!accounts.length) return null;
  const from = startOfDay(0);
  const to = startOfDay(14);
  const results = await Promise.allSettled(
    accounts.map((a) =>
      accountEvents(a, from, to).then(
        (r) => (noteProblem(a.email, "calendar"), r),
        (err) => {
          noteProblem(a.email, "calendar", err);
          throw err;
        },
      ),
    ),
  );
  const ok = results.filter((r): r is PromiseFulfilledResult<(CalendarEvent & { _uid: string })[]> => r.status === "fulfilled");
  if (!ok.length) throw (results[0] as PromiseRejectedResult).reason;
  // The same meeting can sit on two accounts' calendars; keep the editable copy.
  const byUid = new Map<string, CalendarEvent & { _uid: string }>();
  for (const e of ok.flatMap((r) => r.value)) {
    const key = `${e._uid}|${e.start}`;
    const prev = byUid.get(key);
    if (!prev || (!prev.editable && e.editable)) byUid.set(key, e);
  }
  const events: CalendarEvent[] = [...byUid.values()]
    .map(({ _uid, ...e }) => e)
    .sort((a, b) => a.start.localeCompare(b.start));
  return calendarData(events);
}

export function calendarData(events: CalendarEvent[]): CalendarData {
  const byDay = new Map<string, CalendarEvent[]>();
  for (const e of events) for (const k of eventDays(e)) byDay.set(k, [...(byDay.get(k) ?? []), e]);
  const todayKey = dateKey(new Date());
  const week = Array.from({ length: 7 }, (_, i) => {
    const key = dateKey(startOfDay(i));
    return { date: key, count: (byDay.get(key) ?? []).filter((e) => !e.routine).length };
  });
  return { today: byDay.get(todayKey) ?? [], week, events };
}

/** Where new events go: the first connected (personal-first) account's primary calendar. */
export async function defaultAccount(): Promise<GoogleAccount | null> {
  return (await listAccounts()).find((a) => !a.needsReconnect) ?? null;
}

export async function accountByEmail(email: string): Promise<GoogleAccount | null> {
  return (await listAccounts()).find((a) => a.email === email) ?? null;
}

export interface EventInput {
  title: string;
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM, ignored for all-day events. */
  start?: string;
  end?: string;
  /** Last day for all-day events (inclusive), defaults to `date`. */
  endDate?: string;
  allDay?: boolean;
  location?: string;
  description?: string;
}

function nextDay(key: string) {
  return new Date(Date.parse(`${key}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}

export function toGoogleBody(i: EventInput): Partial<GEvent> & Record<string, unknown> {
  const body: Record<string, unknown> = { summary: i.title };
  if (i.location !== undefined) body.location = i.location;
  if (i.description !== undefined) body.description = i.description;
  if (i.allDay) {
    body.start = { date: i.date, dateTime: null };
    body.end = { date: nextDay(i.endDate && i.endDate >= i.date ? i.endDate : i.date), dateTime: null };
  } else {
    const start = i.start ?? "09:00";
    let end = i.end ?? start;
    let endDate = i.date;
    if (end <= start) {
      // Ends past midnight, or no end given: default to an hour, wrapping to the next day.
      if (!i.end || i.end === start) {
        const [h, m] = start.split(":").map(Number);
        end = `${String((h + 1) % 24).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
        if (h + 1 >= 24) endDate = nextDay(i.date);
      } else endDate = nextDay(i.date);
    }
    body.start = { dateTime: `${i.date}T${start}:00`, timeZone: TIMEZONE, date: null };
    body.end = { dateTime: `${endDate}T${end}:00`, timeZone: TIMEZONE, date: null };
  }
  return body;
}
