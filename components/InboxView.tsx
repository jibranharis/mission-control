"use client";

import { useEffect, useState } from "react";
import type { DashboardData, MailAlert, MailState } from "@/lib/types";
import { EventEditor, type Draft } from "./CalendarPanel";

type Fmt = (iso: string, opts: Intl.DateTimeFormatOptions) => string;

const IMPORTANCE_COLOR = { high: "var(--amber)", normal: "var(--blue-soft)", low: "var(--dim)" };
const CATEGORY_LABEL = { deadline: "DEADLINE", action: "ACTION", event: "EVENT", update: "UPDATE", info: "INFO" };

function useMail(data: DashboardData, onChanged: () => Promise<void>) {
  const [local, setLocal] = useState<Record<string, Partial<MailAlert>>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<Record<string, string>>({});
  useEffect(() => setLocal({}), [data.generatedAt]);
  const alerts = data.mail.alerts.map((a) => ({ ...a, ...local[a.id] }));

  const setState = async (a: MailAlert, state: MailState) => {
    setLocal((l) => ({ ...l, [a.id]: { ...l[a.id], state } }));
    await fetch("/api/mail", { method: "POST", body: JSON.stringify({ id: a.id, state }) });
  };
  const addToCalendar = async (a: MailAlert) => {
    setBusy(a.id);
    setError((e) => ({ ...e, [a.id]: "" }));
    const res = await fetch("/api/calendar", { method: "POST", body: JSON.stringify({ fromMail: a.id }) }).catch(() => null);
    setBusy(null);
    if (!res?.ok) {
      const body = (await res?.json().catch(() => ({}))) as { error?: string } | undefined;
      setError((e) => ({ ...e, [a.id]: body?.error === "reconnect" ? "Reconnect Google first" : body?.error ?? "Couldn't add it" }));
      return;
    }
    const ev = (await res.json()) as { url?: string };
    setLocal((l) => ({ ...l, [a.id]: { ...l[a.id], state: "added", eventUrl: ev.url } }));
    await onChanged();
  };
  return { alerts, setState, addToCalendar, busy, error };
}

function eventLabel(a: MailAlert, fmt: Fmt) {
  const e = a.event!;
  const day = fmt(`${e.date}T12:00:00Z`, { weekday: "short", month: "short", day: "numeric" });
  const t = (hm?: string) => {
    if (!hm) return "";
    const [h, m] = hm.split(":").map(Number);
    return `${h % 12 || 12}${m ? `:${String(m).padStart(2, "0")}` : ""}${h < 12 ? "am" : "pm"}`;
  };
  return e.allDay || !e.start ? `${day} · all day` : `${day} · ${t(e.start)}${e.end ? `–${t(e.end)}` : ""}`;
}

function AlertRow({
  a,
  fmt,
  m,
  onEdit,
}: {
  a: MailAlert;
  fmt: Fmt;
  m: ReturnType<typeof useMail>;
  onEdit: (a: MailAlert) => void;
}) {
  const handled = a.state !== "new";
  return (
    <div className={`alert${handled ? " handled" : ""}`} style={{ borderLeftColor: IMPORTANCE_COLOR[a.importance] }}>
      <div className="alert-top">
        <span className="tag" style={{ color: IMPORTANCE_COLOR[a.importance] }}>
          {a.importance === "high" ? "IMPORTANT" : CATEGORY_LABEL[a.category]}
        </span>
        <span className="alert-acct">{a.accountLabel.toUpperCase()}</span>
        <span className="alert-from">{a.from}</span>
        <span className="alert-when">{fmt(a.at, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).toUpperCase()}</span>
      </div>
      <a className="alert-subject" href={a.url} target="_blank" rel="noreferrer">
        {a.subject}
      </a>
      <p className="alert-summary">{a.summary}</p>
      {a.action && <p className="alert-action">→ {a.action}</p>}
      {a.event && (
        <div className="alert-event">
          <span className="mono">
            {a.event.title} · {eventLabel(a, fmt)}
            {a.event.location ? ` · ${a.event.location}` : ""}
          </span>
        </div>
      )}
      <div className="alert-actions">
        {a.event &&
          (a.state === "added" ? (
            a.eventUrl ? (
              <a className="mini-btn ok" href={a.eventUrl} target="_blank" rel="noreferrer">
                ✓ ON CALENDAR ↗
              </a>
            ) : (
              <span className="mini-btn ok">✓ ON CALENDAR</span>
            )
          ) : (
            <>
              <button className="mini-btn primary" type="button" disabled={m.busy === a.id} onClick={() => m.addToCalendar(a)}>
                {m.busy === a.id ? "ADDING..." : "+ ADD TO CALENDAR"}
              </button>
              <button className="mini-btn" type="button" onClick={() => onEdit(a)}>
                EDIT FIRST
              </button>
            </>
          ))}
        <a className="mini-btn" href={a.url} target="_blank" rel="noreferrer">
          OPEN ↗
        </a>
        {a.state === "new" ? (
          <>
            <button className="mini-btn" type="button" onClick={() => m.setState(a, "done")}>
              DONE
            </button>
            <button className="mini-btn" type="button" onClick={() => m.setState(a, "dismissed")}>
              DISMISS
            </button>
          </>
        ) : (
          <button className="mini-btn" type="button" onClick={() => m.setState(a, "new")}>
            UNDO
          </button>
        )}
        {m.error[a.id] && <span className="alert-err">{m.error[a.id]}</span>}
      </div>
    </div>
  );
}

