"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ChevronRight, List, Network, Search } from "lucide-react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { Busy } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/workspace";
import { prepareSupplierOutageScenario } from "@/lib/domain/mutations";
import { notify } from "@/lib/notify";
import type { NetworkEdge, NetworkKind, NetworkNode } from "@/lib/types";
import { analyzeNetwork } from "@/lib/view-models";
import { useWorkspace } from "@/lib/workspace-context";
import { WarningList } from "@/features/simulation/results";
import { scenarioLabel } from "@/features/simulation/scenario-picker";
import { edgeLabel, kindLabel, statusLabel } from "./network-labels";

const Graph = dynamic(() => import("./network-canvas").then(({ NetworkCanvas }) => NetworkCanvas), { ssr: false, loading: () => <Busy label="Memuat graf…" /> });
const mobileQuery = "(max-width: 680px)";

function subscribeMobile(notify: () => void) {
  const query = window.matchMedia(mobileQuery);
  query.addEventListener("change", notify);
  return () => query.removeEventListener("change", notify);
}

const isMobile = () => window.matchMedia(mobileQuery).matches;
const mobileOnServer = () => false;

function NetworkDetail({
  node,
  edges,
  allNodes,
  onTestSupplierFailure,
  onAddBackupOffer,
  onOpenSimulator,
}: {
  node?: NetworkNode;
  edges: NetworkEdge[];
  allNodes: NetworkNode[];
  onTestSupplierFailure: (supplierId: string) => void;
  onAddBackupOffer: () => void;
  onOpenSimulator: () => void;
}) {
  const links = node ? edges.filter((edge) => edge.source === node.id || edge.target === node.id) : [];
  return (
    <section className="panel network-detail" aria-label="Detail hubungan" aria-live="polite">
      <header className="panel-heading"><div><h2>Detail node</h2><p>{node ? kindLabel[node.kind] : "Pilih node pada graf atau daftar."}</p></div></header>
      {node && <div className="panel-body">
        <h3>{node.label}</h3>
        <p className="muted">{node.detail}</p>
        <span className={`tag tag-${statusLabel[node.status]?.tone ?? "neutral"}`}>{statusLabel[node.status]?.label ?? node.status}</span>
        {node.overlay && (
          <div className={`detail-overlay detail-overlay-${node.overlay.tone}`}>
            <span className={`tag tag-${node.overlay.tone}`}>{node.overlay.badge}</span>
            <strong>{node.overlay.metric}</strong>
          </div>
        )}
        <h4>Hubungan</h4>
        {links.length ? <ul className="node-links">{links.map((edge) => {
          const related = allNodes.find(({ id }) => id === (edge.source === node.id ? edge.target : edge.source));
          return (
            <li key={edge.id}>
              <strong>{related?.label}</strong>
              <small>
                {edgeLabel[edge.kind]}
                {!edge.active && " · Tidak aktif"}
                {edge.used && edge.overlayLabel ? ` · Dipakai ${edge.overlayLabel}` : ""}
              </small>
            </li>
          );
        })}</ul> : <p className="muted">Belum ada hubungan pemasok atau produk.</p>}
        <div className="detail-actions">
          {node.kind === "supplier" && (
            <Button type="button" size="sm" onClick={() => onTestSupplierFailure(node.entity_id)}>
              Uji jika pemasok ini gagal
            </Button>
          )}
          {node.kind === "material" && (
            <>
              <Button type="button" size="sm" onClick={onAddBackupOffer}>
                Tambah pemasok cadangan
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={onOpenSimulator}>
                Buka Simulator
              </Button>
            </>
          )}
          {node.kind === "product" && (
            <Button type="button" size="sm" onClick={onOpenSimulator}>
              Simulasikan produksi
            </Button>
          )}
        </div>
      </div>}
    </section>
  );
}

function NodeList({ nodes, edges, selected, onSelect }: { nodes: NetworkNode[]; edges: NetworkEdge[]; selected?: string; onSelect: (id: string) => void }) {
  return <div className="node-list">{nodes.map((node) => {
    const related = edges.filter((edge) => edge.source === node.id || edge.target === node.id).length;
    return <button type="button" key={node.id} aria-pressed={selected === node.id} onClick={() => onSelect(node.id)}>
      <div><strong>{node.label}</strong><small>{kindLabel[node.kind]} · {related} hubungan</small></div>
      <div className="node-list-tags">
        <span className={`tag tag-${statusLabel[node.status]?.tone ?? "neutral"}`}>{statusLabel[node.status]?.label ?? node.status}</span>
        {node.overlay && (
          <span className={`tag tag-${node.overlay.tone} node-overlay-tag`}>
            <span>{node.overlay.badge}</span>
            <span>{node.overlay.metric}</span>
          </span>
        )}
      </div>
      <ChevronRight size={17} aria-hidden="true" />
    </button>;
  })}</div>;
}

