"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  getSmoothStepPath,
  useEdgesState,
  useNodesState,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
} from "@xyflow/react";
import type { ClaudeProject, ClaudeThread, GraphNode, ThreadState } from "@/lib/types";
import { overview, type MapNode, type OverviewColumn } from "@/lib/overview";

/*
 * The project map as a left-to-right flowchart in five stages:
 *   01 AGENT (hexagon) → 02 PROJECTS (rectangles) → 03 ROUTE (diamonds, coloured by the
 *   project's state) → 04 SESSIONS (every thread, in a grid) → 05 OUTPUT (branches, PRs, commits).
 * Line thickness follows tokens used; a dot travels along anything running or waiting on you.
 * Hovering a box lights its whole path and dims the rest.
 */

type Shape = "hex" | "rect" | "diamond" | "session" | "junction" | "output" | "stage";
type MapData = MapNode & { shape: Shape; count?: number; sub?: string; width?: number; dim?: boolean; hot?: boolean } & Record<string, unknown>;
type FlowNode = Node<MapData>;
type FlowData = { mode: "fan" | "straight" | "busIn" | "busOut"; railY?: number; width: number; live?: ThreadState; dim?: boolean; hot?: boolean };
type FlowEdge = Edge<FlowData>;

const X_PROJECT = 230;
const X_DIAMOND = 530;
const X_SESS = 660;
const COLW = 258;
const ROWS = 6;
const ROW = 62;
const LANE_GAP = 56;
const OUT_W = 220;
const OUTPUTS = 4;

const STATE_COLOR: Record<string, string> = {
  running: "var(--blue)",
  needs_you: "var(--amber)",
  done: "var(--teal)",
  failed: "var(--amber)",
  idle: "var(--muted)",
};
const LINE = "#343b44";
const HOT = "#7fa6d9";

function Dot({ state }: { state?: string }) {
  return state && STATE_COLOR[state] ? (
    <span className="live-dot" style={{ background: STATE_COLOR[state], animation: state === "running" ? undefined : "none" }} />
  ) : null;
}

const KIND: Partial<Record<GraphNode["kind"], string>> = { thread: "SESSION", branch: "BRANCH", pr: "PULL REQUEST", commit: "COMMIT" };

function MapNodeView({ data }: NodeProps<FlowNode>) {
  const cls = `fm ${data.shape}${data.dim ? " dim" : ""}${data.hot ? " hot" : ""}${data.url ? " linked" : ""}`;
  const handles = (
    <>
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
    </>
  );
  switch (data.shape) {
    case "stage":
      return (
        <div className="fm stage" style={{ width: data.width }}>
          <span className="stage-n">{data.label}</span>
          <span className="stage-sub">{data.sub}</span>
        </div>
      );
    case "hex":
      return (
        <div className={cls}>
          {handles}
          <div className="hex-body">
            <span className="kind">AGENT</span>
            <strong>{data.label}</strong>
            <span className="meta">{data.meta}</span>
          </div>
        </div>
      );
    case "diamond":
      return (
        <div className={cls} title={data.meta}>
          {handles}
          <i style={{ borderColor: STATE_COLOR[data.state ?? "idle"], background: `color-mix(in srgb, ${STATE_COLOR[data.state ?? "idle"]} 14%, var(--panel))` }} />
          <span className="count">{data.count}</span>
        </div>
      );
    case "junction":
      return <div className={cls}>{handles}</div>;
    case "rect":
      return (
        <div className={cls} title={data.label}>
          {handles}
          <span className="kind">
            <Dot state={data.state} />
            PROJECT
          </span>
          <strong className="label">{data.label}</strong>
          {data.meta && <span className="meta">{data.meta}</span>}
        </div>
      );
    default: {
      const done = data.state === "done" && data.shape === "session";
      return (
        <div className={`${cls}${done ? " finished" : ""}`} title={data.label}>
          {handles}
          <span className="kind">
            <Dot state={data.state} />
            {data.kind === "branch" && data.shape === "session" ? "REPO" : KIND[data.kind] ?? data.kind.toUpperCase()}
            {done && data.meta ? ` · ${String(data.meta).split(" · ").pop()}` : ""}
          </span>
          <span className="label">{data.label}</span>
          {data.meta && !done && <span className="meta">{data.meta}</span>}
        </div>
      );
    }
  }
}

