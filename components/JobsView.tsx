"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Job, JobStatus, JobsMeta, JobTier } from "@/lib/jobs";

const TIER: Record<JobTier, { label: string; color: string }> = {
  1: { label: "TOP PROGRAM", color: "var(--amber)" },
  2: { label: "INTERNSHIP", color: "var(--blue-soft)" },
  3: { label: "TECH JOB", color: "var(--silver)" },
  4: { label: "PAID JOB", color: "var(--muted)" },
};

const STATUS: Record<JobStatus, { label: string; color: string; note: string }> = {
  ready: { label: "READY TO SUBMIT", color: "var(--teal)", note: "Filled out. Open it, read it over and press Submit." },
  copy: { label: "ANSWERS TO COPY", color: "var(--teal)", note: "The form wouldn't take typing. Copy the answers below into it." },
  link: { label: "LINK ONLY", color: "var(--amber)", note: "The bot couldn't get to the form." },
  new: { label: "FOUND", color: "var(--muted)", note: "" },
  submitted: { label: "SUBMITTED", color: "var(--blue)", note: "" },
  skipped: { label: "SKIPPED", color: "var(--dim)", note: "" },
};

const FILTERS: [string, string][] = [
  ["todo", "READY FOR YOU"],
  ["new", "FOUND"],
  ["submitted", "SUBMITTED"],
  ["skipped", "SKIPPED"],
  ["all", "ALL"],
];

const PAGE = 60;

export function useJobs() {
  const [data, setData] = useState<{ jobs: Job[]; meta: JobsMeta } | null>(null);
  const load = useCallback(async () => {
    const res = await fetch("/api/jobs", { cache: "no-store" });
    if (res.ok) setData(await res.json());
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, 3 * 60_000);
    return () => clearInterval(t);
  }, [load]);
  return { data, load, setData };
}

const isTodo = (j: Job) => j.status === "ready" || j.status === "copy" || j.status === "link";

function dueText(d: string | undefined, tz: string, now: Date | null) {
  if (!d) return "ROLLING";
  const label = new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: tz }).toUpperCase();
  if (!now) return `DUE ${label}`;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(now);
  const days = Math.round((Date.parse(d) - Date.parse(today)) / 86_400_000);
  if (days < 0) return `CLOSED ${label}`;
  if (days === 0) return "DUE TODAY";
  return days <= 14 ? `DUE ${label} · ${days}D` : `DUE ${label}`;
}

