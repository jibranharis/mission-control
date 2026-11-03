"use client";

import { useMemo, useState } from "react";
import type { AutomationRun, AutomationView, Health, LoginView, OpsView, RunStatus } from "@/lib/ops";

type Fmt = (iso: string, opts: Intl.DateTimeFormatOptions) => string;

const RUN: Record<RunStatus, { label: string; color: string }> = {
  success: { label: "SUCCESS", color: "var(--teal)" },
  partial: { label: "PARTIAL", color: "var(--amber)" },
  failure: { label: "FAILED", color: "var(--red)" },
  running: { label: "RUNNING", color: "var(--blue)" },
};

const HEALTH: Record<Health, { label: string; color: string }> = {
  ok: { label: "NOMINAL", color: "var(--teal)" },
  failing: { label: "FAILING", color: "var(--red)" },
  missed: { label: "MISSED RUN", color: "var(--amber)" },
  stale: { label: "QUIET", color: "var(--muted)" },
  never: { label: "NO RUNS YET", color: "var(--muted)" },
};

const LOGIN: Record<LoginView["shown"], { label: string; color: string }> = {
  ok: { label: "SIGNED IN", color: "var(--teal)" },
  expired: { label: "RE-LOGIN NEEDED", color: "var(--red)" },
  error: { label: "CHECK FAILED", color: "var(--amber)" },
  stale: { label: "NOT CHECKED LATELY", color: "var(--muted)" },
  pending: { label: "CONFIRMING", color: "var(--blue-soft)" },
  unchecked: { label: "NOT LOGGED IN", color: "var(--red)" },
};

function ago(iso: string | undefined, now: Date | null) {
  if (!iso || !now) return "";
  const m = Math.round((now.getTime() - Date.parse(iso)) / 60000);
  if (m < 0) return `IN ${fmtDur(-m)}`;
  return m < 1 ? "JUST NOW" : `${fmtDur(m)} AGO`;
}
const fmtDur = (m: number) => (m < 60 ? `${m}M` : m < 48 * 60 ? `${Math.round(m / 60)}H` : `${Math.round(m / 1440)}D`);

async function loginAction(id: string, action: "signed_in" | "remove") {
  await fetch("/api/logins", { method: "POST", body: JSON.stringify({ id, action }) });
}

/* ---------- Home: what needs you ---------- */

export function OpsAlert({ ops, now, onGo, onChanged }: { ops: OpsView; now: Date | null; onGo: (tab: "logins" | "automations") => void; onChanged: () => void }) {
  const logins = ops.logins.filter((l) => l.needsYou);
  const broken = ops.automations.filter((a) => a.health === "failing" || a.health === "missed");
  if (!logins.length && !broken.length) return null;
  return (
    <section className="panel ops-alert" aria-labelledby="ops-alert-title">
      <div className="panel-head">
        <h2 id="ops-alert-title" style={{ color: logins.length ? "var(--red)" : "var(--amber)" }}>
          {logins.length ? `RE-LOGIN NEEDED · ${logins.length}` : "AUTOMATION NEEDS A LOOK"}
        </h2>
        <span className="aside">
          <a href="#logins" onClick={(e) => (e.preventDefault(), onGo(logins.length ? "logins" : "automations"))} style={{ color: "var(--blue-soft)" }}>
            {logins.length ? "ALL LOGINS →" : "ALL AUTOMATIONS →"}
          </a>
        </span>
      </div>
      {logins.map((l) => (
        <LoginRow key={l.id} l={l} now={now} onChanged={onChanged} compact />
      ))}
      {broken.map((a) => (
        <a key={a.id} className="row" href="#automations" onClick={(e) => (e.preventDefault(), onGo("automations"))}>
          <span className="row-main">
            <span className="row-title">{a.name}</span>
            <span className="row-meta">{a.healthNote.toUpperCase()}</span>
          </span>
          <span className="tag" style={{ color: HEALTH[a.health].color }}>
            {HEALTH[a.health].label}
          </span>
        </a>
      ))}
    </section>
  );
}

/* ---------- Logins ---------- */

