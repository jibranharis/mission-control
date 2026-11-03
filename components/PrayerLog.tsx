"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PRAYERS, PRAYER_ORDER, prayerTimes, type PrayerKey } from "@/lib/deen";
import { prayedCount, streak, type PrayerLog as Log } from "@/lib/prayers";

const NAME = Object.fromEntries(PRAYER_ORDER) as Record<PrayerKey, string>;
const HISTORY_DAYS = 14;

const shift = (key: string, n: number) => {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const label = (key: string, opts: Intl.DateTimeFormatOptions) => new Date(`${key}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", ...opts });

/** Check off the five daily prayers; saved on the server so the laptop and phone agree. */
export function PrayerLog({ today, tz, method, now, time }: { today: string; tz: string; method: string; now: Date; time: (d: Date | string) => string }) {
  const [log, setLog] = useState<Log | null>(null);
  const [error, setError] = useState(false);
  const current = useRef<Log>({});
  const history = useRef<HTMLDivElement>(null);
  // On a phone the grid scrolls sideways; start at today, not two weeks ago.
  useEffect(() => {
    if (history.current) history.current.scrollLeft = history.current.scrollWidth;
  }, [log === null]);
  current.current = log ?? {};

  useEffect(() => {
    let live = true;
    fetch("/api/prayers", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((b: { log: Log }) => live && setLog(b.log ?? {}))
      .catch(() => live && (setLog({}), setError(true)));
    return () => {
      live = false;
    };
  }, []);

  const toggle = useCallback(async (date: string, prayer: PrayerKey) => {
    const day = { ...(current.current[date] ?? {}) };
    const next = !day[prayer];
    if (next) day[prayer] = new Date().toISOString();
    else delete day[prayer];
    current.current = { ...current.current, [date]: day };
    setLog(current.current);
    const res = await fetch("/api/prayers", { method: "POST", body: JSON.stringify({ date, prayer, done: next }) }).catch(() => null);
    if (res?.ok) {
      setError(false);
      setLog(((await res.json()) as { log: Log }).log);
    } else setError(true);
  }, []);

  const pt = prayerTimes(today, tz, method);
  const l = log ?? {};
  const done = prayedCount(l, today);
  const days = Array.from({ length: HISTORY_DAYS }, (_, i) => shift(today, i - HISTORY_DAYS + 1));
  const week = days.slice(-7).reduce((a, d) => a + prayedCount(l, d), 0);
  const run = streak(l, today);

  return (
    <section className="panel" aria-labelledby="prayers-title">
      <div className="panel-head">
        <h2 id="prayers-title">TODAY · PRAYERS</h2>
        <span className="aside">
          {done}/5 · {run ? `${run} DAY STREAK` : "NO STREAK YET"} · {week}/35 THIS WEEK
        </span>
      </div>
      <div className="panel-body">
        <div className="pray-grid">
          {PRAYERS.map((p) => {
            const at = l[today]?.[p];
            const notYet = pt[p] > now;
            return (
              <button
                key={p}
                type="button"
                className={`pray${at ? " on" : ""}`}
                aria-pressed={Boolean(at)}
                disabled={!log || (notYet && !at)}
                onClick={() => toggle(today, p)}
                title={notYet && !at ? `${NAME[p]} begins at ${time(pt[p])}` : at ? `Prayed · checked ${time(at)}` : `Check off ${NAME[p]}`}
              >
                <span className="pray-box" aria-hidden>
                  {at ? "✓" : ""}
                </span>
                <span className="pray-name">{NAME[p]}</span>
                <span className="pray-meta mono">{at ? `PRAYED · ${time(at).toUpperCase()}` : notYet ? `AT ${time(pt[p]).toUpperCase()}` : `SINCE ${time(pt[p]).toUpperCase()}`}</span>
              </button>
            );
          })}
        </div>

        <div ref={history} className="pray-history" role="grid" aria-label={`Prayers checked off over the last ${HISTORY_DAYS} days`}>
          <div className="ph-row" role="row">
            <span className="ph-label" />
            {days.map((d) => (
              <span key={d} className={`ph-day mono${d === today ? " today" : ""}`} role="columnheader">
                {label(d, { weekday: "narrow" })}
                <br />
                {label(d, { day: "numeric" })}
              </span>
            ))}
          </div>
          {PRAYERS.map((p) => (
            <div key={p} className="ph-row" role="row">
              <span className="ph-label mono">{NAME[p].toUpperCase()}</span>
              {days.map((d) => {
                const on = Boolean(l[d]?.[p]);
                const future = d === today && pt[p] > now && !on;
                return (
                  <button
                    key={d}
                    type="button"
                    role="gridcell"
                    className={`ph-cell${on ? " on" : ""}`}
                    aria-pressed={on}
                    aria-label={`${NAME[p]}, ${label(d, { weekday: "long", month: "short", day: "numeric" })}: ${on ? "prayed" : "not checked"}`}
                    disabled={!log || future}
                    onClick={() => toggle(d, p)}
                  />
                );
              })}
            </div>
          ))}
        </div>
        <p className="row-meta">
          {error ? "COULDN'T SAVE · CHECK YOUR CONNECTION AND TAP AGAIN" : "TAP A SQUARE TO LOG A PAST DAY · SAVED ACROSS LAPTOP AND PHONE"}
        </p>
      </div>
    </section>
  );
}
