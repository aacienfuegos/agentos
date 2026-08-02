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
  getBezierPath,
  type Node,
  type Edge,
  type EdgeProps,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "@dagrejs/dagre";
import { InfraNode, InfraNetwork, InfraLink } from "@/lib/api";

const NODE_WIDTH = 200;
const NODE_HEIGHT = 56;

const NETWORK_COLORS = ["#a78bfa", "#38bdf8", "#fbbf24", "#34d399", "#f472b6", "#fb923c", "#818cf8"];
const NEUTRAL_COLOR = "#52525b";

const EDGE_KIND_STYLE: Record<string, { color: string; label: string }> = {
  proxies_to: { color: "#a78bfa", label: "Proxy inverso" },
  forward_auth: { color: "#c4b5fd", label: "Forward-auth" },
  tailscale: { color: "#38bdf8", label: "Tailscale" },
  firewall_allow: { color: "#34d399", label: "Firewall permitido" },
  wazuh_agent: { color: "#2dd4bf", label: "Agente Wazuh" },
  firewall_block: { color: "#f87171", label: "Firewall bloqueado" },
  dns_rewrite: { color: "#fbbf24", label: "DNS rewrite" },
};
const DEFAULT_EDGE_STYLE = { color: "#71717a", label: "Otro" };

type InfraNodeData = { node: InfraNode; color: string; parentName?: string };

function InfraNodeCard({ data }: NodeProps<Node<InfraNodeData>>) {
  const { node, color, parentName } = data;
  return (
    <div
      className="rounded-lg bg-zinc-900 px-3 py-2 text-left"
      style={{ width: NODE_WIDTH, border: `1.5px solid ${color}` }}
    >
      <Handle type="target" position={Position.Left} style={{ background: color, border: "none" }} />
      <div className="text-xs font-medium text-zinc-100 truncate">{node.name}</div>
      <div className="text-[10px] text-zinc-500 flex items-center gap-1.5 mt-0.5">
        <span className="uppercase tracking-wide">{node.node_type || "—"}</span>
        {node.ip_local && <span className="font-mono text-zinc-400 truncate">{node.ip_local}</span>}
      </div>
      {parentName && <div className="text-[10px] text-zinc-600 truncate mt-0.5">en {parentName}</div>}
      <Handle type="source" position={Position.Right} style={{ background: color, border: "none" }} />
    </div>
  );
}

// Sin etiqueta permanente en el lienzo — con más de una decena de enlaces
// convergiendo en un par de nodos (Traefik, Wazuh), texto siempre visible
// se solapa y se vuelve ilegible. El color ya identifica el tipo (leyenda
// debajo del grafo); el detalle completo aparece como tooltip nativo al
// pasar el ratón, sobre una franja invisible más ancha que el trazo visible
// para que sea fácil de acertar con el cursor.
function InfraEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, style, data }: EdgeProps) {
  const [edgePath] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
  const { kind, fullLabel } = (data as { kind?: string; fullLabel?: string } | undefined) ?? {};
  const kindLabel = kind ? (EDGE_KIND_STYLE[kind]?.label ?? kind) : undefined;
  return (
    <>
      <BaseEdge id={id} path={edgePath} style={style} />
      <path d={edgePath} fill="none" stroke="transparent" strokeWidth={14} className="cursor-help">
        <title>{[kindLabel, fullLabel].filter(Boolean).join(" — ")}</title>
      </path>
    </>
  );
}

const nodeTypes = { infraNode: InfraNodeCard };
const edgeTypes = { infraEdge: InfraEdge };

function layoutNodes(nodes: Node[], edges: Edge[]): Node[] {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  // LR (izquierda→derecha) aprovecha mejor el ancho de pantalla que TB para
  // un grafo con nodos "hub" (Traefik, Wazuh) con muchas conexiones — y se
  // parece más al diagrama de flujo de tráfico de la documentación
  // (Internet → Router → Traefik → servicio). nodesep/ranksep generosos
  // para dejar sitio a las curvas de los enlaces sin amontonarse.
  g.setGraph({ rankdir: "LR", nodesep: 50, ranksep: 130 });
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
  const { flowNodes, flowEdges, networkLegend, kindLegend } = useMemo(() => {
    const colorByNetwork = new Map<string, string>();
    networks.forEach((net, i) => colorByNetwork.set(net.id, NETWORK_COLORS[i % NETWORK_COLORS.length]));
    const nameById = new Map(infraNodes.map((n) => [n.id, n.name]));

    const rfNodes: Node[] = infraNodes.map((n) => ({
      id: n.id,
      type: "infraNode",
      position: { x: 0, y: 0 },
      data: {
        node: n,
        color: n.network_id ? colorByNetwork.get(n.network_id) ?? NEUTRAL_COLOR : NEUTRAL_COLOR,
        // Enlaces padre→hijo (host físico → sus VMs/LXCs) no se dibujan como
        // aristas: con un solo host y 6+ hijos, esas líneas en diagonal
        // cruzaban todo el grafo sin aportar más que "vive en el mismo
        // sitio". Se muestra como texto en la propia tarjeta en su lugar.
        parentName: n.parent_id ? nameById.get(n.parent_id) : undefined,
      },
    }));

    const usedKinds = new Set<string>();
    const linkEdges: Edge[] = links.map((l) => {
      const kindStyle = EDGE_KIND_STYLE[l.kind] ?? DEFAULT_EDGE_STYLE;
      usedKinds.add(l.kind || "__other__");
      return {
        id: l.id,
        source: l.source_node_id,
        target: l.target_node_id,
        type: "infraEdge",
        data: { kind: l.kind, fullLabel: l.label },
        style: { stroke: kindStyle.color, strokeWidth: 1.5 },
      };
    });

    return {
      flowNodes: layoutNodes(rfNodes, linkEdges),
      flowEdges: linkEdges,
      networkLegend: networks.map((net, i) => ({ name: net.name, color: NETWORK_COLORS[i % NETWORK_COLORS.length] })),
      kindLegend: [...usedKinds].map((k) => EDGE_KIND_STYLE[k] ?? { ...DEFAULT_EDGE_STYLE, label: k }),
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
        <span className="text-zinc-600">Redes:</span>
        {networkLegend.map((l) => (
          <span key={l.name} className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full inline-block shrink-0" style={{ background: l.color }} />
            {l.name}
          </span>
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-zinc-500">
        <span className="text-zinc-600">Enlaces:</span>
        {kindLegend.map((l) => (
          <span key={l.label} className="flex items-center gap-1.5">
            <span className="w-3 h-0.5 inline-block shrink-0" style={{ background: l.color }} />
            {l.label}
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
            colorMode="dark"
            fitView
            fitViewOptions={{ padding: 0.15 }}
            nodesDraggable
            nodesConnectable={false}
            elementsSelectable={false}
            proOptions={{ hideAttribution: true }}
          >
            <Background color="#27272a" gap={16} />
            <Controls showInteractive={false} />
            <MiniMap
              position="top-right"
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
