"use client";

import { useMemo } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  Position,
  Handle,
  BaseEdge,
  getBezierPath,
  type Node,
  type Edge,
  type EdgeProps,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "@dagrejs/dagre";
import { InfraLink, InfraNetwork, InfraNode } from "@/lib/api";

const NODE_WIDTH = 190;
const NODE_HEIGHT = 54;
const ALLOW_COLOR = "#34d399";
const BLOCK_COLOR = "#f87171";

type NetNodeData = { network: InfraNetwork };

function NetworkCard({ data }: NodeProps<Node<NetNodeData>>) {
  const { network } = data;
  return (
    <div className="rounded-lg bg-zinc-900 px-3 py-2 text-left border border-zinc-700" style={{ width: NODE_WIDTH }}>
      <Handle type="target" position={Position.Left} style={{ background: "#71717a", border: "none" }} />
      <div className="text-xs font-medium text-zinc-100 truncate">{network.name}</div>
      <div className="text-[10px] text-zinc-500 font-mono mt-0.5">
        {network.subnet}
        {network.vlan_tag != null && <span className="text-zinc-600"> · VLAN {network.vlan_tag}</span>}
      </div>
      <Handle type="source" position={Position.Right} style={{ background: "#71717a", border: "none" }} />
    </div>
  );
}

function FirewallEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, style, data }: EdgeProps) {
  const [edgePath] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
  const { kindLabel, detail } = (data as { kindLabel?: string; detail?: string } | undefined) ?? {};
  return (
    <>
      <BaseEdge id={id} path={edgePath} style={style} />
      <path d={edgePath} fill="none" stroke="transparent" strokeWidth={14} className="cursor-help">
        <title>{[kindLabel, detail].filter(Boolean).join(" — ")}</title>
      </path>
    </>
  );
}

const nodeTypes = { network: NetworkCard };
const edgeTypes = { firewall: FirewallEdge };

type NetAgg = { source: string; target: string; kind: "firewall_allow" | "firewall_block"; labels: string[] };

function aggregateByNetwork(nodes: InfraNode[], links: InfraLink[]): NetAgg[] {
  const netByNode = new Map(nodes.map((n) => [n.id, n.network_id]));
  const agg = new Map<string, NetAgg>();
  for (const l of links) {
    if (l.kind !== "firewall_allow" && l.kind !== "firewall_block") continue;
    const source = netByNode.get(l.source_node_id);
    const target = netByNode.get(l.target_node_id);
    if (!source || !target || source === target) continue;
    const key = `${source}->${target}->${l.kind}`;
    if (!agg.has(key)) agg.set(key, { source, target, kind: l.kind, labels: [] });
    if (l.label) agg.get(key)!.labels.push(l.label);
  }
  return [...agg.values()];
}

function layoutNodes(nodes: Node[], edges: Edge[]): Node[] {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "LR", nodesep: 40, ranksep: 110 });
  nodes.forEach((n) => g.setNode(n.id, { width: NODE_WIDTH, height: NODE_HEIGHT }));
  edges.forEach((e) => g.setEdge(e.source, e.target));
  dagre.layout(g);
  return nodes.map((n) => {
    const pos = g.node(n.id);
    return { ...n, position: { x: pos.x - NODE_WIDTH / 2, y: pos.y - NODE_HEIGHT / 2 } };
  });
}

export function InfraNetworkFirewallGraph({ nodes: infraNodes, networks, links }: { nodes: InfraNode[]; networks: InfraNetwork[]; links: InfraLink[] }) {
  const { flowNodes, flowEdges } = useMemo(() => {
    const aggregated = aggregateByNetwork(infraNodes, links);
    const usedNetworkIds = new Set(aggregated.flatMap((a) => [a.source, a.target]));
    const relevantNetworks = networks.filter((n) => usedNetworkIds.has(n.id));

    const rfNodes: Node[] = relevantNetworks.map((net) => ({
      id: net.id,
      type: "network",
      position: { x: 0, y: 0 },
      data: { network: net },
    }));

    const rfEdges: Edge[] = aggregated.map((a, i) => ({
      id: `${a.source}-${a.target}-${a.kind}-${i}`,
      source: a.source,
      target: a.target,
      type: "firewall",
      data: {
        kindLabel: a.kind === "firewall_allow" ? "Permitido" : "Bloqueado",
        detail: a.labels.join(" · "),
      },
      style: { stroke: a.kind === "firewall_allow" ? ALLOW_COLOR : BLOCK_COLOR, strokeWidth: 1.5 },
    }));

    return { flowNodes: layoutNodes(rfNodes, rfEdges), flowEdges: rfEdges };
  }, [infraNodes, networks, links]);

  if (flowNodes.length === 0) {
    return (
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-8 text-center text-sm text-zinc-500">
        Sin excepciones de firewall entre redes documentadas como enlaces todavía.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-zinc-500">
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-0.5 inline-block shrink-0" style={{ background: ALLOW_COLOR }} />
          Permitido
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-0.5 inline-block shrink-0" style={{ background: BLOCK_COLOR }} />
          Bloqueado
        </span>
      </div>
      <div style={{ height: 400 }} className="bg-zinc-950 border border-zinc-800 rounded-lg overflow-hidden">
        <ReactFlowProvider>
          <ReactFlow
            nodes={flowNodes}
            edges={flowEdges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            colorMode="dark"
            fitView
            fitViewOptions={{ padding: 0.2 }}
            nodesDraggable
            nodesConnectable={false}
            elementsSelectable={false}
            proOptions={{ hideAttribution: true }}
          >
            <Background color="#27272a" gap={16} />
            <Controls showInteractive={false} />
          </ReactFlow>
        </ReactFlowProvider>
      </div>
    </div>
  );
}