function LoginRow({ l, now, onChanged, compact, names = {} }: { l: LoginView; now: Date | null; onChanged: () => void; compact?: boolean; names?: Record<string, string> }) {
  const [busy, setBusy] = useState(false);
  const s = LOGIN[l.shown];
  const act = async (action: "signed_in" | "remove") => {
    setBusy(true);
    await loginAction(l.id, action);
    onChanged();
    setBusy(false);
  };
  return (
    <div className={`login-row${l.needsYou ? " needs" : ""}`}>
      <div className="login-main">
        <span className="row-title">{l.name}</span>
        <span className="row-meta">
          {[l.account, l.checkedAt ? `CHECKED ${ago(l.checkedAt, now)}` : null, !compact && l.usedBy.length ? `USED BY ${l.usedBy.map((u) => names[u] ?? u).join(", ").toUpperCase()}` : null]
            .filter(Boolean)
            .join(" · ")}
        </span>
        {l.note && <span className="login-note">{l.note}</span>}
        {l.needsYou && l.howTo && <span className="login-how">{l.howTo}</span>}
      </div>
      <div className="login-actions">
        <span className="tag" style={{ color: s.color }}>
          {s.label}
        </span>
        {l.loginUrl && (
          <a className="btn btn-sm" href={l.loginUrl} {...(l.loginUrl.startsWith("#") ? {} : { target: "_blank", rel: "noreferrer" })}>
            {l.loginUrl.startsWith("#") ? (l.status === "ok" ? "CHANGE" : "SET UP") : l.live ? (l.status === "ok" ? "RECONNECT" : "CONNECT") : "OPEN SITE"}
          </a>
        )}
        {!l.live && (l.needsYou || (!compact && l.shown === "stale")) && (
          <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => act("signed_in")}>
            I SIGNED IN
          </button>
        )}
      </div>
    </div>
  );
}

export function LoginsView({ ops, now, onChanged }: { ops: OpsView; now: Date | null; onChanged: () => void }) {
  const names = Object.fromEntries(ops.automations.map((a) => [a.id, a.name]));
  const needs = ops.logins.filter((l) => l.needsYou).length;
  const ok = ops.logins.filter((l) => l.shown === "ok").length;
  return (
    <>
      <section className="hero">
        <div>
          <h1>Logins</h1>
          <p>
            <strong>{ok}</strong> of {ops.logins.length} confirmed signed in
            {needs ? (
              <>
                {" "}
                · <strong style={{ color: "var(--red)" }}>{needs} need you</strong>
              </>
            ) : null}
            . Each automation checks the sites it visits and reports here.
          </p>
        </div>
      </section>
      <section className="panel" aria-labelledby="logins-title">
        <div className="panel-head">
          <h2 id="logins-title">ACCOUNTS AUTOMATIONS USE</h2>
          <span className="aside">{ops.logins.length} ACCOUNTS</span>
        </div>
        {ops.logins.map((l) => (
          <LoginRow key={l.id} l={l} now={now} onChanged={onChanged} names={names} />
        ))}
      </section>
      <CanvasTokenBox login={ops.logins.find((l) => l.id === "canvas-token")} onChanged={onChanged} />
      <p className="footnote">
        Your passwords are never stored here. Automations only report whether a site let them in. The sync runs in the Claude app&apos;s built-in browser on your
        Mac, so that&apos;s where you sign back in.
      </p>
    </>
  );
}