/** The line on Today: how many applications are waiting on you. */
export function JobsAlert({ tz, now, onOpen }: { tz: string; now: Date | null; onOpen: () => void }) {
  const { data } = useJobs();
  const todo = (data?.jobs ?? []).filter((j) => j.status === "ready" || j.status === "copy");
  if (!todo.length) return null;
  const soonest = [...todo].sort((a, b) => (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999"))[0];
  return (
    <a
      className="panel jobs-alert"
      href="#jobs"
      onClick={(e) => {
        e.preventDefault();
        onOpen();
      }}
    >
      <span className="row-main">
        <span className="row-title">
          <strong>
            {todo.length} application{todo.length === 1 ? "" : "s"} ready to submit
          </strong>
        </span>
        <span className="row-meta">
          NEXT: {soonest.company.toUpperCase()} · {dueText(soonest.deadline, tz, now)}
        </span>
      </span>
      <span className="row-link">JOB APPLICATIONS →</span>
    </a>
  );
}

export function JobsView({ tz, now }: { tz: string; now: Date | null }) {
  const { data, load, setData } = useJobs();
  const [filter, setFilter] = useState("todo");
  const [tier, setTier] = useState<number | 0>(0);
  const [q, setQ] = useState("");
  const [shown, setShown] = useState(PAGE);
  const [open, setOpen] = useState<string | null>(null);

  const jobs = data?.jobs ?? [];
  // With nothing waiting on you, open on everything found.
  const [picked, setPicked] = useState(false);
  useEffect(() => {
    if (data && !picked) {
      setPicked(true);
      if (!data.jobs.some(isTodo)) setFilter("new");
    }
  }, [data, picked]);
  const counts = useMemo(
    () => ({
      todo: jobs.filter(isTodo).length,
      ready: jobs.filter((j) => j.status === "ready" || j.status === "copy").length,
      new: jobs.filter((j) => j.status === "new").length,
      submitted: jobs.filter((j) => j.status === "submitted").length,
      skipped: jobs.filter((j) => j.status === "skipped").length,
      all: jobs.length,
      top: jobs.filter((j) => j.tier === 1 && j.status !== "skipped").length,
    }),
    [jobs],
  );

  const list = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return jobs.filter(
      (j) =>
        (filter === "all" || (filter === "todo" ? isTodo(j) : j.status === filter)) &&
        (!tier || j.tier === tier) &&
        words.every((w) => `${j.company} ${j.role} ${j.location ?? ""} ${j.source}`.toLowerCase().includes(w)),
    );
  }, [jobs, filter, tier, q]);

  const setStatus = async (id: string, status: JobStatus) => {
    setData((d) => d && { ...d, jobs: d.jobs.map((j) => (j.id === id ? { ...j, status } : j)) });
    await fetch("/api/jobs", { method: "PATCH", body: JSON.stringify({ id, status }) });
    load();
  };

  const meta = data?.meta;
  return (
    <>
      <section className="hero">
        <div>
          <h1>Job applications</h1>
          <p>
            <strong>{counts.ready}</strong> ready to submit · {counts.new} found and waiting · {counts.submitted} submitted · {counts.top} top programs
          </p>
        </div>
        <p className="jobs-sched">
          SEARCHES AT 10 AM AND 8 PM · FILLS UP TO 10 PER RUN · NEVER SUBMITS
          {meta?.lastSearchAt && (
            <>
              <br />
              LAST SEARCH{" "}
              {new Date(meta.lastSearchAt)
                .toLocaleString("en-US", { timeZone: tz, weekday: "short", hour: "numeric", minute: "2-digit" })
                .toUpperCase()}
            </>
          )}
        </p>
      </section>

      <section className="panel" aria-labelledby="jobs-title">
        <div className="panel-head">
          <h2 id="jobs-title">OPENINGS · {list.length}</h2>
          <span className="aside filters">
            {FILTERS.map(([id, label]) => (
              <button key={id} aria-pressed={filter === id} onClick={() => (setFilter(id), setShown(PAGE))}>
                {label} {counts[id as keyof typeof counts] ?? ""}
              </button>
            ))}
          </span>
        </div>
        <div className="panel-body jobs-tools">
          <div className="filters">
            {([0, 1, 2, 3, 4] as const).map((t) => (
              <button key={t} aria-pressed={tier === t} onClick={() => (setTier(t), setShown(PAGE))}>
                {t ? TIER[t].label : "ANY KIND"}
              </button>
            ))}
            <label htmlFor="jobs-search" className="sr-only">
              Search openings
            </label>
            <input id="jobs-search" className="search" placeholder="Search company, role or place..." value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>

        {!data && <p className="empty">Loading…</p>}
        {data && !list.length && (
          <p className="empty">
            {!jobs.length
              ? "Nothing yet. The first search runs at the next 10 AM or 8 PM, and everything it finds shows up here."
              : filter === "todo"
                ? "Nothing waiting on you right now. The bot fills out more at 10 AM and 8 PM."
                : "Nothing matches."}
          </p>
        )}

        {list.slice(0, shown).map((j) => {
          const s = STATUS[j.status];
          const expanded = open === j.id;
          return (
            <div key={j.id} className={`row job-row${j.status === "submitted" || j.status === "skipped" ? " done" : ""}`}>
              <span className="row-main">
                <span className="row-title">
                  <strong>{j.company}</strong> · {j.role}
                </span>
                <span className="row-meta">
                  <span style={{ color: TIER[j.tier].color }}>{TIER[j.tier].label}</span> · {dueText(j.deadline, tz, now)}
                  {j.location ? ` · ${j.location.toUpperCase()}` : ""} · {j.source.toUpperCase()}
                  {j.status !== "new" ? ` · ${j.resume === "product" ? "PRODUCT" : "ENGINEERING"} RESUME` : ""}
                </span>
                {(s.note || j.note) && j.status !== "new" && (
                  <span className="row-note">{[s.note, j.note].filter(Boolean).join(" ")}</span>
                )}
                {expanded && j.answers?.length ? (
                  <div className="job-answers">
                    {j.answers.map((a, i) => (
                      <Answer key={i} q={a.q} a={a.a} />
                    ))}
                  </div>
                ) : null}
                <span className="job-actions">
                  <a className="mini-btn primary" href={j.url} target="_blank" rel="noreferrer">
                    OPEN APPLICATION
                  </a>
                  {j.answers?.length ? (
                    <button className="mini-btn" onClick={() => setOpen(expanded ? null : j.id)}>
                      {expanded ? "HIDE ANSWERS" : `ANSWERS (${j.answers.length})`}
                    </button>
                  ) : null}
                  {j.status === "submitted" || j.status === "skipped" ? (
                    <button className="mini-btn" onClick={() => setStatus(j.id, "new")}>
                      UNDO
                    </button>
                  ) : (
                    <>
                      <button className="mini-btn ok" onClick={() => setStatus(j.id, "submitted")}>
                        I SUBMITTED IT
                      </button>
                      <button className="mini-btn" onClick={() => setStatus(j.id, "skipped")}>
                        SKIP
                      </button>
                    </>
                  )}
                </span>
              </span>
              <span className="tag" style={{ color: s.color }}>
                {s.label}
              </span>
            </div>
          );
        })}
        {list.length > shown && (
          <div className="panel-body">
            <button className="btn btn-sm" onClick={() => setShown((n) => n + PAGE)}>
              SHOW {Math.min(PAGE, list.length - shown)} MORE
            </button>
          </div>
        )}
      </section>
    </>
  );
}

function Answer({ q, a }: { q: string; a: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(a);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked: the text is still selectable */
    }
  };
  return (
    <div className="job-answer">
      <div className="job-answer-head">
        <span className="row-meta">{q.toUpperCase()}</span>
        <button className="mini-btn" onClick={copy}>
          {copied ? "COPIED" : "COPY"}
        </button>
      </div>
      <p>{a}</p>
    </div>
  );
}
