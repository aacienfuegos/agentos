import { InfraLink, InfraNode } from "./api";

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
