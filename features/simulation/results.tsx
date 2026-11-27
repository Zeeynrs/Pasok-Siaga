"use client";

import { CircleAlert, Copy, Download, ExternalLink, Info } from "lucide-react";
import type { ReactNode } from "react";
import { EstimateNotice } from "@/components/states";
import { Button } from "@/components/ui/button";
import { buildWhatsAppShareUrl, copyText, downloadCsv, formatWhatsAppOrderMessage, simulationToCsv } from "@/lib/export";
import { formatDate, formatMoney, formatNumber, formatQuantity } from "@/lib/format";
import type { WorkspaceSnapshot as Snapshot } from "@/lib/domain/types";
import { notify } from "@/lib/notify";
import type { SimulationResult, SolverStatus } from "@/lib/types";

const statusText: Record<SolverStatus, { label: string; tone: string }> = {
  OPTIMAL: { label: "Optimal", tone: "good" },
  FEASIBLE: { label: "Layak, optimalitas belum terbukti", tone: "warning" },
  INFEASIBLE: { label: "Tanpa solusi layak", tone: "warning" },
  UNKNOWN: { label: "Belum ada solusi", tone: "warning" },
  MODEL_INVALID: { label: "Model tidak valid", tone: "bad" },
  ERROR: { label: "Solver bermasalah", tone: "bad" },
};

export function SolverLabel({ status }: { status: SolverStatus }) {
  const item = statusText[status];
  return <span className={`tag tag-${item?.tone ?? "warning"}`}>{item?.label ?? status}</span>;
}

export function WarningList({ entries }: { entries: string[] }) {
  if (!entries.length) return null;
  return <ul className="warning-list">{entries.map((text) => <li key={text}><CircleAlert size={17} aria-hidden="true" /><span>{text}</span></li>)}</ul>;
}

function TablePanel({ title, children }: { title: string; children: ReactNode }) {
  return <section className="panel"><header className="panel-heading"><h3>{title}</h3></header>{children}</section>;
}

export function SimulationResults({ result, snapshot }: { result: SimulationResult; snapshot: Snapshot }) {
  const { kpis } = result;
  const suppliers = new Map(snapshot.suppliers.map((item) => [item.id, item.name]));
  const materials = new Map(snapshot.materials.map((item) => [item.id, item]));
  const hasPurchases = result.purchases.some((item) => item.packs > 0);
  const waMessage = kpis ? formatWhatsAppOrderMessage(result, snapshot) : "";

  async function handleCopy() {
    const copied = await copyText(waMessage);
    if (copied) {
      notify.success(
        hasPurchases
          ? "Pesan order WhatsApp disalin ke papan klip."
          : "Ringkasan rencana produksi disalin ke papan klip.",
      );
    } else {
      notify.error("Gagal menyalin teks ke papan klip.");
    }
  }

  function handleDownloadCsv() {
    downloadCsv(`simulasi-${result.scenario_id}.csv`, simulationToCsv(result, snapshot));
    notify.success("Berkas CSV simulasi siap diunduh.");
  }

  return (
    <div className="results" aria-label="Hasil Simulasi">
      <header className="results-heading"><div><h2>Hasil Simulasi</h2><p>Batas waktu pasokan {formatDate(result.cutoff_date)}</p></div><SolverLabel status={result.solver_status} /></header>
      {kpis && (
        <div className="results-actions" role="group" aria-label="Aksi hasil simulasi">
          <Button type="button" variant="outline" size="sm" onClick={() => void handleCopy()}>
            <Copy size={16} aria-hidden="true" /> {hasPurchases ? "Salin Pesan Order (WA)" : "Salin Ringkasan"}
          </Button>
          {hasPurchases && (
            <Button asChild variant="outline" size="sm">
              <a href={buildWhatsAppShareUrl(waMessage)} target="_blank" rel="noopener noreferrer">
                <ExternalLink size={16} aria-hidden="true" /> Buka WhatsApp
              </a>
            </Button>
          )}
          <Button type="button" variant="outline" size="sm" onClick={handleDownloadCsv}>
            <Download size={16} aria-hidden="true" /> Unduh CSV
          </Button>
        </div>
      )}
      <EstimateNotice />
      <WarningList entries={result.warnings} />
      {kpis && <>
        <div className="metric-panel">
          <div><span>Kontribusi sebelum biaya tambahan pasokan</span><strong>{formatMoney(kpis.gross_contribution_idr)}</strong></div>
          <div><span>Biaya tambahan pasokan</span><strong>{formatMoney(kpis.incremental_premium_idr)}</strong></div>
          <div className="metric-emphasis"><span>Estimasi kontribusi setelah biaya tambahan pasokan</span><strong>{formatMoney(kpis.net_contribution_idr)}</strong></div>
        </div>
        <div className="results-grid">
          <TablePanel title="Rencana produksi">
            <table className="data-table"><thead><tr><th scope="col">Produk</th><th scope="col">Produksi</th><th scope="col">Permintaan</th><th scope="col">Kurang</th></tr></thead><tbody>
              {result.production.map((item) => <tr key={item.product_id}><th scope="row">{item.name}</th><td>{formatNumber(item.units)}</td><td>{formatNumber(item.demand_units)}</td><td className={item.unmet_units ? "text-warning" : ""}>{formatNumber(item.unmet_units)}</td></tr>)}
            </tbody></table>
          </TablePanel>
          <TablePanel title="Penggunaan bahan">
            <table className="data-table"><thead><tr><th scope="col">Bahan</th><th scope="col">Terpakai</th><th scope="col">Tersedia</th><th scope="col">Sisa</th></tr></thead><tbody>
              {result.material_usage.map((item) => <tr key={item.material_id}><th scope="row">{item.name}{item.is_bottleneck && <small>Bahan pembatas</small>}</th><td>{formatQuantity(item.used_units, item.base_unit)}</td><td>{formatQuantity(item.available_units, item.base_unit)}</td><td>{formatQuantity(item.remaining_units, item.base_unit)}</td></tr>)}
            </tbody></table>
          </TablePanel>
        </div>
        <TablePanel title="Pembelian alternatif">
          {result.purchases.length ? <table className="data-table purchase-table"><thead><tr><th scope="col">Pemasok / bahan</th><th scope="col">Pak</th><th scope="col">Jumlah</th><th scope="col">Biaya tambahan</th></tr></thead><tbody>
            {result.purchases.map((item) => {
              const material = materials.get(item.material_id);
              return <tr key={item.offer_id}><th scope="row">{suppliers.get(item.supplier_id) ?? item.supplier_id}<small>{material?.name ?? item.material_id}</small></th><td>{formatNumber(item.packs)}</td><td>{material ? formatQuantity(item.base_units, material.base_unit) : formatNumber(item.base_units)}</td><td>{formatMoney(item.incremental_premium_idr)}</td></tr>;
            })}
          </tbody></table> : <p className="panel-body muted">Tidak ada pembelian alternatif yang dipilih untuk skenario ini.</p>}
        </TablePanel>
        {result.explanations.length > 0 && <div className="interpretation"><Info size={20} aria-hidden="true" /><div><h3>Dasar rekomendasi</h3><ul>{result.explanations.map((text) => <li key={text}>{text}</li>)}</ul></div></div>}
      </>}
      {!kpis && <div className="panel panel-body"><p>Rencana produksi belum tersedia untuk skenario ini. Periksa input dan coba lagi.</p></div>}
    </div>
  );
}