export function SupplyNetwork() {
  const router = useRouter();
  const { data, setData, scenarios, snapshot, scenario, selectScenario, href, signature, comparison, comparing, runComparison } = useWorkspace();
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<NetworkKind | "all">("all");
  const [view, setView] = useState<"list" | "graph">();
  const [selected, setSelected] = useState<string>();
  const [showOverlay, setShowOverlay] = useState(true);
  const attempted = useRef<string | null>(null);
  const smallScreen = useSyncExternalStore(subscribeMobile, isMobile, mobileOnServer);
  const activeView = view ?? (smallScreen ? "list" : "graph");
  const isEmpty = snapshot.suppliers.length === 0 && snapshot.materials.length === 0 && snapshot.products.length === 0;
  const fresh = comparison !== null && comparison.signature === signature;

  useEffect(() => {
    if (isEmpty || fresh || comparing || attempted.current === signature) return;
    attempted.current = signature;
    void runComparison();
  }, [isEmpty, fresh, comparing, signature, runComparison]);

  const activeSimulation = showOverlay && fresh
    ? comparison.view.results.find((result) => result.scenario_id === scenario.id) ?? null
    : null;
  const network = useMemo(() => analyzeNetwork(snapshot, scenario, activeSimulation), [snapshot, scenario, activeSimulation]);
  const matching = query.trim().toLocaleLowerCase("id-ID");
  const allNodes = network.nodes;
  const allEdges = network.edges;
  const nodes = allNodes.filter((item) => (kind === "all" || item.kind === kind) && (!matching || `${item.label} ${kindLabel[item.kind]}`.toLocaleLowerCase("id-ID").includes(matching)));
  const visibleIds = new Set(nodes.map((node) => node.id));
  const edges = allEdges.filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target));
  const activeNode = nodes.find(({ id }) => id === selected);

  function handleTestSupplierFailure(supplierId: string) {
    const prep = prepareSupplierOutageScenario(data, supplierId);
    if (prep.created || prep.fallbackUpdated) {
      setData(prep.data);
      notify.success(
        prep.created
          ? "Skenario uji gagal pemasok disiapkan."
          : "Skenario gangguan diperbarui untuk menguji pemasok ini.",
      );
    }
    selectScenario(prep.scenarioId);
    router.push(href("/simulator"));
  }

  return (
    <>
      <PageHeader title="Jaringan Pasok" action={
        <label className="network-scenario" data-tour="network-scenario"><span>Skenario jaringan</span><select value={scenario.id} onChange={(event) => selectScenario(event.target.value)}>{scenarios.map((entry) => <option key={entry.id} value={entry.id}>{scenarioLabel(entry)}</option>)}</select></label>
      }>Telusuri hubungan pemasok, bahan baku, dan produk yang bergantung padanya.</PageHeader>
      <div className="network-grid">
        <section className="panel network-panel" data-tour="network-panel">
          <header className="panel-heading network-heading">
            <div className="network-filters">
              <label className="search-field"><Search size={17} aria-hidden="true" /><span className="sr-only">Cari node</span><Input type="search" placeholder="Cari pemasok, bahan, produk…" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
              <label><span className="sr-only">Filter jenis node</span><select value={kind} onChange={(event) => setKind(event.target.value as NetworkKind | "all")}><option value="all">Semua jenis</option><option value="supplier">Pemasok</option><option value="material">Bahan</option><option value="product">Produk</option></select></label>
              <label className="filter-chip network-overlay-toggle">
                <input
                  type="checkbox"
                  checked={showOverlay}
                  onChange={(event) => setShowOverlay(event.target.checked)}
                />
                <span>Tampilkan Dampak Simulasi</span>
              </label>
            </div>
            <div className="view-toggle" role="group" aria-label="Tampilan jaringan">
              <Button type="button" size="sm" variant="ghost" aria-pressed={activeView === "graph"} onClick={() => setView("graph")}><Network size={16} aria-hidden="true" /> Graf</Button>
              <Button type="button" size="sm" variant="ghost" aria-pressed={activeView === "list"} onClick={() => setView("list")}><List size={17} aria-hidden="true" /> Daftar</Button>
            </div>
          </header>
          {nodes.length ? activeView === "graph" ? <Graph key={nodes.map(({ id }) => id).join(",")} nodes={nodes} edges={edges} selected={activeNode?.id} onSelect={setSelected} />
            : <NodeList nodes={nodes} edges={allEdges} selected={activeNode?.id} onSelect={setSelected} />
            : <div className="panel-body muted" role="status">{allNodes.length === 0 ? "Belum ada pemasok, bahan, atau produk. Tambahkan di Data Usaha untuk melihat jaringan." : "Tidak ada node yang cocok. Coba ubah pencarian atau filter."}</div>}
          <div className="network-legend"><span><i className="legend-committed" />Pengiriman terjadwal</span><span><i className="legend-alternative" />Penawaran alternatif</span><span><i className="legend-bom" />Kebutuhan produksi</span><span><i className="legend-inactive" />Tidak aktif</span></div>
        </section>
        <NetworkDetail
          node={activeNode}
          edges={allEdges}
          allNodes={allNodes}
          onTestSupplierFailure={handleTestSupplierFailure}
          onAddBackupOffer={() => router.push(href("/data?focus=offers"))}
          onOpenSimulator={() => router.push(href("/simulator"))}
        />
      </div>
      <WarningList entries={network.warnings} />
    </>
  );
}
