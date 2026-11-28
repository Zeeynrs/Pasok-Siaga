"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Boxes, Building2, ChevronRight, CircleAlert, FlaskConical, Network } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/workspace";
import { Button } from "@/components/ui/button";
import { applyStarterTemplate, type StarterTemplate } from "@/lib/domain/templates";
import { formatDate, formatNumber, formatPercent, formatQuantity } from "@/lib/format";
import { notify } from "@/lib/notify";
import { analyzeNetwork, computeResilienceScore } from "@/lib/view-models";
import { useWorkspace } from "@/lib/workspace-context";
import { TemplatePicker } from "./template-picker";

export function Dashboard() {
  const { data, setData, mode, scenarios, snapshot, href, signature, comparison, comparing, runComparison } = useWorkspace();
  const [showTemplates, setShowTemplates] = useState(false);
  const attempted = useRef<string | null>(null);
  const resilienceHeadingId = useId();
  const baseline = scenarios.find((item) => item.id === "baseline") ?? scenarios[0];
  const network = useMemo(() => analyzeNetwork(snapshot, baseline), [snapshot, baseline]);
  const isEmpty = snapshot.suppliers.length === 0 && snapshot.materials.length === 0 && snapshot.products.length === 0;
  const fresh = comparison !== null && comparison.signature === signature;

  useEffect(() => {
    if (isEmpty || fresh || comparing || attempted.current === signature) return;
    attempted.current = signature;
    void runComparison();
  }, [isEmpty, fresh, comparing, signature, runComparison]);

  const resilience = useMemo(
    () => (isEmpty ? null : computeResilienceScore(snapshot, network, fresh ? comparison.view : null)),
    [isEmpty, snapshot, network, fresh, comparison],
  );
  const critical = new Set(network.single_source_risks.map(({ material_id }) => material_id));
  const name = snapshot.business.name.replace(/\s*\(DATA SIMULASI\)\s*$/i, "");

  function handleSelectTemplate(tpl: StarterTemplate) {
    setData(applyStarterTemplate(data, tpl.id, mode));
    setShowTemplates(false);
    notify.success(`Template "${tpl.name}" diterapkan.`);
  }

  return (
    <>
      <PageHeader title="Ringkasan Usaha" action={<Button asChild><Link href={href("/simulator")}><FlaskConical size={18} aria-hidden="true" /> Buka Simulator</Link></Button>}>
        Pantau bahan baku dan ketergantungan pemasok {name}.
      </PageHeader>
      <section className="overview-band" data-tour="overview" aria-label={`Ringkasan ${name}`}>
        <div className="overview-business"><span className="overview-icon"><Building2 size={24} aria-hidden="true" /></span><div><h2>{name}</h2><p>{snapshot.business.sector}</p></div></div>
        <div className="overview-stat"><span>Pemasok</span><strong>{formatNumber(snapshot.suppliers.length)}</strong></div>
        <div className="overview-stat"><span>Bahan baku</span><strong>{formatNumber(snapshot.materials.length)}</strong></div>
        <div className="overview-stat"><span>Produk</span><strong>{formatNumber(snapshot.products.length)}</strong></div>
      </section>
      {!isEmpty && resilience && (
        <section className="panel resilience-panel" aria-labelledby={resilienceHeadingId}>
          <header className="panel-heading">
            <div>
              <h2 id={resilienceHeadingId}>Skor Ketahanan Pasokan</h2>
              <p>{resilience.summary}</p>
            </div>
            <div className="resilience-score-badge">
              <div className="resilience-score-value">
                <strong>{formatNumber(resilience.score)}</strong>
                <span>/100</span>
              </div>
              <span className={`tag tag-${resilience.tone}`}>{resilience.grade}</span>
            </div>
          </header>
          <div className="panel-body">
            <div className="metric-panel resilience-breakdown">
              <div>
                <span>Diversifikasi pasokan</span>
                <strong>{formatPercent(resilience.structural_pct)}</strong>
              </div>
              <div>
                <span>Ketahanan saat gangguan</span>
                <strong>{comparing && !fresh ? "Menghitung…" : formatPercent(resilience.outage_retention_pct)}</strong>
              </div>
              <div>
                <span>Daya pulih mitigasi</span>
                <strong>{comparing && !fresh ? "Menghitung…" : formatPercent(resilience.mitigation_score_pct)}</strong>
              </div>
            </div>
          </div>
          <div className="panel-footer">
            <Link href={href("/comparison")} className="text-link">
              Lihat Perbandingan &amp; Stress-Test <ChevronRight size={17} aria-hidden="true" />
            </Link>
          </div>
        </section>
      )}
      {isEmpty && (
        <section className="guide-panel start-panel">
          <div className="guide-icon"><Boxes size={23} aria-hidden="true" /></div>
          <div><h2>Mulai dari nol</h2><p>Workspace ini masih kosong. Ikuti tiga langkah singkat ini.</p></div>
          <div className="action-row start-actions">
            <Button
              type="button"
              variant="outline"
              aria-expanded={showTemplates}
              onClick={() => setShowTemplates((value) => !value)}
            >
              Pilih Template Starter
            </Button>
            <Button asChild><Link href={href("/data")}>Isi Data Usaha</Link></Button>
          </div>
          <ol className="start-steps">
            <li>Tambahkan pemasok, bahan baku, dan produk di <Link href={href("/data")} className="text-link">Data Usaha</Link>.</li>
            <li>Isi resep, stok, permintaan, dan pengiriman atau penawaran pemasok.</li>
            <li>Jalankan <Link href={href("/simulator")} className="text-link">Simulator</Link>, lalu lihat <Link href={href("/comparison")} className="text-link">Perbandingan</Link>.</li>
          </ol>
          {showTemplates && <TemplatePicker onSelect={handleSelectTemplate} />}
        </section>
      )}
      <div className="dashboard-grid">
        <section className="panel">
          <header className="panel-heading"><div><h2>Stok bahan awal</h2><p>Posisi stok sebelum pengiriman terjadwal.</p></div><Boxes size={21} aria-hidden="true" /></header>
          <div className="stock-list">
            {snapshot.materials.map((material) => (
              <div key={material.id} className="stock-row"><div><strong>{material.name}</strong>{critical.has(material.id) && <span className="tag tag-warning">Satu pemasok</span>}</div><span>{formatQuantity(material.stock_on_hand, material.base_unit)}</span></div>
            ))}
            {snapshot.materials.length === 0 && <p className="panel-body muted">Belum ada bahan baku. Tambahkan di Data Usaha.</p>}
          </div>
          <div className="panel-footer"><Link href={href("/data")} className="text-link">Ubah data usaha <ChevronRight size={17} aria-hidden="true" /></Link></div>
        </section>
        <section className="panel" data-tour="risk">
          <header className="panel-heading"><div><h2>Risiko pemasok</h2><p>Berdasarkan kondisi normal pada {formatDate(baseline.cutoff_date)}.</p></div><Network size={21} aria-hidden="true" /></header>
          <div className="panel-body">
            {network.single_source_risks.length ? (
              <ul className="risk-list">
                {network.single_source_risks.map((risk) => {
                  const material = snapshot.materials.find(({ id }) => id === risk.material_id);
                  const supplier = snapshot.suppliers.find(({ id }) => id === risk.supplier_id);
                  const products = snapshot.products.filter(({ id }) => risk.product_ids.includes(id)).map(({ name: productName }) => productName);
                  return <li key={risk.material_id}><CircleAlert size={19} aria-hidden="true" /><div><strong>{material?.name ?? risk.material_id}</strong><p>Pasokan terjadwal bergantung pada {supplier?.name ?? risk.supplier_id}. Produk bergantung pada bahan ini: {products.join(", ")}.</p></div></li>;
                })}
              </ul>
            ) : <p className="muted">Tidak ada bahan dengan satu pemasok pada kondisi normal.</p>}
          </div>
          <div className="panel-footer"><Link href={href("/network")} className="text-link">Lihat Jaringan Pasok <ChevronRight size={17} aria-hidden="true" /></Link></div>
        </section>
      </div>
      <section className="guide-panel">
        <div className="guide-icon"><FlaskConical size={23} aria-hidden="true" /></div>
        <div><h2>Uji jika pemasok utama gagal</h2><p>Bandingkan jumlah produksi yang dapat dipenuhi dan kontribusi setelah menambahkan pasokan alternatif.</p></div>
        <Button asChild variant="outline"><Link href={href("/comparison")}>Bandingkan Skenario</Link></Button>
      </section>
    </>
  );
}
