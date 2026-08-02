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
import { InfraNode } from "@/lib/api";
import { Zone, ZoneEdge } from "@/lib/infraMapViews";

const ZONE_WIDTH = 230;
const ROW_HEIGHT = 26;
const ZONE_HEADER_HEIGHT = 46;
const STANDALONE_WIDTH = 200;
const STANDALONE_HEIGHT = 56;
const ALLOW_COLOR = "#34d399";
const BLOCK_COLOR = "#f87171";

type ZoneData = { title: string; subtitle?: string; members: InfraNode[]; connectable: boolean };

function ZoneCard({ data }: NodeProps<Node<ZoneData>>) {
  const { title, subtitle, members, connectable } = data;
  return (
    <div className="rounded-lg bg-zinc-900/70 border border-zinc-700 px-3 py-2" style={{ width: ZONE_WIDTH }}>
      {connectable && <Handle type="target" position={Position.Left} style={{ background: "#71717a", border: "none" }} />}
      <div className="text-xs font-medium text-zinc-100 truncate">{title}</div>
      {subtitle && <div className="text-[10px] text-zinc-500 font-mono truncate">{subtitle}</div>}
      <div className="space-y-1 mt-1.5">
        {members.length === 0 && <div className="text-[10px] text-zinc-600 italic">Sin nodos</div>}
        {members.map((m) => (
          <div key={m.id} className="flex items-center justify-between bg-zinc-950/60 rounded px-2 py-1">
            <span className="text-[11px] text-zinc-200 truncate">{m.name}</span>
            <span className="text-[10px] text-zinc-500 font-mono ml-2 truncate shrink-0">
              {m.ip_local || m.node_type || "—"}
            </span>
          </div>
        ))}
      </div>
      {connectable && <Handle type="source" position={Position.Right} style={{ background: "#71717a", border: "none" }} />}
    </div>
  );
}

function StandaloneCard({ data }: NodeProps<Node<{ node: InfraNode }>>) {
  const { node } = data;
  return (
    <div className="rounded-lg bg-zinc-900 border border-zinc-800 px-3 py-2" style={{ width: STANDALONE_WIDTH }}>
      <div className="text-xs font-medium text-zinc-100 truncate">{node.name}</div>
      <div className="text-[10px] text-zinc-500 flex items-center gap-1.5 mt-0.5">
        <span className="uppercase tracking-wide">{node.node_type || "—"}</span>
        {node.ip_local && <span className="font-mono text-zinc-400 truncate">{node.ip_local}</span>}
      </div>
    </div>
  );
}

function ZoneEdgeLine({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, style, data }: EdgeProps) {
  const [edgePath] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
  const { label } = (data as { label?: string } | undefined) ?? {};
  return (
    <>
      <BaseEdge id={id} path={edgePath} style={style} />
      <path d={edgePath} fill="none" stroke="transparent" strokeWidth={14} className="cursor-help">
        <title>{label}</title>
      </path>
    </>
  );
}

const nodeTypes = { zone: ZoneCard, standalone: StandaloneCard };
const edgeTypes = { zoneEdge: ZoneEdgeLine };

function zoneSize(memberCount: number): { width: number; height: number } {
  return { width: ZONE_WIDTH, height: ZONE_HEADER_HEIGHT + Math.max(memberCount, 1) * ROW_HEIGHT + 12 };
}

function layout(nodes: Node[], edges: Edge[], sizeOf: (id: string) => { width: number; height: number }): Node[] {
  if (edges.length === 0) {
    let x = 0;
    const GAP = 40;
    return nodes.map((n) => {
      const { width } = sizeOf(n.id);
      const pos = { x, y: 0 };
      x += width + GAP;
      return { ...n, position: pos };
    });
  }
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "LR", nodesep: 60, ranksep: 140 });
  nodes.forEach((n) => g.setNode(n.id, sizeOf(n.id)));
  edges.forEach((e) => g.setEdge(e.source, e.target));
  dagre.layout(g);
  return nodes.map((n) => {
    const pos = g.node(n.id);
    const { width, height } = sizeOf(n.id);
    return { ...n, position: { x: pos.x - width / 2, y: pos.y - height / 2 } };
  });
}

export function InfraZoneGraph({
  zones,
  members,
  standalone = [],
  zoneIdByMemberId,
  zoneEdges = [],
  emptyMessage,
}: {
  zones: Zone[];
  members: InfraNode[];
  standalone?: InfraNode[];
  zoneIdByMemberId: Record<string, string>;
  zoneEdges?: ZoneEdge[];
  emptyMessage: string;
}) {
  const { flowNodes, flowEdges } = useMemo(() => {
    const membersByZone = new Map<string, InfraNode[]>();
    zones.forEach((z) => membersByZone.set(z.id, []));
    members.forEach((m) => {
      const zid = zoneIdByMemberId[m.id];
      if (zid && membersByZone.has(zid)) membersByZone.get(zid)!.push(m);
    });

    const connectableZones = new Set(zoneEdges.flatMap((e) => [e.source, e.target]));

    const sizes = new Map<string, { width: number; height: number }>();
    const zoneNodes: Node[] = zones.map((z) => {
      const zMembers = membersByZone.get(z.id) ?? [];
      const size = zoneSize(zMembers.length);
      sizes.set(z.id, size);
      return {
        id: z.id,
        type: "zone",
        position: { x: 0, y: 0 },
        style: size,
        data: { title: z.title, subtitle: z.subtitle, members: zMembers, connectable: connectableZones.has(z.id) },
      };
    });

    const standaloneNodes: Node[] = standalone.map((n) => {
      sizes.set(n.id, { width: STANDALONE_WIDTH, height: STANDALONE_HEIGHT });
      return {
        id: n.id,
        type: "standalone",
        position: { x: 0, y: 0 },
        style: { width: STANDALONE_WIDTH, height: STANDALONE_HEIGHT },
        data: { node: n },
      };
    });

    const edges: Edge[] = zoneEdges.map((e, i) => ({
      id: `${e.source}-${e.target}-${e.kind}-${i}`,
      source: e.source,
      target: e.target,
      type: "zoneEdge",
      data: { label: e.detail },
      style: { stroke: e.kind === "firewall_allow" ? ALLOW_COLOR : BLOCK_COLOR, strokeWidth: 1.5 },
    }));

    const sizeOf = (id: string) => sizes.get(id) ?? { width: STANDALONE_WIDTH, height: STANDALONE_HEIGHT };
    return { flowNodes: layout([...zoneNodes, ...standaloneNodes], edges, sizeOf), flowEdges: edges };
  }, [zones, members, standalone, zoneIdByMemberId, zoneEdges]);

  if (flowNodes.length === 0) {
    return (
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-8 text-center text-sm text-zinc-500">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {zoneEdges.length > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-zinc-500">
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-0.5 inline-block shrink-0" style={{ background: ALLOW_COLOR }} />
            Firewall permitido
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-0.5 inline-block shrink-0" style={{ background: BLOCK_COLOR }} />
            Firewall bloqueado
          </span>
        </div>
      )}
      <div style={{ height: 500 }} className="bg-zinc-950 border border-zinc-800 rounded-lg overflow-hidden">
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