/** Paste a Canvas access token so the dashboard reads Canvas itself. */
function CanvasTokenBox({ login, onChanged }: { login?: LoginView; onChanged: () => void }) {
  const [token, setToken] = useState("");
  const [state, setState] = useState<{ busy?: boolean; msg?: string; bad?: boolean }>({});
  const working = login?.status === "ok";
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setState({ busy: true });
    const r = await fetch("/api/canvas/token", { method: "POST", body: JSON.stringify({ token }) });
    const body = (await r.json().catch(() => ({}))) as { user?: string; error?: string };
    if (r.ok) {
      setToken("");
      setState({ msg: `Connected as ${body.user}. Canvas now loads straight from Canvas.` });
      onChanged();
    } else setState({ msg: body.error ?? "That didn't work. Try again.", bad: true });
  };
  return (
    <section className="panel" id="canvas-token" aria-labelledby="canvas-token-title">
      <div className="panel-head">
        <h2 id="canvas-token-title">CANVAS ACCESS TOKEN</h2>
        <span className="tag" style={{ color: working ? "var(--teal)" : "var(--red)" }}>
          {working ? "CONNECTED" : login?.status === "expired" ? "TOKEN REJECTED" : "NOT SET UP"}
        </span>
      </div>
      <div className="panel-body">
        <ol className="login-how" style={{ margin: "0 0 12px", paddingLeft: 18, lineHeight: 1.6 }}>
          <li>
            Open{" "}
            <a href="https://canvas.ucdavis.edu/profile/settings" target="_blank" rel="noreferrer" style={{ color: "var(--blue-soft)" }}>
              Canvas → Account → Settings
            </a>{" "}
            and sign in if asked.
          </li>
          <li>Scroll to Approved Integrations and press + NEW ACCESS TOKEN.</li>
          <li>Purpose: Mission Control. Leave the expiry date empty. Press GENERATE TOKEN.</li>
          <li>Copy the long token it shows, paste it below and press SAVE.</li>
        </ol>
        <form onSubmit={save} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            type="password"
            autoComplete="off"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={working ? "Paste a new token to replace it" : "Paste your Canvas token"}
            aria-label="Canvas access token"
            style={{ flex: "1 1 240px", minHeight: 44, padding: "0 12px", background: "transparent", border: "1px solid var(--line-strong)", color: "var(--text)" }}
          />
          <button className="btn btn-primary" type="submit" disabled={state.busy || token.trim().length < 20}>
            {state.busy ? "CHECKING…" : "SAVE"}
          </button>
        </form>
        {state.msg && (
          <p className="row-meta" style={{ marginTop: 8, color: state.bad ? "var(--red)" : "var(--teal)" }}>
            {state.msg}
          </p>
        )}
      </div>
    </section>
  );
}

/* ---------- Automations ---------- */

function AutomationCard({ a, now, fmt }: { a: AutomationView; now: Date | null; fmt: Fmt }) {
  const h = HEALTH[a.health];
  const total = a.week.success + a.week.partial + a.week.failure;
  return (
    <section className="panel auto-card" style={{ borderTopColor: h.color }}>
      <div className="panel-head">
        <h2>{a.name.toUpperCase()}</h2>
        <span className="tag" style={{ color: h.color }}>
          {h.label}
        </span>
      </div>
      <div className="panel-body auto-body">
        {a.description && <p className="auto-desc">{a.description}</p>}
        <dl className="auto-facts">
          <div>
            <dt>LAST RUN</dt>
            <dd>{a.lastRun ? `${ago(a.lastRun.finishedAt ?? a.lastRun.startedAt, now)}` : "—"}</dd>
          </div>
          <div>
            <dt>NEXT</dt>
            <dd>
              {a.nextAt ? fmt(a.nextAt, { weekday: "short", hour: "numeric", minute: "2-digit" }).toUpperCase() : a.schedule?.everyMin ? `EVERY ${a.schedule.everyMin}M` : "—"}
            </dd>
          </div>
          <div>
            <dt>7 DAYS</dt>
            <dd>
              <span style={{ color: "var(--teal)" }}>{a.week.success}</span>
              {a.week.partial ? <span style={{ color: "var(--amber)" }}> · {a.week.partial}</span> : null}
              {a.week.failure ? <span style={{ color: "var(--red)" }}> · {a.week.failure}</span> : null}
            </dd>
          </div>
        </dl>
        {total > 0 && (
          <div className="auto-bar" aria-label={`${a.week.success} succeeded, ${a.week.partial} partial, ${a.week.failure} failed this week`}>
            <span style={{ flex: a.week.success, background: "var(--teal)" }} />
            <span style={{ flex: a.week.partial, background: "var(--amber)" }} />
            <span style={{ flex: a.week.failure, background: "var(--red)" }} />
          </div>
        )}
        <p className="row-meta">{[a.where?.toUpperCase(), a.healthNote.toUpperCase()].filter(Boolean).join(" · ")}</p>
      </div>
    </section>
  );
}

