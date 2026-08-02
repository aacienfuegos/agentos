"use client";

import { useMemo } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  Position,
  Handle,
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type Node,
  type Edge,
  type EdgeProps,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "@dagrejs/dagre";
import { InfraNode, InfraNetwork, InfraLink } from "@/lib/api";

const NODE_WIDTH = 210;
const NODE_HEIGHT = 60;

const NETWORK_COLORS = ["#a78bfa", "#38bdf8", "#fbbf24", "#34d399", "#f472b6", "#fb923c", "#818cf8"];
const NEUTRAL_COLOR = "#52525b";

const EDGE_KIND_COLOR: Record<string, string> = {
  proxies_to: "#a78bfa",
  forward_auth: "#a78bfa",
  tailscale: "#38bdf8",
  firewall_allow: "#34d399",
  wazuh_agent: "#34d399",
  firewall_block: "#f87171",
  dns_rewrite: "#fbbf24",
};

type InfraNodeData = { node: InfraNode; color: string };

function InfraNodeCard({ data }: NodeProps<Node<InfraNodeData>>) {
  const { node, color } = data;
  return (
    <div
      className="rounded-lg bg-zinc-900 px-3 py-2 text-left"
      style={{ width: NODE_WIDTH, border: `1.5px solid ${color}` }}
    >
      <Handle type="target" position={Position.Top} style={{ background: color, border: "none" }} />
      <div className="text-xs font-medium text-zinc-100 truncate">{node.name}</div>
      <div className="text-[10px] text-zinc-500 flex items-center gap-1.5 mt-0.5">
        <span className="uppercase tracking-wide">{node.node_type || "—"}</span>
        {node.ip_local && <span className="font-mono text-zinc-400">{node.ip_local}</span>}
      </div>
      <Handle type="source" position={Position.Bottom} style={{ background: color, border: "none" }} />
    </div>
  );
}

function LabeledEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, style, label, data }: EdgeProps) {
  const [edgePath, labelX, labelY] = getSmoothStepPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
  const fullLabel = (data as { fullLabel?: string } | undefined)?.fullLabel;
  return (
    <>
      <BaseEdge id={id} path={edgePath} style={style} />
      {label && (
        <EdgeLabelRenderer>
          <div
            title={fullLabel || String(label)}
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: "all",
            }}
            className="bg-zinc-950 border border-zinc-800 rounded px-1.5 py-0.5 text-[9px] text-zinc-400 cursor-help"
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const nodeTypes = { infraNode: InfraNodeCard };
const edgeTypes = { labeled: LabeledEdge };

function layoutNodes(nodes: Node[], edges: Edge[]): Node[] {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "TB", nodesep: 32, ranksep: 70 });
  nodes.forEach((n) => g.setNode(n.id, { width: NODE_WIDTH, height: NODE_HEIGHT }));
  edges.forEach((e) => g.setEdge(e.source, e.target));
  dagre.layout(g);
  return nodes.map((n) => {
    const pos = g.node(n.id);
    return { ...n, position: { x: pos.x - NODE_WIDTH / 2, y: pos.y - NODE_HEIGHT / 2 } };
  });
}

export function InfraTopologyGraph({
  nodes: infraNodes,
  networks,
  links,
}: {
  nodes: InfraNode[];
  networks: InfraNetwork[];
  links: InfraLink[];
}) {
  const { flowNodes, flowEdges, legend } = useMemo(() => {
    const colorByNetwork = new Map<string, string>();
    networks.forEach((net, i) => colorByNetwork.set(net.id, NETWORK_COLORS[i % NETWORK_COLORS.length]));

    const rfNodes: Node[] = infraNodes.map((n) => ({
      id: n.id,
      type: "infraNode",
      position: { x: 0, y: 0 },
      data: { node: n, color: n.network_id ? colorByNetwork.get(n.network_id) ?? NEUTRAL_COLOR : NEUTRAL_COLOR },
    }));

    const parentEdges: Edge[] = infraNodes
      .filter((n) => n.parent_id)
      .map((n) => ({
        id: `parent-${n.id}`,
        source: n.parent_id as string,
        target: n.id,
        style: { stroke: "#3f3f46", strokeDasharray: "3 3" },
      }));

    const linkEdges: Edge[] = links.map((l) => ({
      id: l.id,
      source: l.source_node_id,
      target: l.target_node_id,
      type: "labeled",
      label: l.kind,
      data: { fullLabel: l.label },
      style: { stroke: EDGE_KIND_COLOR[l.kind] ?? "#71717a" },
    }));

    const allEdges = [...parentEdges, ...linkEdges];
    return {
      flowNodes: layoutNodes(rfNodes, allEdges),
      flowEdges: allEdges,
      legend: networks.map((net, i) => ({ name: net.name, color: NETWORK_COLORS[i % NETWORK_COLORS.length] })),
    };
  }, [infraNodes, networks, links]);

  if (infraNodes.length === 0) {
    return (
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-8 text-center text-sm text-zinc-500">
        Sin datos de infraestructura todavía.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-zinc-500">
        {legend.map((l) => (
          <span key={l.name} className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: l.color }} />
            {l.name}
          </span>
        ))}
      </div>
      <div style={{ height: 640 }} className="bg-zinc-950 border border-zinc-800 rounded-lg overflow-hidden">
        <ReactFlowProvider>
          <ReactFlow
            nodes={flowNodes}
            edges={flowEdges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            fitView
            nodesDraggable
            nodesConnectable={false}
            elementsSelectable={false}
            proOptions={{ hideAttribution: true }}
          >
            <Background color="#27272a" gap={16} />
            <Controls showInteractive={false} />
            <MiniMap
              pannable
              zoomable
              maskColor="rgba(9, 9, 11, 0.7)"
              style={{ background: "#18181b" }}
              nodeColor={(n) => (n.data as InfraNodeData).color}
            />
          </ReactFlow>
        </ReactFlowProvider>
      </div>
    </div>
  );
}
