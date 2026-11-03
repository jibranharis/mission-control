"use client";

import { useEffect, useMemo, useRef } from "react";
import {
  BaseEdge,
  Handle,
  Position,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
} from "@xyflow/react";
import type { ClaudeProject, ClaudeThread, GraphNode } from "@/lib/types";
import { overview, type Overview } from "@/lib/overview";

const KIND_LABEL: Partial<Record<GraphNode["kind"], string>> = {
  agent: "AGENT",
  project: "PROJECT",
  thread: "THREAD",
  branch: "REPO",
};
const STATE_COLOR: Record<string, string> = {
  running: "var(--blue)",
  needs_you: "var(--amber)",
  done: "var(--teal)",
  failed: "var(--amber)",
  idle: "var(--muted)",
};

type FlowNode = Node<GraphNode & Record<string, unknown>>;
type RailEdge = Edge<{ railX: number; railY: number }>;

const COL = 290;
const PROJECT_Y = 130;
const FIRST_CHILD = 96;
/** Vertical space for an open thread and for a finished one (finished ones are compact). */
const ROW_OPEN = 72;
const ROW_DONE = 52;
const INDENT = 22;
/** How tall a project's column grows before its threads wrap into another column beside it. */
const MAX_COLUMN = 620;

function OverviewNode({ data }: NodeProps<FlowNode>) {
  const done = data.kind === "thread" && data.state === "done";
  return (
    <div className={`node ${data.kind}${done ? " finished" : ""}${data.url ? " linked" : ""}`} title={data.label}>
      <Handle id="top" type="target" position={Position.Top} />
      <Handle id="left" type="target" position={Position.Left} />
      <span className="kind">
        {data.state && STATE_COLOR[data.state] && (
          <span className="live-dot" style={{ background: STATE_COLOR[data.state], animation: data.state === "running" ? undefined : "none" }} />
        )}
        {done ? `FINISHED${data.meta ? " · " + String(data.meta).split(" · ").pop() : ""}` : KIND_LABEL[data.kind]}
      </span>
      <span className="label">{data.label}</span>
      {data.meta && !done && <span className="meta">{data.meta}</span>}
      <Handle id="bottom" type="source" position={Position.Bottom} style={data.kind === "project" ? { left: 12 } : undefined} />
    </div>
  );
}

/**
 * A tree branch: down from the project to a rail running above its threads, across to the
 * thread's sub-column, down beside the threads, then into the thread from the left.
 * Branches to the same sub-column share their lines, so they read as one trunk.
 */
function RailEdgeView({ sourceX, sourceY, targetX, targetY, data, style }: EdgeProps<RailEdge>) {
  const railY = data?.railY ?? sourceY + 20;
  const railX = data?.railX ?? sourceX;
  const r = 4;
  const d =
    Math.abs(railX - sourceX) < 1
      ? `M ${sourceX} ${sourceY} V ${targetY - r} Q ${railX} ${targetY} ${railX + r} ${targetY} H ${targetX}`
      : `M ${sourceX} ${sourceY} V ${railY} H ${railX} V ${targetY - r} Q ${railX} ${targetY} ${railX + r} ${targetY} H ${targetX}`;
  return <BaseEdge path={d} style={style} />;
}

const nodeTypes = { ov: OverviewNode };
const edgeTypes = { rail: RailEdgeView };

/**
 * Claude on top, one column per project, every thread branching off under it like a file tree.
 * A long list wraps into extra sub-columns beside its project, so the map grows wider
 * instead of into one long off-screen column.
 */
function place(o: Overview): { nodes: FlowNode[]; edges: Edge[] } {
  const line = { stroke: "#2e343c", strokeWidth: 1 };
  const nodes: FlowNode[] = [];
  const edges: Edge[] = [];
  let x = 0;
  for (const c of o.columns) {
    nodes.push({ id: c.project.id, type: "ov", data: { ...c.project }, position: { x, y: PROJECT_Y } });
    edges.push({ id: `agent->${c.project.id}`, source: o.agent.id, target: c.project.id, sourceHandle: "bottom", targetHandle: "top", type: "smoothstep", style: line });
    let k = 0;
    let y = 0;
    for (const n of c.children) {
      const h = n.kind === "thread" && n.state === "done" ? ROW_DONE : ROW_OPEN;
      if (y > 0 && y + h > MAX_COLUMN) {
        k++;
        y = 0;
      }
      const nx = x + INDENT + k * COL;
      nodes.push({ id: n.id, type: "ov", data: { ...n }, position: { x: nx, y: PROJECT_Y + FIRST_CHILD + y } });
      edges.push({
        id: `${c.project.id}->${n.id}`,
        source: c.project.id,
        target: n.id,
        sourceHandle: "bottom",
        targetHandle: "left",
        type: "rail",
        data: { railX: nx - 10, railY: PROJECT_Y + FIRST_CHILD - 16 },
        style: line,
      } as RailEdge);
      y += h;
    }
    x += (k + 1) * COL;
  }
  nodes.unshift({ id: o.agent.id, type: "ov", data: { ...o.agent }, position: { x: Math.max(0, x / 2 - 60), y: 0 } });
  return { nodes, edges };
}

export function OverviewGraph({ projects, threads, height = 600 }: { projects: ClaudeProject[]; threads: ClaudeThread[]; height?: number }) {
  const o = useMemo(() => overview(projects, threads), [projects, threads]);
  const laid = useMemo(() => place(o), [o]);
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const flow = useRef<ReactFlowInstance<FlowNode, Edge> | null>(null);
  const shape = useRef("");

  useEffect(() => {
    setNodes(laid.nodes);
    setEdges(laid.edges);
    // Refit only when nodes come or go (a new thread or project), not on every refresh.
    const key = laid.nodes.map((n) => n.id).join("|");
    if (key !== shape.current) {
      shape.current = key;
      requestAnimationFrame(() => flow.current?.fitView({ padding: 0.06, maxZoom: 1, duration: 200 }));
    }
  }, [laid, setNodes, setEdges]);

  return (
    <div className="graph overview" style={{ height }}>
      <ReactFlow<FlowNode, Edge>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onInit={(i) => {
          flow.current = i;
          i.fitView({ padding: 0.06, maxZoom: 1 });
        }}
        onNodeClick={(_, n) => n.data.url && window.open(n.data.url, "_blank", "noopener")}
        nodesConnectable={false}
        elementsSelectable={false}
        fitView
        fitViewOptions={{ padding: 0.06, maxZoom: 1 }}
        style={{ background: "transparent" }}
        minZoom={0.15}
        maxZoom={1.5}
        proOptions={{ hideAttribution: true }}
        colorMode="dark"
      />
    </div>
  );
}
