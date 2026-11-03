"use client";

import { useState } from "react";
import { waitingOnYou } from "@/lib/claude";
import type { ClaudeThread, ClaudeWait } from "@/lib/types";

const KIND: Record<ClaudeWait["kind"], string> = {
  permission: "PERMISSION",
  question: "QUESTION",
  plan: "PLAN TO APPROVE",
  review: "REVIEW",
};

function since(iso: string | undefined, now: Date | null) {
  if (!iso || !now) return "";
  const m = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 60_000));
  return m < 1 ? "JUST NOW" : m < 60 ? `${m}M` : m < 24 * 60 ? `${Math.floor(m / 60)}H ${m % 60}M` : `${Math.floor(m / 1440)}D`;
}

/** Where to go to answer: a link for claude.ai sessions, a hint (and the resume command) for ones on the Mac. */
function Where({ t }: { t: ClaudeThread }) {
  const [copied, setCopied] = useState(false);
  if (t.url && /^https:\/\//.test(t.url)) {
    return (
      <a className="btn btn-sm btn-primary waiting-go" href={t.url} target="_blank" rel="noreferrer">
        OPEN →
      </a>
    );
  }
  if (t.origin === "mac" && t.app === "terminal") {
    const cmd = `${t.cwd ? `cd ${JSON.stringify(t.cwd)} && ` : ""}claude --resume ${t.id}`;
    return (
      <button
        type="button"
        className="btn btn-sm waiting-go"
        title={cmd}
        onClick={() => navigator.clipboard?.writeText(cmd).then(() => (setCopied(true), setTimeout(() => setCopied(false), 2000)))}
      >
        {copied ? "COPIED" : "COPY RESUME"}
      </button>
    );
  }
  return <span className="row-meta waiting-go">{t.app === "vscode" ? "IN VS CODE" : "IN THE CLAUDE APP"} · MAC</span>;
}

/** Claude sessions that are stuck until you answer. Sits at the top of Today, with the re-login alerts. */
export function WaitingPanel({ threads, now }: { threads: ClaudeThread[]; now: Date | null }) {
  const waiting = waitingOnYou(threads);
  if (!waiting.length) return null;
  return (
    <section className="panel waiting" aria-labelledby="waiting-title">
      <div className="panel-head">
        <h2 id="waiting-title" style={{ color: "var(--amber)" }}>
          CLAUDE IS WAITING ON YOU · {waiting.length}
        </h2>
        <span className="aside">
          <a href="#claude" style={{ color: "var(--blue-soft)" }}>
            ALL SESSIONS →
          </a>
        </span>
      </div>
      {waiting.map((t) => (
        <div key={t.id} className="row waiting-row">
          <span className="tag" style={{ color: "var(--amber)" }}>
            {KIND[t.waiting?.kind ?? "question"]}
          </span>
          <span className="row-main">
            <span className="row-title">{t.waiting?.text ?? "Needs your reply"}</span>
            <span className="row-meta">
              {t.title.toUpperCase()} · {t.project.toUpperCase()}
              {t.waiting?.since || t.updatedAt ? ` · WAITING ${since(t.waiting?.since ?? t.updatedAt, now)}` : ""}
            </span>
          </span>
          <Where t={t} />
        </div>
      ))}
    </section>
  );
}
