"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Activity, CircleAlert, Play, RotateCcw } from "lucide-react";
import dynamic from "next/dynamic";
import { Busy, ErrorState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { runStressTestPreview } from "@/lib/api";
import type { ScenarioConfig, WorkspaceData } from "@/lib/domain/types";
import { formatMoney, formatNumber } from "@/lib/format";
import { notify } from "@/lib/notify";
import { resolveScenarioInputs } from "@/lib/solver/inputs";
import type { OfferBreakeven, StressTestResult } from "@/lib/solver/stress-test";
import { scenarioLabel } from "./scenario-picker";

const StressDelayChart = dynamic(
  () => import("./stress-test-chart").then(({ StressDelayChart }) => StressDelayChart),
  { ssr: false, loading: () => <Busy label="Memuat grafik keterlambatan…" /> },
);

const StressPremiumChart = dynamic(
  () => import("./stress-test-chart").then(({ StressPremiumChart }) => StressPremiumChart),
  { ssr: false, loading: () => <Busy label="Memuat grafik titik impas…" /> },
);

interface StressRunState {
  signature: string;
  delayScenarioId: string;
  offerScenarioId: string;
  result?: StressTestResult;
  error?: string;
}

function defaultDelayScenarioId(scenarios: ScenarioConfig[]): string {
  return scenarios.find((s) => s.id === "baseline")?.id ?? scenarios[0]?.id ?? "";
}

function defaultOfferScenarioId(scenarios: ScenarioConfig[]): string {
  return (
    scenarios.find((s) => s.id === "mitigation")?.id ??
    scenarios.find((s) => s.enabled_offer_ids.length > 0)?.id ??
    scenarios[0]?.id ??
    ""
  );
}

function resolveScenarioId(selected: string, fallback: string, scenarios: ScenarioConfig[]): string {
  return scenarios.some((s) => s.id === selected) ? selected : fallback;
}

function OfferBreakevenCard({ offer }: { offer: OfferBreakeven }) {
  const chartData = offer.points.map((pt) => ({
    premiumLabel: formatMoney(pt.premium_idr),
    contribution: pt.net_contribution_idr,
    packs: pt.packs_bought,
  }));

  return (
    <article className="panel stress-offer-card">
      <header className="panel-heading">
        <div>
          <h3>{offer.supplier_name} — {offer.material_name}</h3>
          <p>Batas kenaikan premi per pak sebelum penawaran tidak lagi menguntungkan.</p>
        </div>
        <span className={`tag ${offer.max_viable_premium_idr !== null ? "tag-good" : "tag-warning"}`}>
          {offer.max_viable_premium_idr !== null
            ? `Maks ${formatMoney(offer.max_viable_premium_idr)}`
            : "Tidak terpakai"}
        </span>
      </header>
      <div className="panel-body">
        <div className="metric-panel stress-offer-metrics">
          <div>
            <span>Premi saat ini</span>
            <strong>{formatMoney(offer.current_premium_idr)}</strong>
          </div>
          <div>
            <span>Batas premi maksimal</span>
            <strong>
              {offer.max_viable_premium_idr !== null ? formatMoney(offer.max_viable_premium_idr) : "Tidak layak"}
            </strong>
          </div>
          <div className="metric-emphasis">
            <span>Ruang kenaikan premi</span>
            <strong>{formatMoney(offer.headroom_idr)}</strong>
          </div>
        </div>
        {offer.max_viable_premium_idr === null && (
          <p className="muted">
            Penawaran ini tidak dipilih solver bahkan pada premi Rp 0 karena stok atau pasokan utama sudah mencukupi.
          </p>
        )}
        {chartData.some((pt) => pt.contribution !== null) && <StressPremiumChart data={chartData} />}
      </div>
    </article>
  );
}

/**
 * Panel uji ketahanan keterlambatan pengiriman dan titik impas premi penawaran alternatif.
 * Dijalankan hanya atas permintaan pengguna melalui tombol (tanpa auto-run saat mount).
 */
export function StressTestPanel({ data, signature }: { data: WorkspaceData; signature: string }) {
  const baseId = useId();
  const controllerRef = useRef<AbortController | null>(null);
  const [pending, setPending] = useState(false);
  const [selectedDelayId, setSelectedDelayId] = useState(() => defaultDelayScenarioId(data.scenarios));
  const [selectedOfferId, setSelectedOfferId] = useState(() => defaultOfferScenarioId(data.scenarios));
  const [completed, setCompleted] = useState<StressRunState | null>(null);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const effectiveDelayId = useMemo(
    () => resolveScenarioId(selectedDelayId, defaultDelayScenarioId(data.scenarios), data.scenarios),
    [selectedDelayId, data.scenarios],
  );
  const effectiveOfferId = useMemo(
    () => resolveScenarioId(selectedOfferId, defaultOfferScenarioId(data.scenarios), data.scenarios),
    [selectedOfferId, data.scenarios],
  );

  const result = completed?.result;
  const isStale = Boolean(
    result &&
      (completed?.signature !== signature ||
        completed?.delayScenarioId !== effectiveDelayId ||
        completed?.offerScenarioId !== effectiveOfferId),
  );

  const hasActiveDeliveries = useMemo(() => {
    const targetId = result?.delay_scenario_id || effectiveDelayId;
    const targetScenario = data.scenarios.find((s) => s.id === targetId);
    if (!targetScenario) return false;
    return resolveScenarioInputs(data.snapshot, targetScenario).deliveryStatuses.some((d) => d.counted);
  }, [data.snapshot, data.scenarios, result?.delay_scenario_id, effectiveDelayId]);

  async function handleRun() {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    const runSignature = signature;
    const runDelayId = effectiveDelayId;
    const runOfferId = effectiveOfferId;

    setPending(true);
    try {
      const stressResult = await runStressTestPreview(
        data,
        { delayScenarioId: runDelayId, offerScenarioId: runOfferId },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setCompleted({
        signature: runSignature,
        delayScenarioId: runDelayId,
        offerScenarioId: runOfferId,
        result: stressResult,
      });
    } catch (error) {
      if (controller.signal.aborted) return;
      const message = error instanceof Error ? error.message : "Uji ketahanan gagal dijalankan.";
      setCompleted({
        signature: runSignature,
        delayScenarioId: runDelayId,
        offerScenarioId: runOfferId,
        error: message,
      });
      notify.error(message);
    } finally {
      if (!controller.signal.aborted) setPending(false);
    }
  }

  const delayChartData = useMemo(
    () =>
      (result?.delay_curve ?? []).map((pt) => ({
        label: pt.delay_days === 0 ? "0 hari" : `+${formatNumber(pt.delay_days)} hari`,
        contribution: pt.net_contribution_idr,
      })),
    [result],
  );

  const primaryBreakeven = result?.offer_breakevens.find((o) => o.max_viable_premium_idr !== null) ?? null;
  const delaySelectId = `${baseId}-delay-scenario`;
  const offerSelectId = `${baseId}-offer-scenario`;

  return (
    <section className="panel stress-test-panel" aria-labelledby={`${baseId}-heading`}>
      <header className="panel-heading">
        <div>
          <h2 id={`${baseId}-heading`}>Uji Ketahanan &amp; Titik Impas Premi</h2>
          <p>
            Simulasikan keterlambatan pengiriman 0–5 hari dan cari batas premi maksimal penawaran pemasok alternatif.
          </p>
        </div>
        <Button type="button" onClick={() => void handleRun()} disabled={pending || data.scenarios.length === 0}>
          {result ? <RotateCcw size={17} aria-hidden="true" /> : <Play size={17} aria-hidden="true" />}
          {pending
            ? "Menghitung Stress-Test…"
            : result
              ? "Hitung Ulang Stress-Test"
              : "Jalankan Stress-Test Otomatis"}
        </Button>
      </header>
      <div className="panel-body">
        {data.scenarios.length > 0 && (
          <div className="parameter-fields stress-test-controls">
            <div className="field">
              <label htmlFor={delaySelectId}>Skenario uji keterlambatan</label>
              <select
                id={delaySelectId}
                value={effectiveDelayId}
                disabled={pending}
                onChange={(event) => setSelectedDelayId(event.target.value)}
              >
                {data.scenarios.map((item) => (
                  <option key={item.id} value={item.id}>
                    {scenarioLabel(item)}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor={offerSelectId}>Skenario uji penawaran</label>
              <select
                id={offerSelectId}
                value={effectiveOfferId}
                disabled={pending}
                onChange={(event) => setSelectedOfferId(event.target.value)}
              >
                {data.scenarios.map((item) => (
                  <option key={item.id} value={item.id}>
                    {scenarioLabel(item)}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        {pending && <Busy label="Menghitung kurva keterlambatan dan titik impas premi…" />}

        {!pending && completed?.error && <ErrorState message={completed.error} retry={() => void handleRun()} />}

        {!pending && !result && !completed?.error && (
          <div className="simulation-empty">
            <Activity size={20} aria-hidden="true" />
            <p>
              Klik &ldquo;Jalankan Stress-Test Otomatis&rdquo; untuk mengukur titik kritis keterlambatan dan batas
              premi penawaran alternatif.
            </p>
          </div>
        )}

        {isStale && (
          <div className="stale-notice" role="status">
            <CircleAlert size={18} aria-hidden="true" />
            <p>
              Hasil stress-test sebelumnya sudah basi karena data usaha atau pilihan skenario berubah. Jalankan ulang
              untuk memperbarui analisis.
            </p>
            <Button type="button" variant="outline" size="sm" onClick={() => void handleRun()} disabled={pending}>
              Hitung Ulang Stress-Test
            </Button>
          </div>
        )}

        {result && (
          <div className={isStale ? "is-stale stress-test-results" : "stress-test-results"}>
            <div className="metric-panel stress-test-metrics">
              <div>
                <span>Kontribusi awal skenario uji</span>
                <strong>{formatMoney(result.baseline_net_idr)}</strong>
              </div>
              <div>
                <span>Titik kritis keterlambatan</span>
                <strong>
                  {!hasActiveDeliveries
                    ? "Belum ada pengiriman aktif"
                    : result.critical_delay_days !== null
                      ? `+${formatNumber(result.critical_delay_days)} hari`
                      : "Aman s.d. +5 hari"}
                </strong>
              </div>
              <div className="metric-emphasis">
                <span>Batas premi maksimal</span>
                <strong>
                  {result.offer_breakevens.length === 0
                    ? "Belum ada penawaran"
                    : primaryBreakeven
                      ? formatMoney(primaryBreakeven.max_viable_premium_idr)
                      : "Tidak terpakai"}
                </strong>
              </div>
            </div>

            <div className="stress-test-grid">
              <section className="panel">
                <header className="panel-heading">
                  <div>
                    <h3>Dampak Keterlambatan Pengiriman (0–5 Hari)</h3>
                    <p>
                      {!hasActiveDeliveries
                        ? "Belum ada pengiriman terjadwal aktif pada skenario ini, sehingga keterlambatan tidak mengubah kontribusi."
                        : result.critical_delay_days !== null
                          ? `Kontribusi mulai turun pada keterlambatan +${formatNumber(result.critical_delay_days)} hari.`
                          : "Kontribusi tetap stabil hingga keterlambatan +5 hari."}
                    </p>
                  </div>
                </header>
                <div className="panel-body">
                  {hasActiveDeliveries && delayChartData.some((pt) => pt.contribution !== null) ? (
                    <>
                      <StressDelayChart data={delayChartData} />
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th scope="col">Keterlambatan</th>
                            <th scope="col">Estimasi kontribusi</th>
                            <th scope="col">Permintaan kurang</th>
                          </tr>
                        </thead>
                        <tbody>
                          {result.delay_curve.map((pt) => (
                            <tr key={pt.delay_days}>
                              <th scope="row">{pt.delay_days === 0 ? "0 hari" : `+${formatNumber(pt.delay_days)} hari`}</th>
                              <td>{formatMoney(pt.net_contribution_idr)}</td>
                              <td>{formatNumber(pt.unmet_units)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </>
                  ) : (
                    <p className="muted">
                      Tambahkan pengiriman terjadwal pada Data Usaha untuk melihat sensitivitas keterlambatan.
                    </p>
                  )}
                </div>
              </section>

              <div className="stress-test-offers">
                {result.offer_breakevens.length === 0 ? (
                  <section className="panel">
                    <header className="panel-heading">
                      <div>
                        <h3>Titik Impas Premi Penawaran Alternatif</h3>
                        <p>Batas premi tambahan per pak yang masih meningkatkan kontribusi bersih.</p>
                      </div>
                    </header>
                    <div className="panel-body">
                      <p className="muted">
                        Belum ada penawaran alternatif yang memenuhi syarat pada skenario ini. Aktifkan penawaran
                        cadangan atau tambahkan penawaran di Data Usaha.
                      </p>
                    </div>
                  </section>
                ) : (
                  result.offer_breakevens.map((offer) => <OfferBreakevenCard key={offer.offer_id} offer={offer} />)
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
