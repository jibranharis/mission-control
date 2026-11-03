"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Handle,
  Position,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Edge,
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

const COL = 290;
const PROJECT_Y = 130;
const FIRST_CHILD = 96;
const ROW = 72;
const INDENT = 22;
/** Threads per column before a project wraps into another column. */
const MAX_ROWS = 7;

function OverviewNode({ data }: NodeProps<FlowNode>) {
  const summary = data.kind === "subagent";
  return (
    <div className={`node ${data.kind}${summary ? " fold" : ""}${data.url ? " linked" : ""}`} title={data.label}>
      <Handle id="top" type="target" position={Position.Top} />
      <Handle id="left" type="target" position={Position.Left} />
      <span className="kind">
        {data.state && STATE_COLOR[data.state] && (
          <span className="live-dot" style={{ background: STATE_COLOR[data.state], animation: data.state === "running" ? undefined : "none" }} />
        )}
        {summary ? (data.state === "done" ? "FINISHED" : "MORE") : KIND_LABEL[data.kind]}
      </span>
      <span className="label">{data.label}</span>
      {data.meta && <span className="meta">{data.meta}</span>}
      <Handle id="bottom" type="source" position={Position.Bottom} style={data.kind === "project" ? { left: 12 } : undefined} />
    </div>
  );
}

const nodeTypes = { ov: OverviewNode };

/**
 * Claude on top, one column per project, its threads stacked under it like a file tree.
 * A project with more than MAX_ROWS threads (once a fold is opened) wraps them into extra
 * columns beside it, so the map grows wider instead of into one long off-screen list.
 */
function place(o: Overview): { nodes: FlowNode[]; edges: Edge[] } {
  const spans = o.columns.map((c) => Math.max(1, Math.ceil(c.children.length / MAX_ROWS)));
  const width = spans.reduce((a, b) => a + b, 0) * COL;
  const nodes: FlowNode[] = [{ id: o.agent.id, type: "ov", data: { ...o.agent }, position: { x: Math.max(0, width / 2 - 60), y: 0 } }];
  const edges: Edge[] = [];
  const line = { stroke: "#2e343c", strokeWidth: 1 };
  const edge = (source: string, target: string, sourceHandle: string, targetHandle: string): Edge => ({
    id: `${source}->${target}`,
    source,
    target,
    sourceHandle,
    targetHandle,
    type: "smoothstep",
    pathOptions: { borderRadius: 4 },
    style: line,
  }) as Edge;
  let x = 0;
  o.columns.forEach((c, i) => {
    nodes.push({ id: c.project.id, type: "ov", data: { ...c.project }, position: { x, y: PROJECT_Y } });
    edges.push(edge(o.agent.id, c.project.id, "bottom", "top"));
    c.children.forEach((n, j) => {
      const k = Math.floor(j / MAX_ROWS);
      const r = j % MAX_ROWS;
      nodes.push({ id: n.id, type: "ov", data: { ...n }, position: { x: x + INDENT + k * COL, y: PROJECT_Y + FIRST_CHILD + r * ROW } });
      if (k === 0) edges.push(edge(c.project.id, n.id, "bottom", "left"));
      else if (r === 0) edges.push(edge(c.project.id, n.id, "bottom", "top"));
      else edges.push(edge(c.children[j - 1].id, n.id, "bottom", "top"));
    });
    x += spans[i] * COL;
  });
  return { nodes, edges };
}

export function OverviewGraph({ projects, threads, height = 560 }: { projects: ClaudeProject[]; threads: ClaudeThread[]; height?: number }) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const o = useMemo(() => overview(projects, threads, expanded), [projects, threads, expanded]);
  const laid = useMemo(() => place(o), [o]);
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const flow = useRef<ReactFlowInstance<FlowNode, Edge> | null>(null);
  const shape = useRef("");

  useEffect(() => {
    setNodes(laid.nodes);
    setEdges(laid.edges);
    // Refit only when nodes come or go (a fold opened, a project appeared), not on every refresh.
    const key = laid.nodes.map((n) => n.id).join("|");
    if (key !== shape.current) {
      shape.current = key;
      requestAnimationFrame(() => flow.current?.fitView({ padding: 0.08, maxZoom: 1, duration: 200 }));
    }
  }, [laid, setNodes, setEdges]);

  const onClick = (id: string, url?: string) => {
    const m = /^(.*):(more|done|less)$/.exec(id);
    if (m) {
      setExpanded((prev) => {
        const next = new Set(prev);
        if (m[2] === "less") next.delete(m[1]);
        else next.add(m[1]);
        return next;
      });
    } else if (url) window.open(url, "_blank", "noopener");
  };

  return (
    <div className="graph overview" style={{ height }}>
      <ReactFlow<FlowNode, Edge>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onInit={(i) => {
          flow.current = i;
          i.fitView({ padding: 0.08, maxZoom: 1 });
        }}
        onNodeClick={(_, n) => onClick(n.id, n.data.url)}
        nodesConnectable={false}
        elementsSelectable={false}
        fitView
        fitViewOptions={{ padding: 0.08, maxZoom: 1 }}
        style={{ background: "transparent" }}
        minZoom={0.2}
        maxZoom={1.5}
        proOptions={{ hideAttribution: true }}
        colorMode="dark"
      />
    </div>
  );
}