function draftFrom(a: MailAlert): Draft {
  const e = a.event!;
  return {
    title: e.title,
    date: e.date,
    start: e.start ?? "09:00",
    end: e.end ?? (e.start ? `${String(Math.min(Number(e.start.slice(0, 2)) + 1, 23)).padStart(2, "0")}:${e.start.slice(3)}` : "10:00"),
    endDate: e.date,
    allDay: e.allDay,
    location: e.location ?? "",
    description: `From: ${a.from}\nSubject: ${a.subject}\n${a.url}`,
  };
}

/** Reconnect banner: any Google account whose sign-in Google revoked. */
export function ReconnectBanner({ data }: { data: DashboardData }) {
  const stale = data.mail.accounts.filter((a) => a.status === "reconnect");
  if (!stale.length) return null;
  return (
    <div className="reconnect" role="alert">
      <span className="live-dot" style={{ background: "var(--amber)" }} />
      <span>
        <strong>Sign in again:</strong> {stale.map((a) => `${a.label} (${a.email})`).join(", ")}. Calendar and mail from{" "}
        {stale.length > 1 ? "these accounts" : "this account"} are paused.
      </span>
      {stale.map((a) => (
        <a key={a.email} className="mini-btn primary" href={`/api/google/connect?hint=${encodeURIComponent(a.email)}`}>
          RECONNECT {a.label.toUpperCase()}
        </a>
      ))}
    </div>
  );
}

/** Home page panel: important mail nobody has handled yet. */
export function AlertsPanel({
  data,
  fmt,
  onChanged,
  onOpenInbox,
}: {
  data: DashboardData;
  fmt: Fmt;
  onChanged: () => Promise<void>;
  onOpenInbox: () => void;
}) {
  const m = useMail(data, onChanged);
  const [edit, setEdit] = useState<MailAlert | null>(null);
  const open = m.alerts.filter((a) => a.state === "new" && a.importance === "high");
  if (!data.mail.accounts.length) return null;
  return (
    <section className="panel" aria-labelledby="alerts-title">
      <div className="panel-head">
        <h2 id="alerts-title">INBOX · NEEDS YOU</h2>
        <span className="aside">
          <a href="#inbox" onClick={(e) => (e.preventDefault(), onOpenInbox())} style={{ color: "var(--blue-soft)" }}>
            ALL MAIL →
          </a>
          {data.sources.gmail === "error" ? <span className="badge error">ERROR</span> : <span className="badge live">LIVE</span>}
        </span>
      </div>
      {open.length === 0 ? (
        <p className="empty">Nothing important waiting in your inbox.</p>
      ) : (
        <div className="alerts">
          {open.slice(0, 5).map((a) => (
            <AlertRow key={a.id} a={a} fmt={fmt} m={m} onEdit={setEdit} />
          ))}
          {open.length > 5 && (
            <a className="alerts-more" href="#inbox" onClick={(e) => (e.preventDefault(), onOpenInbox())}>
              +{open.length - 5} MORE IN INBOX →
            </a>
          )}
        </div>
      )}
      {edit && (
        <EventEditor
          draft={draftFrom(edit)}
          onClose={() => setEdit(null)}
          onSaved={async () => {
            await m.setState(edit, "added");
            setEdit(null);
            await onChanged();
          }}
        />
      )}
    </section>
  );
}

const FILTERS = [
  ["needs", "NEEDS YOU"],
  ["all", "ALL"],
  ["events", "HAS A DATE"],
  ["handled", "HANDLED"],
] as const;