function FlowEdgeView({ id, sourceX, sourceY, targetX, targetY, data }: EdgeProps<FlowEdge>) {
  const d = data!;
  let path: string;
  if (d.mode === "fan") {
    [path] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition: Position.Right, targetPosition: Position.Left, borderRadius: 10 });
  } else if (d.mode === "busIn") {
    path = `M ${sourceX} ${sourceY} H ${sourceX + 18} V ${d.railY} H ${targetX - 14} V ${targetY} H ${targetX}`;
  } else if (d.mode === "busOut") {
    path = `M ${sourceX} ${sourceY} H ${sourceX + 12} V ${d.railY} H ${targetX - 24} V ${targetY} H ${targetX}`;
  } else {
    path = `M ${sourceX} ${sourceY} H ${targetX}`;
  }
  return (
    <g style={{ opacity: d.dim ? 0.16 : 1, transition: "opacity 150ms" }}>
      <path d={path} fill="none" stroke={d.hot ? HOT : LINE} strokeWidth={d.width} strokeLinejoin="round" />
      {d.live && (
        <circle r={Math.max(2.5, d.width / 2 + 1)} fill={STATE_COLOR[d.live]}>
          <animateMotion dur={`${2.2 + (id.length % 7) * 0.25}s`} repeatCount="indefinite" path={path} />
        </circle>
      )}
    </g>
  );
}

const nodeTypes = { map: MapNodeView };
const edgeTypes = { flow: FlowEdgeView };

const isLive = (s?: ThreadState) => s === "running" || s === "needs_you";
const liveOf = (states: (ThreadState | undefined)[]): ThreadState | undefined =>
  states.includes("needs_you") ? "needs_you" : states.includes("running") ? "running" : undefined;

/** What a project produced: pull requests, then branches, else its latest commit. */
function outputsOf(p?: ClaudeProject): GraphNode[] {
  const nodes = p?.graph?.nodes ?? [];
  const prs = nodes.filter((n) => n.kind === "pr").slice(0, 2);
  const out = [...prs, ...nodes.filter((n) => n.kind === "branch").slice(0, OUTPUTS - prs.length)];
  if (!out.length) {
    const c = nodes.find((n) => n.kind === "commit");
    if (c) out.push(c);
  }
  return out;
}

function routeState(c: OverviewColumn): ThreadState {
  const s = c.children.map((n) => n.state);
  if (s.includes("needs_you")) return "needs_you";
  if (s.includes("running")) return "running";
  if (s.some((x) => x && x !== "done")) return "idle";
  return s.length && s.every((x) => x === "done") ? "done" : "idle";
}

