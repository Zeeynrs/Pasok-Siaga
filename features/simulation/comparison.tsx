"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Download, Info, Play } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { Busy, ErrorState, EstimateNotice } from "@/components/states";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/workspace";
import { comparisonToCsv, downloadCsv } from "@/lib/export";
import { formatMoney, formatPercent } from "@/lib/format";
import { notify } from "@/lib/notify";
import type { ComparisonResult } from "@/lib/types";
import { recomputeComparisonView, type ComparisonRoles } from "@/lib/view-models";
import { useWorkspace } from "@/lib/workspace-context";
import { SolverLabel, WarningList } from "./results";
import { scenarioLabel } from "./scenario-picker";
import { StressTestPanel } from "./stress-test-panel";

const Chart = dynamic(() => import("./comparison-chart").then(({ ComparisonChart }) => ComparisonChart), { ssr: false, loading: () => <Busy label="Memuat grafik…" /> });
const shortNames: Record<string, string> = { baseline: "Normal", outage: "Gangguan", mitigation: "Mitigasi" };

const DEFAULT_ROLES: ComparisonRoles = {
  baselineId: "baseline",
  outageId: "outage",
  mitigationId: "mitigation",
};

const ROLE_FIELDS: { key: keyof ComparisonRoles; label: string; fallbackIndex: number }[] = [
  { key: "baselineId", label: "Acuan Normal", fallbackIndex: 0 },
  { key: "outageId", label: "Skenario Gangguan", fallbackIndex: 1 },
  { key: "mitigationId", label: "Skenario Mitigasi", fallbackIndex: 2 },
];

function resolveRoleId(
  selected: string,
  preferred: string,
  fallbackIndex: number,
  results: ComparisonResult["results"],
  availableIds: Set<string>,
): string {
  if (availableIds.has(selected)) return selected;
  if (availableIds.has(preferred)) return preferred;
  return results[fallbackIndex]?.scenario_id ?? results[0]?.scenario_id ?? selected;
}