export function InboxView({ data, fmt, onChanged }: { data: DashboardData; fmt: Fmt; onChanged: () => Promise<void> }) {
  const m = useMail(data, onChanged);
  const [filter, setFilter] = useState<(typeof FILTERS)[number][0]>("needs");
  const [account, setAccount] = useState("all");
  const [edit, setEdit] = useState<MailAlert | null>(null);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const q = new URLSearchParams(location.search).get("google");
    if (!q) return;
    setNotice(q.startsWith("connected:") ? `Connected ${q.slice(10)}.` : `Google sign-in didn't finish: ${q.replace(/^error:/, "")}`);
    history.replaceState(null, "", `${location.pathname}#inbox`);
  }, []);

  const shown = m.alerts.filter(
    (a) =>
      (account === "all" || a.account === account) &&
      (filter === "all"
        ? true
        : filter === "handled"
          ? a.state !== "new"
          : filter === "events"
            ? Boolean(a.event)
            : a.state === "new" && a.importance !== "low"),
  );
  const needs = m.alerts.filter((a) => a.state === "new" && a.importance !== "low").length;

  const disconnect = async (email: string) => {
    await fetch("/api/google/accounts", { method: "DELETE", body: JSON.stringify({ email }) });
    await onChanged();
  };

  return (
    <>
      <section className="view-head">
        <div>
          <h1>Inbox</h1>
          <p className="mono">
            {needs} NEED{needs === 1 ? "S" : ""} YOU · {data.mail.claude ? "READ BY CLAUDE" : "SORTED BY RULES"} · LAST 7 DAYS
          </p>
        </div>
      </section>

      {notice && <p className="notice">{notice}</p>}
      <ReconnectBanner data={data} />

      <div className="inbox-layout">
        <section className="panel" aria-labelledby="mail-title">
          <div className="panel-head">
            <h2 id="mail-title">MAIL · ALERTS</h2>
            <div className="seg">
              {FILTERS.map(([id, label]) => (
                <button key={id} type="button" aria-pressed={filter === id} onClick={() => setFilter(id)}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          {data.mail.accounts.length > 1 && (
            <div className="seg seg-sub">
              <button type="button" aria-pressed={account === "all"} onClick={() => setAccount("all")}>
                ALL ACCOUNTS
              </button>
              {data.mail.accounts.map((a) => (
                <button key={a.email} type="button" aria-pressed={account === a.email} onClick={() => setAccount(a.email)}>
                  {a.label.toUpperCase()}
                </button>
              ))}
            </div>
          )}
          {!data.mail.accounts.length ? (
            <p className="empty">Connect a Google account on the right and your mail shows up here.</p>
          ) : shown.length === 0 ? (
            <p className="empty">{filter === "needs" ? "Inbox zero on what matters. Nice." : "Nothing here."}</p>
          ) : (
            <div className="alerts">
              {shown.map((a) => (
                <AlertRow key={a.id} a={a} fmt={fmt} m={m} onEdit={setEdit} />
              ))}
            </div>
          )}
        </section>

        <section className="panel" aria-labelledby="accounts-title">
          <div className="panel-head">
            <h2 id="accounts-title">GOOGLE ACCOUNTS</h2>
            <span className="aside">CALENDAR + GMAIL</span>
          </div>
          {data.mail.accounts.map((a, i) => (
            <div key={a.email} className="row acct">
              <span className="live-dot" style={{ background: a.status === "ok" ? "var(--teal)" : "var(--amber)", animation: "none" }} />
              <span className="row-main">
                <span className="row-title">{a.label}</span>
                <span className="row-meta">
                  {a.email.toUpperCase()}
                  {i === 0 && a.status === "ok" ? " · NEW EVENTS GO HERE" : ""}
                  {a.status === "reconnect" ? " · SIGNED OUT" : ""}
                </span>
              </span>
              {a.status === "reconnect" ? (
                <a className="mini-btn primary" href={`/api/google/connect?hint=${encodeURIComponent(a.email)}`}>
                  RECONNECT
                </a>
              ) : (
                a.email !== "primary" && (
                  <button className="mini-btn" type="button" onClick={() => disconnect(a.email)}>
                    REMOVE
                  </button>
                )
              )}
            </div>
          ))}
          {data.mail.canConnect ? (
            <div className="panel-body">
              <a className="btn btn-primary acct-add" href="/api/google/connect">
                + CONNECT A GOOGLE ACCOUNT
              </a>
              <p className="row-note">
                Do this once for your personal Gmail and once for your UC Davis account. Mission Control reads your mail (it never sends or
                deletes any) and reads and edits your calendar.
              </p>
            </div>
          ) : (
            <p className="empty">Google isn&apos;t set up on the server yet. Follow &quot;Connect Google&quot; in the README.</p>
          )}
        </section>
      </div>

      {edit && (
        <EventEditor
          draft={draftFrom(edit)}
          onClose={() => setEdit(null)}
          onSaved={async () => {
            await m.setState(edit, "added");
            setEdit(null);
            await onChanged();
          }}
        />
      )}
    </>
  );
}
