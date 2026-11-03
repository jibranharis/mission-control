"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export interface FlowNode {
  id: string;
  /** Column, left to right from 0. */
  col: number;
  label: string;
  /** Small caps line above the label, e.g. "MODEL · 62%". */
  kicker?: string;
  sub?: string;
  /** Mono figures along the bottom of the card. */
  stats?: string[];
  color: string;
  url?: string;
}

export interface FlowLink {
  source: string;
  target: string;
  value: number;
}

export interface Flow {
  nodes: FlowNode[];
  links: FlowLink[];
  /** Column headings, e.g. ["PROJECT", "MODEL", "SESSION"]. */
  columns: string[];
  /** Turns a link value into its label, e.g. tokens or dollars. */
  format: (v: number) => string;
}

const CARD_W = 208;
const CARD_MIN_H = 78;
const GAP = 18;
const BAND_MAX = 132;
const HEAD = 30;

interface Placed extends FlowNode {
  x: number;
  y: number;
  h: number;
  value: number;
  band: number;
}

/**
 * A Sankey flow: cards in columns, joined by bands as thick as the volume
 * that flows between them. Pure SVG and HTML, no chart library.
 */
export function FlowSankey({ flow, minWidth = 760 }: { flow: Flow; minWidth?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1000);
  const [hover, setHover] = useState<string | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(minWidth, Math.floor(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [minWidth]);

  const layout = useMemo(() => {
    const cols = Math.max(1, ...flow.nodes.map((n) => n.col + 1));
    const inflow = new Map<string, number>();
    const outflow = new Map<string, number>();
    for (const l of flow.links) {
      outflow.set(l.source, (outflow.get(l.source) ?? 0) + l.value);
      inflow.set(l.target, (inflow.get(l.target) ?? 0) + l.value);
    }
    const value = (id: string) => Math.max(inflow.get(id) ?? 0, outflow.get(id) ?? 0);
    const top = Math.max(1, ...flow.nodes.map((n) => value(n.id)));
    const scale = BAND_MAX / top;
    const band = (v: number) => (v > 0 ? Math.max(2, v * scale) : 0);
    const x = (c: number) => (cols === 1 ? 0 : (c * (width - CARD_W)) / (cols - 1));

    const placed = new Map<string, Placed>();
    let height = 0;
    const columns: Placed[][] = [];
    for (let c = 0; c < cols; c++) {
      const here = flow.nodes.filter((n) => n.col === c);
      let y = HEAD;
      const list = here.map((n) => {
        const v = value(n.id);
        const b = band(v);
        const p: Placed = { ...n, x: x(c), y, h: Math.max(CARD_MIN_H + (n.stats?.length ? 0 : -14), b + 20), value: v, band: b };
        y += p.h + GAP;
        return p;
      });
      columns.push(list);
      height = Math.max(height, y - GAP);
    }
    // Center each column against the tallest one.
    for (const list of columns) {
      const h = list.length ? list.at(-1)!.y + list.at(-1)!.h - HEAD : 0;
      const shift = (height - HEAD - h) / 2;
      for (const p of list) {
        p.y += shift;
        placed.set(p.id, p);
      }
    }

    // Each band leaves its source and enters its target in order, so bands stack without crossing at the cards.
    const outAt = new Map<string, number>();
    const inAt = new Map<string, number>();
    const sorted = [...flow.links].filter((l) => placed.has(l.source) && placed.has(l.target)).sort((a, b) => placed.get(a.target)!.y - placed.get(b.target)!.y);
    const bands = sorted.map((l) => {
      const s = placed.get(l.source)!;
      const t = placed.get(l.target)!;
      const w = band(l.value);
      const so = outAt.get(s.id) ?? 0;
      outAt.set(s.id, so + w);
      const y0 = s.y + (s.h - s.band) / 2 + so;
      return { l, s, t, w, y0 };
    });
    for (const b of [...bands].sort((a, c) => a.s.y - c.s.y)) {
      const ti = inAt.get(b.t.id) ?? 0;
      inAt.set(b.t.id, ti + b.w);
      (b as typeof b & { y1: number }).y1 = b.t.y + (b.t.h - b.t.band) / 2 + ti;
    }
    return { placed: [...placed.values()], bands: bands as (typeof bands[number] & { y1: number })[], height: height + 8, cols, x };
  }, [flow, width]);

  const lit = (b: { l: FlowLink }) => !hover || b.l.source === hover || b.l.target === hover;
  const share = (v: number, of: number) => (of ? `${Math.round((v / of) * 100)}%` : "");

  return (
    <div className="sankey-wrap">
      <div ref={ref} className="sankey" style={{ height: layout.height, minWidth }}>
        {flow.columns.slice(0, layout.cols).map((c, i) => (
          <span key={c} className="sankey-col mono" style={{ left: layout.x(i), width: CARD_W }}>
            {c}
          </span>
        ))}
        <svg width={width} height={layout.height} aria-hidden>
          {layout.bands.map((b) => {
            const x0 = b.s.x + CARD_W;
            const x1 = b.t.x;
            const mx = (x0 + x1) / 2;
            const d = `M${x0},${b.y0} C${mx},${b.y0} ${mx},${b.y1} ${x1},${b.y1} L${x1},${b.y1 + b.w} C${mx},${b.y1 + b.w} ${mx},${b.y0 + b.w} ${x0},${b.y0 + b.w} Z`;
            return (
              <g key={`${b.l.source}>${b.l.target}`} className="sankey-band" style={{ opacity: lit(b) ? 1 : 0.25 }}>
                <path d={d} fill={b.s.color} fillOpacity={0.2} />
                {b.w >= 12 && (
                  <text x={mx} y={(b.y0 + b.y1) / 2 + b.w / 2 + 4} textAnchor="middle" className="sankey-pct">
                    {share(b.l.value, b.s.value)}
                  </text>
                )}
                <title>{`${b.s.label} → ${b.t.label}: ${flow.format(b.l.value)}`}</title>
              </g>
            );
          })}
        </svg>
        {layout.placed.map((n) => {
          const Tag = n.url ? "a" : "div";
          return (
            <Tag
              key={n.id}
              className="sankey-card"
              style={{ left: n.x, top: n.y, width: CARD_W, minHeight: n.h, borderLeftColor: n.color }}
              onMouseEnter={() => setHover(n.id)}
              onMouseLeave={() => setHover(null)}
              {...(n.url ? { href: n.url, target: "_blank", rel: "noreferrer" } : {})}
            >
              {n.kicker && <span className="sk-kicker mono">{n.kicker}</span>}
              <strong className="sk-label">{n.label}</strong>
              {n.sub && <span className="sk-sub">{n.sub}</span>}
              {n.stats?.length ? (
                <span className="sk-stats mono">
                  {n.stats.map((s) => (
                    <span key={s}>{s}</span>
                  ))}
                </span>
              ) : null}
            </Tag>
          );
        })}
      </div>
    </div>
  );
}

/** The color key under a flow: one row per category with its share. */
export function FlowLegend({ rows }: { rows: { label: string; color: string; value: string; pct: number }[] }) {
  if (!rows.length) return null;
  return (
    <div className="sankey-legend">
      <span className="row-meta">DISTRIBUTION</span>
      {rows.map((r) => (
        <div key={r.label} className="legend-row">
          <i style={{ background: r.color }} />
          <span>{r.label}</span>
          <span className="mono">
            {r.value} · {r.pct}%
          </span>
        </div>
      ))}
    </div>
  );
}