function RunRow({ r, fmt, name }: { r: AutomationRun; fmt: Fmt; name: string }) {
  const s = RUN[r.status];
  const when = fmt(r.startedAt, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).toUpperCase();
  const until = r.count && r.count > 1 && r.finishedAt ? ` – ${fmt(r.finishedAt, { hour: "numeric", minute: "2-digit" }).toUpperCase()}` : "";
  const body = (
    <>
      <span className="run-when mono">
        {when}
        {until}
      </span>
      <span className="row-main">
        <span className="row-title">
          {r.name !== name ? r.name : name}
          {r.count && r.count > 1 ? <span className="run-count"> ×{r.count}</span> : null}
        </span>
        {r.summary && <span className="row-meta run-summary">{r.summary}</span>}
        {r.steps?.length ? <span className="row-meta steps-hint" style={{ color: "var(--blue-soft)" }}>{r.steps.length} STEPS</span> : null}
      </span>
      <span className="tag" style={{ color: s.color }}>
        {s.label}
      </span>
    </>
  );
  if (!r.steps?.length) return <div className="row run-row">{body}</div>;
  return (
    <details className="run-details">
      <summary className="row run-row">{body}</summary>
      <ul className="run-steps">
        {r.steps.map((st, i) => (
          <li key={i}>
            <span style={{ color: st.status === "ok" ? "var(--teal)" : st.status === "failed" ? "var(--red)" : "var(--muted)" }}>
              {st.status === "ok" ? "✓" : st.status === "failed" ? "✕" : "–"}
            </span>{" "}
            {st.name}
            {st.note ? <span className="row-meta"> · {st.note}</span> : null}
          </li>
        ))}
      </ul>
    </details>
  );
}

export function AutomationsView({ ops, now, fmt }: { ops: OpsView; now: Date | null; fmt: Fmt }) {
  const [filter, setFilter] = useState<"all" | "problems" | string>("all");
  const names = useMemo(() => Object.fromEntries(ops.automations.map((a) => [a.id, a.name])), [ops.automations]);
  const runs = ops.runs.filter((r) =>
    filter === "all" ? true : filter === "problems" ? r.status === "failure" || r.status === "partial" : r.automation === filter,
  );
  const day = Date.now() - 86_400_000;
  const last24 = ops.runs.filter((r) => Date.parse(r.startedAt) > day);
  const ok24 = last24.filter((r) => r.status === "success").reduce((n, r) => n + (r.count ?? 1), 0);
  const bad24 = last24.filter((r) => r.status === "failure").length;

  return (
    <>
      <section className="hero">
        <div>
          <h1>Automations</h1>
          <p>
            <strong>{ok24}</strong> successful run{ok24 === 1 ? "" : "s"} in the last 24 hours
            {bad24 ? (
              <>
                {" "}
                · <strong style={{ color: "var(--red)" }}>{bad24} failed</strong>
              </>
            ) : null}{" "}
            · {ops.automations.length} automations
          </p>
        </div>
      </section>

      <div className="grid auto-grid">
        {ops.automations.map((a) => (
          <AutomationCard key={a.id} a={a} now={now} fmt={fmt} />
        ))}
      </div>

      <section className="panel" aria-labelledby="runs-title">
        <div className="panel-head">
          <h2 id="runs-title">RUN LOG</h2>
          <span className="aside chips">
            {[["all", "ALL"], ["problems", "PROBLEMS"], ...ops.automations.map((a) => [a.id, a.name.toUpperCase()])].map(([id, label]) => (
              <button key={id} className={`chip${filter === id ? " on" : ""}`} onClick={() => setFilter(id)}>
                {label}
              </button>
            ))}
          </span>
        </div>
        {runs.length === 0 && (
          <p className="empty">
            {ops.runs.length ? "Nothing matches this filter." : "No runs logged yet. The next Docket sync or Mac collector push will show up here."}
          </p>
        )}
        {runs.map((r) => (
          <RunRow key={r.id} r={r} fmt={fmt} name={names[r.automation] ?? r.automation} />
        ))}
      </section>

      <details className="panel api-note">
        <summary className="panel-head">
          <h2>ADDING A NEW AUTOMATION</h2>
          <span className="aside">FOR CLAUDE · SHOW +</span>
        </summary>
        <div className="panel-body">
          <p className="auto-desc">
            Any job reports in with one request. It shows up here on its first run, and any site it says needs a sign-in goes straight to Logins and the Today page.
          </p>
          <pre className="mono api-snippet">{`POST /api/ingest/run
Authorization: Bearer <INGEST_TOKEN>
{
  "automation": { "id": "job-apply", "name": "Job applications",
                  "schedule": { "times": ["07:00"] } },
  "status": "success" | "partial" | "failure",
  "summary": "Applied to 6 roles",
  "steps":  [{ "name": "LinkedIn", "status": "ok" }],
  "logins": [{ "service": "linkedin", "name": "LinkedIn",
               "status": "ok" | "expired", "loginUrl": "https://linkedin.com" }]
}`}</pre>
        </div>
      </details>
    </>
  );
}
