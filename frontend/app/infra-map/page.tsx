"use client";

import { useEffect, useState } from "react";
import { api, InfraMap, InfraNode, InfraService } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { InfraTopologyGraph } from "@/components/InfraTopologyGraph";
import { InfraZoneGraph } from "@/components/InfraZoneGraph";
import {
  trafficView,
  tailscaleView,
  networksAsZones,
  hostZonesFrom,
  groupNodesByZone,
  aggregateFirewallByNetwork,
} from "@/lib/infraMapViews";

const NODE_TYPE_LABEL: Record<string, string> = {
  host: "Host físico",
  vm: "VM",
  lxc: "LXC",
  device: "Dispositivo",
};

function groupByLocation(nodes: InfraNode[]): Map<string, InfraNode[]> {
  const groups = new Map<string, InfraNode[]>();
  for (const node of nodes) {
    const key = node.location || "Sin ubicación";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(node);
  }
  return groups;
}

export default function InfraMapPage() {
  const [data, setData] = useState<InfraMap | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      setData(await api.infraMap.get());
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    setError(null);
    try {
      const run = await api.infraMap.refresh();
      window.location.href = `/runs/${run.run_id}`;
    } catch (e) {
      setError(String(e));
      setRefreshing(false);
    }
  };

  if (loading) {
    return <p className="text-sm text-zinc-500">Cargando…</p>;
  }

  const networkName = (id: string | null) =>
    data?.networks.find((n) => n.id === id)?.name ?? null;

  const servicesByNode = new Map<string, InfraService[]>();
  const orphanServices: InfraService[] = [];
  for (const service of data?.services ?? []) {
    if (service.node_id) {
      if (!servicesByNode.has(service.node_id)) servicesByNode.set(service.node_id, []);
      servicesByNode.get(service.node_id)!.push(service);
    } else {
      orphanServices.push(service);
    }
  }

  const groups = groupByLocation(data?.nodes ?? []);
  const traffic = trafficView(data?.nodes ?? [], data?.links ?? []);
  const tailscale = tailscaleView(data?.nodes ?? [], data?.links ?? []);

  const networkZones = networksAsZones(data?.networks ?? []);
  const networkGrouping = groupNodesByZone(data?.nodes ?? [], networkZones, (n) => n.network_id);
  const networkFirewallEdges = aggregateFirewallByNetwork(data?.nodes ?? [], data?.links ?? []);

  const hostZones = hostZonesFrom(data?.nodes ?? []);
  const hostGrouping = groupNodesByZone(data?.nodes ?? [], hostZones, (n) => n.parent_id);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-zinc-100">Mapa de infraestructura</h1>
          <p className="text-xs text-zinc-500 mt-0.5">
            Extraído de la documentación en{" "}
            <code className="text-zinc-400">~/docu/homelab</code> — solo lectura.
          </p>
        </div>
        <Button className="bg-violet-600 hover:bg-violet-700" size="sm" onClick={handleRefresh} disabled={refreshing}>
          {refreshing ? "Lanzando…" : "Actualizar"}
        </Button>
      </div>

      {error && (
        <div className="bg-red-950/40 border border-red-900/60 text-red-300 text-xs rounded-lg px-4 py-3">
          {error}
        </div>
      )}

      {data?.last_refresh && (
        <p className="text-xs text-zinc-600">
          Última extracción: <span className="text-zinc-400">{data.last_refresh.status}</span>
          {data.last_refresh.finished_at && ` · ${new Date(data.last_refresh.finished_at).toLocaleString("es-ES")}`}
          {" · "}
          <a href={`/runs/${data.last_refresh.run_id}`} className="text-violet-400 hover:underline">ver run</a>
        </p>
      )}

      {groups.size === 0 ? (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-8 text-center text-sm text-zinc-500">
          Sin datos de infraestructura todavía. Pulsa &ldquo;Actualizar&rdquo; para extraerlos de la documentación.
        </div>
      ) : (
        <Tabs defaultValue="traffic">
          <TabsList variant="line">
            <TabsTrigger value="traffic">Flujo de tráfico</TabsTrigger>
            <TabsTrigger value="tailscale">Red privada</TabsTrigger>
            <TabsTrigger value="networks">Redes</TabsTrigger>
            <TabsTrigger value="virtualization">Virtualización</TabsTrigger>
            <TabsTrigger value="topology">Todo</TabsTrigger>
            <TabsTrigger value="cards">Tarjetas</TabsTrigger>
          </TabsList>

          <TabsContent value="traffic" className="mt-3 space-y-2">
            <p className="text-xs text-zinc-500">Cómo llega una petición desde fuera hasta cada servicio: proxy inverso, forward-auth y reescrituras DNS.</p>
            <InfraTopologyGraph nodes={traffic.nodes} networks={data?.networks ?? []} links={traffic.links} />
          </TabsContent>

          <TabsContent value="tailscale" className="mt-3 space-y-2">
            <p className="text-xs text-zinc-500">Qué nodos se alcanzan entre sí vía Tailscale, sin depender de la red local — incluye el subnet router y el exit node.</p>
            <InfraTopologyGraph nodes={tailscale.nodes} networks={data?.networks ?? []} links={tailscale.links} />
          </TabsContent>

          <TabsContent value="networks" className="mt-3 space-y-2">
            <p className="text-xs text-zinc-500">Qué nodos viven en cada red/VLAN, y qué excepciones de firewall existen entre ellas — no es la política general completa, solo lo capturado explícitamente.</p>
            <InfraZoneGraph
              zones={networkZones}
              members={networkGrouping.members}
              standalone={networkGrouping.standalone}
              zoneIdByMemberId={networkGrouping.zoneIdByMemberId}
              zoneEdges={networkFirewallEdges}
              emptyMessage="Sin redes documentadas todavía."
            />
          </TabsContent>

          <TabsContent value="virtualization" className="mt-3 space-y-2">
            <p className="text-xs text-zinc-500">Qué máquinas virtuales y contenedores corren en cada host físico.</p>
            <InfraZoneGraph
              zones={hostZones}
              members={hostGrouping.members}
              standalone={hostGrouping.standalone}
              zoneIdByMemberId={hostGrouping.zoneIdByMemberId}
              emptyMessage="Sin jerarquía de host documentada todavía."
            />
          </TabsContent>

          <TabsContent value="topology" className="mt-3 space-y-2">
            <p className="text-xs text-zinc-500">Todas las relaciones a la vez — útil para explorar, pero mezcla tráfico, VPN, firewall y seguridad en un mismo grafo.</p>
            <InfraTopologyGraph nodes={data?.nodes ?? []} networks={data?.networks ?? []} links={data?.links ?? []} />
          </TabsContent>

          <TabsContent value="cards" className="mt-3 space-y-4">
            {[...groups.entries()].map(([location, nodes]) => (
              <div key={location} className="space-y-2">
                <h2 className="text-sm font-medium text-zinc-400">{location}</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {nodes.map((node) => (
                    <Card key={node.id} className="bg-zinc-900 border-zinc-800">
                      <CardHeader className="pb-2">
                        <div className="flex items-center justify-between gap-2">
                          <CardTitle className="text-sm font-medium text-zinc-100">{node.name}</CardTitle>
                          <Badge variant="outline" className="text-zinc-400 border-zinc-700 shrink-0">
                            {NODE_TYPE_LABEL[node.node_type] ?? (node.node_type || "—")}
                          </Badge>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-2 text-xs text-zinc-500">
                        {node.role && <p className="text-zinc-400">{node.role}</p>}
                        {(node.ip_local || node.ip_tailscale) && (
                          <p className="font-mono">
                            {node.ip_local}
                            {node.ip_tailscale && <span className="text-zinc-600"> · ts: {node.ip_tailscale}</span>}
                          </p>
                        )}
                        {networkName(node.network_id) && (
                          <Badge variant="secondary" className="bg-zinc-800 text-zinc-400">
                            {networkName(node.network_id)}
                          </Badge>
                        )}
                        {node.status && <p className="text-zinc-600">{node.status}</p>}
                        {(servicesByNode.get(node.id) ?? []).length > 0 && (
                          <div className="pt-2 border-t border-zinc-800 space-y-1">
                            {servicesByNode.get(node.id)!.map((s) => (
                              <div key={s.id} className="flex items-center justify-between">
                                <span className="text-zinc-300">{s.name}</span>
                                {s.domain && <span className="text-zinc-600 font-mono truncate ml-2">{s.domain}</span>}
                              </div>
                            ))}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            ))}

            {orphanServices.length > 0 && (
              <div className="space-y-2">
                <h2 className="text-sm font-medium text-zinc-400">Otros servicios</h2>
                <div className="bg-zinc-900 border border-zinc-800 rounded-lg divide-y divide-zinc-800">
                  {orphanServices.map((s) => (
                    <div key={s.id} className="px-4 py-2 flex items-center justify-between text-sm">
                      <span className="text-zinc-200">{s.name}</span>
                      <span className="text-zinc-600 text-xs">{s.category}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