function layout(cols: OverviewColumn[], agent: MapNode): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];
  const maxCols = Math.max(1, ...cols.map((c) => Math.ceil(c.children.length / ROWS)));
  const xJunction = X_SESS + maxCols * COLW + 24;
  const xOut = xJunction + 70;
  const maxProject = Math.max(1, ...cols.map((c) => c.project.weight ?? 0));
  const maxSession = Math.max(1, ...cols.flatMap((c) => c.children.map((n) => n.weight ?? 0)));
  const thick = (w: number | undefined, max: number, top = 5) => 1 + top * Math.sqrt(Math.max(0, w ?? 0) / max);
  const push = (n: Omit<FlowNode, "type">) => nodes.push({ ...n, type: "map" } as FlowNode);
  const edge = (source: string, target: string, data: FlowData) => edges.push({ id: `${source}->${target}`, source, target, type: "flow", data });

  let y0 = 0;
  let sessions = 0;
  let open = 0;
  let outputs = 0;
  for (const c of cols) {
    const n = c.children.length;
    const rows = Math.max(1, Math.min(ROWS, n));
    const outs = outputsOf(c.source);
    const laneH = Math.max(rows * ROW, outs.length * ROW, 70);
    const mid = y0 + laneH / 2;
    const pid = c.project.id;
    const did = `${pid}:route`;
    const jid = `${pid}:join`;
    const live = liveOf(c.children.map((x) => x.state));
    const pw = thick(c.project.weight, maxProject);

    push({ id: pid, position: { x: X_PROJECT, y: mid - 32 }, data: { ...c.project, shape: "rect", state: live } });
    push({
      id: did,
      position: { x: X_DIAMOND, y: mid - 30 },
      data: { id: did, kind: "subagent", label: c.project.label, shape: "diamond", state: routeState(c), count: n, meta: `${c.project.label} · ${n} branching off` },
    });
    edge(agent.id, pid, { mode: "fan", width: pw, live });
    edge(pid, did, { mode: "straight", width: pw, live });

    c.children.forEach((child, j) => {
      const col = Math.floor(j / ROWS);
      const row = j % ROWS;
      const childLive = isLive(child.state) ? child.state : undefined;
      push({ id: child.id, position: { x: X_SESS + col * COLW, y: y0 + row * ROW }, data: { ...child, shape: "session" } });
      edge(did, child.id, { mode: "busIn", railY: y0 - 16, width: thick(child.weight, maxSession, 3.5), live: childLive });
      if (outs.length) edge(child.id, jid, { mode: "busOut", railY: y0 + rows * ROW + 6, width: 1, live: childLive });
    });
    sessions += c.children.filter((x) => x.kind === "thread").length;
    open += c.children.filter((x) => x.kind === "thread" && x.state !== "done").length;

    if (outs.length) {
      push({ id: jid, position: { x: xJunction, y: mid - 7 }, data: { id: jid, kind: "subagent", label: "", shape: "junction" } });
      const top = mid - (outs.length * ROW) / 2;
      outs.forEach((o, k) => {
        const oid = `${pid}:out:${o.id}`;
        push({ id: oid, position: { x: xOut, y: top + k * ROW }, data: { ...o, id: oid, shape: "output" } });
        edge(jid, oid, { mode: "fan", width: 1.4 });
      });
      outputs += outs.length;
    }
    y0 += laneH + LANE_GAP;
  }

  const height = Math.max(0, y0 - LANE_GAP);
  push({ id: agent.id, position: { x: 0, y: height / 2 - 44 }, data: { ...agent, shape: "hex" } });

  const stages: [string, string, number, number][] = [
    ["01 · AGENT", "CLAUDE CODE", 0, X_PROJECT],
    ["02 · PROJECTS", `${cols.length} ACTIVE`, X_PROJECT, X_DIAMOND - 10],
    ["03 · ROUTE", "STATE SPLIT", X_DIAMOND - 10, X_SESS],
    ["04 · SESSIONS", `${sessions} TOTAL · ${open} OPEN`, X_SESS, xOut],
    ["05 · OUTPUT", `${outputs} BRANCHES · PRS · COMMITS`, xOut, xOut + OUT_W + 24],
  ];
  for (const [label, sub, x, next] of stages)
    push({
      id: `stage:${label}`,
      position: { x, y: -104 },
      draggable: false,
      selectable: false,
      data: { id: `stage:${label}`, kind: "subagent", label, sub, shape: "stage", width: next - x - 24 },
    });
  return { nodes, edges };
}