function ComparisonControls({
  results,
  roles,
  visibleIds,
  onChangeRoles,
  onToggleVisible,
}: {
  results: ComparisonResult["results"];
  roles: ComparisonRoles;
  visibleIds: string[];
  onChangeRoles: (next: ComparisonRoles) => void;
  onToggleVisible: (id: string, visible: boolean) => void;
}) {
  const baseId = useId();
  const visibleSet = new Set(visibleIds);
  const filterLabelId = `${baseId}-filter-label`;

  return (
    <section className="panel comparison-controls" aria-labelledby={`${baseId}-heading`}>
      <header className="panel-heading">
        <div>
          <h2 id={`${baseId}-heading`}>Atur Pembanding</h2>
          <p>Pilih peran skenario untuk KPI pemulihan dan saring skenario pada tabel serta grafik.</p>
        </div>
      </header>
      <div className="panel-body">
        <div className="parameter-fields comparison-roles">
          {ROLE_FIELDS.map(({ key, label }) => {
            const selectId = `${baseId}-${key}`;
            return (
              <div className="field" key={key}>
                <label htmlFor={selectId}>{label}</label>
                <select
                  id={selectId}
                  value={roles[key]}
                  onChange={(event) => onChangeRoles({ ...roles, [key]: event.target.value })}
                >
                  {results.map((item) => (
                    <option key={item.scenario_id} value={item.scenario_id}>
                      {scenarioLabel({ id: item.scenario_id, name: item.scenario_name })}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>
        <div className="parameter-section" role="group" aria-labelledby={filterLabelId}>
          <span id={filterLabelId} className="comparison-filter-label">
            Tampilkan skenario
          </span>
          <div className="comparison-filter-chips">
            {results.map((item) => {
              const checked = visibleSet.has(item.scenario_id);
              const isLastVisible = checked && visibleIds.length <= 1;
              return (
                <label key={item.scenario_id} className="filter-chip">
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={isLastVisible}
                    onChange={(event) => onToggleVisible(item.scenario_id, event.target.checked)}
                  />
                  <span>{scenarioLabel({ id: item.scenario_id, name: item.scenario_name })}</span>
                </label>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

function ComparisonDetails({ outcome }: { outcome: ComparisonResult }) {
  const lookup = new Map(outcome.results.map((item) => [item.scenario_id, shortNames[item.scenario_id] ?? item.scenario_name]));
  const bars = outcome.results.map((item) => ({ label: lookup.get(item.scenario_id) ?? item.scenario_name, contribution: item.kpis?.net_contribution_idr ?? null }));
  return (
    <>
      <div className="metric-panel comparison-metrics" data-tour="comparison-metrics">
        <div><span>Kontribusi yang berisiko hilang</span><strong>{formatMoney(outcome.contribution_at_risk_idr)}</strong></div>
        <div><span>Kontribusi yang dipulihkan</span><strong>{formatMoney(outcome.recovered_contribution_idr)}</strong></div>
        <div className="metric-emphasis"><span>Persentase pemulihan</span><strong>{formatPercent(outcome.recovery_pct)}</strong></div>
      </div>
      <WarningList entries={outcome.warnings} />
      <section className="panel comparison-panel">
        <header className="panel-heading"><div><h2>Estimasi kontribusi setelah biaya tambahan pasokan</h2><p>Perbandingan menggunakan stok, permintaan, dan kapasitas yang sama.</p></div></header>
        {bars.some((item) => item.contribution !== null) && <Chart data={bars} />}
        <table className="data-table comparison-table"><thead><tr><th scope="col">Skenario</th><th scope="col">Status solver</th><th scope="col">Estimasi kontribusi</th></tr></thead><tbody>
          {outcome.results.map((item) => <tr key={item.scenario_id}><th scope="row">{scenarioLabel({ id: item.scenario_id, name: item.scenario_name })}</th><td><SolverLabel status={item.solver_status} /></td><td>{formatMoney(item.kpis?.net_contribution_idr ?? null)}</td></tr>)}
        </tbody></table>
      </section>
      <div className="dashboard-grid comparison-details">
        <section className="panel">
          <header className="panel-heading"><div><h2>Perubahan antar skenario</h2><p>Selisih terhadap skenario awal pada setiap pasangan.</p></div></header>
          <table className="data-table comparison-table"><thead><tr><th scope="col">Peralihan</th><th scope="col">Selisih</th><th scope="col">Perubahan</th></tr></thead><tbody>
            {outcome.deltas.map((item) => <tr key={`${item.from_scenario_id}-${item.to_scenario_id}`}><th scope="row">{lookup.get(item.from_scenario_id)} → {lookup.get(item.to_scenario_id)}</th><td>{formatMoney(item.net_contribution_delta_idr)}</td><td>{formatPercent(item.net_contribution_delta_pct)}</td></tr>)}
          </tbody></table>
        </section>
        <div className="interpretation comparison-interpretation"><Info size={20} aria-hidden="true" /><div><h2>Cara membaca pemulihan</h2><p>Kontribusi yang berisiko hilang adalah selisih positif antara kondisi normal dan gangguan. Kontribusi yang dipulihkan adalah selisih antara mitigasi dan gangguan, setelah biaya tambahan pasokan.</p><p>Persentase pemulihan membagi nilai yang dipulihkan dengan nilai yang berisiko hilang. Jika tidak ada kontribusi yang hilang, persentase tidak berlaku.</p>{(outcome.recovered_contribution_idr ?? 0) < 0 && <p>Dalam perhitungan ini, kontribusi skenario mitigasi lebih rendah daripada skenario gangguan.</p>}</div></div>
      </div>
    </>
  );
}

export function Comparison() {
  const { data, comparison, comparing, comparisonError, signature, runComparison, href } = useWorkspace();
  const attempted = useRef<string | null>(null);
  const fresh = comparison !== null && comparison.signature === signature;
  const [roles, setRoles] = useState<ComparisonRoles>(DEFAULT_ROLES);
  const [hiddenIds, setHiddenIds] = useState<string[]>([]);

  // Hitung otomatis setiap kali data berubah (satu kali per signature agar galat tidak berulang tanpa henti).
  useEffect(() => {
    if (fresh || comparing || attempted.current === signature) return;
    attempted.current = signature;
    void runComparison();
  }, [fresh, comparing, signature, runComparison]);

  const rawResults = useMemo(() => comparison?.view.results ?? [], [comparison]);
  const availableIds = useMemo(() => new Set(rawResults.map((item) => item.scenario_id)), [rawResults]);

  const effectiveRoles = useMemo<ComparisonRoles>(() => ({
    baselineId: resolveRoleId(roles.baselineId, DEFAULT_ROLES.baselineId, 0, rawResults, availableIds),
    outageId: resolveRoleId(roles.outageId, DEFAULT_ROLES.outageId, 1, rawResults, availableIds),
    mitigationId: resolveRoleId(roles.mitigationId, DEFAULT_ROLES.mitigationId, 2, rawResults, availableIds),
  }), [roles, rawResults, availableIds]);

  const visibleIds = useMemo(() => {
    const hiddenSet = new Set(hiddenIds);
    const active = rawResults.map((item) => item.scenario_id).filter((id) => !hiddenSet.has(id));
    return active.length > 0 ? active : rawResults.map((item) => item.scenario_id);
  }, [rawResults, hiddenIds]);

  const displayed = useMemo(() => {
    if (!comparison) return null;
    return recomputeComparisonView(comparison.view, effectiveRoles, visibleIds);
  }, [comparison, effectiveRoles, visibleIds]);

  function handleToggleVisible(id: string, visible: boolean) {
    setHiddenIds((prev) => {
      if (visible) return prev.filter((item) => item !== id);
      if (visibleIds.length <= 1 && visibleIds.includes(id)) return prev;
      return prev.includes(id) ? prev : [...prev, id];
    });
  }

  function handleDownloadCsv() {
    if (!fresh || !displayed) return;
    downloadCsv("perbandingan-skenario.csv", comparisonToCsv(displayed));
    notify.success("Berkas CSV perbandingan siap diunduh.");
  }

  return (
    <>
      <PageHeader
        title="Perbandingan Skenario"
        action={
          <div className="comparison-header-actions">
            {!comparing && fresh && displayed && (
              <Button type="button" variant="outline" onClick={handleDownloadCsv}>
                <Download size={17} aria-hidden="true" /> Unduh CSV
              </Button>
            )}
            <Button asChild variant="outline">
              <Link href={href("/simulator")}><Play size={17} aria-hidden="true" /> Buka Simulator</Link>
            </Button>
          </div>
        }
      >
        Bandingkan kondisi normal, gangguan, dan mitigasi berdasarkan input sesi ini.
      </PageHeader>
      <EstimateNotice />
      {comparing && <Busy label="Menghitung perbandingan skenario…" />}
      {!comparing && comparisonError && !fresh && <ErrorState message={comparisonError} retry={() => void runComparison()} />}
      {!comparing && fresh && displayed && (
        <>
          <ComparisonControls
            results={rawResults}
            roles={effectiveRoles}
            visibleIds={visibleIds}
            onChangeRoles={setRoles}
            onToggleVisible={handleToggleVisible}
          />
          <ComparisonDetails outcome={displayed} />
          <StressTestPanel data={data} signature={signature} />
        </>
      )}
    </>
  );
}
