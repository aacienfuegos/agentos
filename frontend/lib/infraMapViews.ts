import { InfraLink, InfraNetwork, InfraNode } from "./api";

const TRAFFIC_KINDS = new Set(["proxies_to", "forward_auth", "dns_rewrite"]);

function filterByKind(nodes: InfraNode[], links: InfraLink[], keep: (kind: string) => boolean) {
  const filteredLinks = links.filter((l) => keep(l.kind));
  const usedIds = new Set(filteredLinks.flatMap((l) => [l.source_node_id, l.target_node_id]));
  return { nodes: nodes.filter((n) => usedIds.has(n.id)), links: filteredLinks };
}

export function trafficView(nodes: InfraNode[], links: InfraLink[]) {
  return filterByKind(nodes, links, (k) => TRAFFIC_KINDS.has(k));
}

export function tailscaleView(nodes: InfraNode[], links: InfraLink[]) {
  return filterByKind(nodes, links, (k) => k === "tailscale");
}

export type Zone = { id: string; title: string; subtitle?: string };

export type ZoneEdge = { source: string; target: string; kind: "firewall_allow" | "firewall_block"; detail?: string };

export function networksAsZones(networks: InfraNetwork[]): Zone[] {
  return networks.map((n) => ({
    id: n.id,
    title: n.name,
    subtitle: `${n.subnet}${n.vlan_tag != null ? ` · VLAN ${n.vlan_tag}` : ""}`,
  }));
}

export function hostZonesFrom(nodes: InfraNode[]): Zone[] {
  const parentIds = new Set(nodes.filter((n) => n.parent_id).map((n) => n.parent_id as string));
  return nodes
    .filter((n) => parentIds.has(n.id))
    .map((n) => ({ id: n.id, title: n.name, subtitle: n.ip_local || n.node_type || undefined }));
}

export function groupNodesByZone(
  nodes: InfraNode[],
  zones: Zone[],
  zoneOf: (node: InfraNode) => string | null | undefined
) {
  const zoneIds = new Set(zones.map((z) => z.id));
  const members: InfraNode[] = [];
  const standalone: InfraNode[] = [];
  const zoneIdByMemberId: Record<string, string> = {};
  for (const n of nodes) {
    if (zoneIds.has(n.id)) continue;
    const z = zoneOf(n);
    if (z && zoneIds.has(z)) {
      members.push(n);
      zoneIdByMemberId[n.id] = z;
    } else {
      standalone.push(n);
    }
  }
  return { members, standalone, zoneIdByMemberId };
}

export function aggregateFirewallByNetwork(nodes: InfraNode[], links: InfraLink[]): ZoneEdge[] {
  const netByNode = new Map(nodes.map((n) => [n.id, n.network_id]));
  const agg = new Map<string, { source: string; target: string; kind: "firewall_allow" | "firewall_block"; labels: string[] }>();
  for (const l of links) {
    if (l.kind !== "firewall_allow" && l.kind !== "firewall_block") continue;
    const source = netByNode.get(l.source_node_id);
    const target = netByNode.get(l.target_node_id);
    if (!source || !target || source === target) continue;
    const key = `${source}->${target}->${l.kind}`;
    if (!agg.has(key)) agg.set(key, { source, target, kind: l.kind, labels: [] });
    if (l.label) agg.get(key)!.labels.push(l.label);
  }
  return [...agg.values()].map((a) => ({ source: a.source, target: a.target, kind: a.kind, detail: a.labels.join(" · ") }));
}
