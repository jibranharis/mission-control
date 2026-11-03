import { NextResponse, type NextRequest } from "next/server";
import {
  ReconnectError,
  accountByEmail,
  defaultAccount,
  google,
  toEvent,
  toGoogleBody,
  type EventInput,
  type GEvent,
} from "@/lib/sources/google";
import { mailRecord, setMailState } from "@/lib/mail";

export const dynamic = "force-dynamic";

/**
 * Writes to Google Calendar. Mission Control reads Google on every refresh,
 * so a change made here shows in Google right away, and a change made in
 * Google shows here on the next refresh (every few minutes).
 */

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}$/;

function valid(i: Partial<EventInput>): i is EventInput {
  return (
    typeof i.title === "string" &&
    i.title.trim().length > 0 &&
    i.title.length <= 500 &&
    typeof i.date === "string" &&
    DATE.test(i.date) &&
    (i.allDay || ((!i.start || TIME.test(i.start)) && (!i.end || TIME.test(i.end)))) &&
    (!i.endDate || DATE.test(i.endDate))
  );
}

function fail(err: unknown) {
  console.error(err);
  if (err instanceof ReconnectError) return NextResponse.json({ error: "reconnect", detail: err.message }, { status: 409 });
  return NextResponse.json({ error: err instanceof Error ? err.message : "failed" }, { status: 502 });
}

const strip = (o: Record<string, unknown>) =>
  JSON.parse(JSON.stringify(o, (_k, v) => (v === null ? undefined : v))) as Record<string, unknown>;

/** Create an event: { title, date, start?, end?, allDay?, location?, description? } or { fromMail: alertId }. */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Partial<EventInput> & { fromMail?: string };
  let input: Partial<EventInput> = body;
  if (body.fromMail) {
    const r = await mailRecord(body.fromMail);
    if (!r?.event) return NextResponse.json({ error: "no event in that email" }, { status: 404 });
    input = { ...r.event, description: `From: ${r.from}\nSubject: ${r.subject}\n${r.url}` };
  }
  if (!valid(input)) return NextResponse.json({ error: "title and date (YYYY-MM-DD) required" }, { status: 400 });
  const a = await defaultAccount();
  if (!a) return NextResponse.json({ error: "No Google account connected" }, { status: 409 });
  try {
    const created = await google<GEvent>(a, "/calendar/v3/calendars/primary/events", {
      method: "POST",
      body: strip(toGoogleBody(input)),
    });
    if (body.fromMail) await setMailState(body.fromMail, "added", created.htmlLink);
    return NextResponse.json(toEvent(created, a.email, "primary", true));
  } catch (err) {
    return fail(err);
  }
}

interface Target {
  account?: string;
  calendarId?: string;
  eventId?: string;
}

async function target(t: Target) {
  if (!t.account || !t.calendarId || !t.eventId) return null;
  const a = await accountByEmail(t.account);
  return a && { a, path: `/calendar/v3/calendars/${encodeURIComponent(t.calendarId)}/events/${encodeURIComponent(t.eventId)}` };
}

/** Edit an event: { account, calendarId, eventId, ...EventInput }. */
export async function PATCH(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Target & Partial<EventInput>;
  const t = await target(body);
  const calendarId = body.calendarId!;
  if (!t) return NextResponse.json({ error: "account, calendarId and eventId required" }, { status: 400 });
  if (!valid(body)) return NextResponse.json({ error: "title and date required" }, { status: 400 });
  try {
    const updated = await google<GEvent>(t.a, t.path, { method: "PATCH", body: toGoogleBody(body) });
    return NextResponse.json(toEvent(updated, t.a.email, calendarId, true));
  } catch (err) {
    return fail(err);
  }
}

/** Delete an event: { account, calendarId, eventId }. */
export async function DELETE(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Target;
  const t = await target(body);
  if (!t) return NextResponse.json({ error: "account, calendarId and eventId required" }, { status: 400 });
  try {
    await google<void>(t.a, t.path, { method: "DELETE" });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return fail(err);
  }
}
