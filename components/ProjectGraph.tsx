"use client";

import { useEffect, useMemo } from "react";
import {
  Handle,
  Position,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import type { ClaudeSnapshot, GraphNode } from "@/lib/types";

const POSITIONS_KEY = "mc:graph-positions:v3";
const KIND_LABEL: Record<GraphNode["kind"], string> = {
  agent: "AGENT",
  project: "PROJECT",
  thread: "THREAD",
  subagent: "SUB-AGENT",
  branch: "BRANCH",
  commit: "COMMIT",
  pr: "PULL REQUEST",
  session: "SESSION",
};
const STATE_COLOR: Record<string, string> = {
  running: "var(--blue)",
  needs_you: "var(--amber)",
  done: "var(--teal)",
  failed: "var(--amber)",
};

type FlowNode = Node<GraphNode & Record<string, unknown>>;

function GraphNodeView({ data }: NodeProps<FlowNode>) {
  return (
    <div
      className={`node ${data.kind}${data.url ? " linked" : ""}`}
      title={data.url ? "Click to open" : undefined}
    >
      <Handle type="target" position={Position.Left} />
      <span className="kind">
        {data.state && STATE_COLOR[data.state] && (
          <span className="live-dot" style={{ background: STATE_COLOR[data.state], animation: data.state === "running" ? undefined : "none" }} />
        )}
        {KIND_LABEL[data.kind]}
      </span>
      <span>{data.label}</span>
      {data.meta && <span className="meta">{data.meta}</span>}
      {data.url && <span className="open">OPEN ↗</span>}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

const nodeTypes = { mc: GraphNodeView };

/** Left-to-right tree: one column per generation, leaves stacked, parents centred on their children. */
function layout(graph: ClaudeSnapshot["graph"]): Record<string, { x: number; y: number }> {
  const children = new Map<string, string[]>();
  const hasParent = new Set<string>();
  for (const [a, b] of graph.edges) {
    children.set(a, [...(children.get(a) ?? []), b]);
    hasParent.add(b);
  }
  const pos: Record<string, { x: number; y: number }> = {};
  const seen = new Set<string>();
  let row = 0;
  const place = (id: string, depth: number): number => {
    seen.add(id);
    const kids = (children.get(id) ?? []).filter((k) => !seen.has(k));
    const ys = kids.map((k) => place(k, depth + 1));
    const y = ys.length ? (ys[0] + ys[ys.length - 1]) / 2 : row++ * 84;
    pos[id] = { x: depth * 300, y };
    return y;
  };
  for (const n of graph.nodes) if (!hasParent.has(n.id) && !seen.has(n.id)) place(n.id, 0);
  for (const n of graph.nodes) if (!seen.has(n.id)) place(n.id, 0);
  return pos;
}

function readSaved(): Record<string, { x: number; y: number }> {
  try {
    return JSON.parse(localStorage.getItem(POSITIONS_KEY) ?? "{}");
  } catch {
    return {};
  }
}

export function ProjectGraph({ graph, height }: { graph: ClaudeSnapshot["graph"]; height?: number }) {
  const computed = useMemo(() => layout(graph), [graph]);
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  useEffect(() => {
    const saved = readSaved();
    setNodes(() =>
      graph.nodes.map((n) => ({
        id: n.id,
        type: "mc",
        data: { ...n },
        position: saved[n.id] ?? computed[n.id],
      })),
    );
    setEdges(
      graph.edges.map(([a, b]) => ({
        id: `${a}->${b}`,
        source: a,
        target: b,
        type: "straight",
        style: { stroke: "#2e343c", strokeWidth: 1 },
      })),
    );
  }, [graph, computed, setNodes, setEdges]);

  const savePositions = (_: unknown, node: FlowNode) => {
    try {
      const all = readSaved();
      all[node.id] = node.position;
      // Keep the saved layout bounded: forget the oldest positions past a few hundred nodes.
      const keys = Object.keys(all);
      for (const k of keys.slice(0, Math.max(0, keys.length - 400))) delete all[k];
      localStorage.setItem(POSITIONS_KEY, JSON.stringify(all));
    } catch {
      /* storage unavailable */
    }
  };

  return (
    <div className="graph" style={height ? { height } : undefined}>
      <ReactFlow<FlowNode, Edge>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDragStop={savePositions}
        onNodeClick={(_, n) => n.data.url && window.open(n.data.url, "_blank", "noopener")}
        nodesConnectable={false}
        elementsSelectable={false}
        fitView
        fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
        style={{ background: "transparent" }}
        minZoom={0.3}
        maxZoom={1.5}
        proOptions={{ hideAttribution: true }}
        colorMode="dark"
      />
    </div>
  );
}