/** Everything upstream and downstream of a node: its path from Claude to the output. */
function pathOf(id: string, edges: FlowEdge[]): Set<string> {
  const up = new Map<string, string[]>();
  const down = new Map<string, string[]>();
  for (const e of edges) {
    down.set(e.source, [...(down.get(e.source) ?? []), e.target]);
    up.set(e.target, [...(up.get(e.target) ?? []), e.source]);
  }
  const seen = new Set([id]);
  const walk = (start: string, next: Map<string, string[]>, stop: (n: string) => boolean) => {
    const stack = [start];
    while (stack.length) {
      const cur = stack.pop()!;
      for (const n of next.get(cur) ?? []) {
        if (seen.has(n)) continue;
        seen.add(n);
        if (!stop(n)) stack.push(n);
      }
    }
  };
  // From an output, stop going up at the join so one output doesn't light every session.
  walk(id, up, (n) => id.includes(":out:") && n.endsWith(":join"));
  walk(id, down, () => false);
  return seen;
}

export function OverviewGraph({ projects, threads, height = 640 }: { projects: ClaudeProject[]; threads: ClaudeThread[]; height?: number }) {
  const o = useMemo(() => overview(projects, threads), [projects, threads]);
  const laid = useMemo(() => layout(o.columns, o.agent), [o]);
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<FlowEdge>([]);
  const [hover, setHover] = useState<string | null>(null);
  const flow = useRef<ReactFlowInstance<FlowNode, FlowEdge> | null>(null);
  const shape = useRef("");

  useEffect(() => {
    setNodes(laid.nodes);
    setEdges(laid.edges);
    const key = laid.nodes.map((n) => n.id).join("|");
    if (key !== shape.current) {
      shape.current = key;
      requestAnimationFrame(() => flow.current?.fitView({ padding: 0.05, maxZoom: 1, duration: 200 }));
    }
  }, [laid, setNodes, setEdges]);

  useEffect(() => {
    const lit = hover ? pathOf(hover, laid.edges) : null;
    setNodes((prev) =>
      prev.map((n) => (n.data.shape === "stage" ? n : { ...n, data: { ...n.data, dim: lit ? !lit.has(n.id) : false, hot: lit ? lit.has(n.id) : false } })),
    );
    setEdges((prev) =>
      prev.map((e) => {
        const on = lit ? lit.has(e.source) && lit.has(e.target) : false;
        return { ...e, data: { ...e.data!, dim: lit ? !on : false, hot: on } };
      }),
    );
  }, [hover, laid, setNodes, setEdges]);

  const enter = useCallback((_: unknown, n: FlowNode) => {
    if (n.data.shape !== "stage") setHover(n.id);
  }, []);
  const leave = useCallback(() => setHover(null), []);

  return (
    <div className="graph flowmap" style={{ height }}>
      <ReactFlow<FlowNode, FlowEdge>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeMouseEnter={enter}
        onNodeMouseLeave={leave}
        onInit={(i) => {
          flow.current = i;
          i.fitView({ padding: 0.05, maxZoom: 1 });
        }}
        onNodeClick={(_, n) => n.data.url && window.open(n.data.url, "_blank", "noopener")}
        nodesConnectable={false}
        elementsSelectable={false}
        fitView
        fitViewOptions={{ padding: 0.05, maxZoom: 1 }}
        style={{ background: "transparent" }}
        minZoom={0.12}
        maxZoom={1.6}
        proOptions={{ hideAttribution: true }}
        colorMode="dark"
      >
        <MiniMap
          pannable
          zoomable
          position="bottom-right"
          nodeColor={(n) => {
            const d = n.data as MapData;
            if (d.shape === "stage") return "transparent";
            if (d.shape === "hex") return "#d9dee5";
            if (d.shape === "rect") return "#3b6fb6";
            if (d.state === "needs_you") return "#c99a3c";
            if (d.state === "running") return "#3b6fb6";
            return "#2c333c";
          }}
          maskColor="rgba(8, 10, 13, 0.72)"
          style={{ background: "#0d1014", border: "1px solid #232830", width: 180, height: 110 }}
        />
      </ReactFlow>
    </div>
  );
}
