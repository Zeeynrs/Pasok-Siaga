"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { CircleAlert, LayoutTemplate, RotateCcw, Save } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/workspace";
import { Button } from "@/components/ui/button";
import { TemplatePicker } from "@/features/dashboard/template-picker";
import { applyStarterTemplate, type StarterTemplate } from "@/lib/domain/templates";
import { notify } from "@/lib/notify";
import { useWorkspace } from "@/lib/workspace-context";
import { ParameterForm } from "./parameter-form";
import { StructureEditor } from "./structure-editor";

function PanelQuerySync({ onPanelTemplates }: { onPanelTemplates: () => void }) {
  const searchParams = useSearchParams();
  const panel = searchParams.get("panel");
  useEffect(() => {
    if (panel === "templates") onPanelTemplates();
  }, [panel, onPanelTemplates]);
  return null;
}

export function DataEditor() {
  const { data, setData, snapshot, mode, signature, comparison, reset, resetting, notice, actionError } = useWorkspace();
  const [resetVersion, setResetVersion] = useState(0);
  const [applied, setApplied] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [pendingTemplate, setPendingTemplate] = useState<StarterTemplate | null>(null);
  const isDemo = mode === "demo";
  const isEmpty = snapshot.suppliers.length === 0 && snapshot.materials.length === 0 && snapshot.products.length === 0;
  const unsimulated = comparison !== null && comparison.signature !== signature;
  const name = snapshot.business.name.replace(/\s*\(DATA SIMULASI\)\s*$/i, "");

  const openTemplatesPanel = useCallback(() => {
    setShowTemplates(true);
  }, []);

  async function confirmReset() {
    setConfirming(false);
    await reset();
    setResetVersion((value) => value + 1);
    setApplied("");
  }

  function applyTemplate(tpl: StarterTemplate) {
    setData(applyStarterTemplate(data, tpl.id, mode));
    setPendingTemplate(null);
    setShowTemplates(false);
    setResetVersion((value) => value + 1);
    setApplied("");
    notify.success(`Template "${tpl.name}" diterapkan.`);
  }

  function handleSelectTemplate(tpl: StarterTemplate) {
    if (isEmpty) {
      applyTemplate(tpl);
      return;
    }
    setPendingTemplate(tpl);
  }

  return (
    <>
      <Suspense fallback={null}>
        <PanelQuerySync onPanelTemplates={openTemplatesPanel} />
      </Suspense>
      <PageHeader
        title="Data Usaha"
        action={
          <Button
            type="button"
            variant="outline"
            aria-expanded={showTemplates}
            onClick={() => {
              setShowTemplates((value) => !value);
              setPendingTemplate(null);
            }}
          >
            <LayoutTemplate size={17} aria-hidden="true" /> Template Starter
          </Button>
        }
      >
        {isDemo ? "Sesuaikan stok, permintaan, dan kapasitas pemasok pada sesi demo ini." : "Sesuaikan stok, permintaan, dan struktur usaha, lalu simpan ke workspace Anda."}
      </PageHeader>
      {showTemplates && (
        <section className="panel template-panel" aria-label="Template starter">
          <div className="panel-body">
            <TemplatePicker title="Pilih Template Starter Kuliner" onSelect={handleSelectTemplate} />
            {pendingTemplate && (
              <div className="state-panel confirm-panel" role="alertdialog" aria-label="Konfirmasi terapkan template">
                <CircleAlert size={20} aria-hidden="true" />
                <p>Terapkan template &ldquo;{pendingTemplate.name}&rdquo;? Data usaha dan skenario saat ini akan diganti.</p>
                <Button type="button" variant="outline" size="sm" onClick={() => setPendingTemplate(null)}>Batal</Button>
                <Button type="button" size="sm" onClick={() => applyTemplate(pendingTemplate)}>Ya, Terapkan Template</Button>
              </div>
            )}
          </div>
        </section>
      )}
      <section className="panel" data-tour="parameters">
        <header className="panel-heading"><div><h2>Parameter {name}</h2><p>Masukkan jumlah dalam satuan yang tercantum pada setiap kolom.</p></div></header>
        <div className="panel-body">
          <ParameterForm key={resetVersion} snapshot={snapshot} onApply={(next) => {
            setData({ ...data, snapshot: next });
            setApplied(isDemo ? "Parameter disimpan untuk sesi demo ini." : "Parameter diterapkan. Tekan Simpan ke Workspace untuk menyimpannya.");
            notify.success(isDemo ? "Parameter disimpan untuk sesi demo ini." : "Parameter diterapkan. Tekan Simpan ke Workspace untuk menyimpannya.");
          }}>
            {({ dirty }) => <div className="parameter-actions">
              <div className="form-notice" aria-live="polite">{dirty || unsimulated ? "Perubahan belum disimulasikan" : (notice ?? applied)}</div>
              <div className="action-row">
                <Button type="button" variant="outline" disabled={resetting} onClick={() => setConfirming(true)}><RotateCcw size={17} aria-hidden="true" /> {isDemo ? "Reset Demo" : "Kosongkan Data"}</Button>
                <Button type="submit" disabled={!dirty}><Save size={17} aria-hidden="true" /> {isDemo ? "Simpan Perubahan" : "Terapkan Perubahan"}</Button>
              </div>
            </div>}
          </ParameterForm>
          {confirming && (
            <div className="state-panel confirm-panel" role="alertdialog" aria-label="Konfirmasi reset">
              <CircleAlert size={20} aria-hidden="true" />
              <p>{isDemo ? "Kembalikan semua data dan skenario ke kondisi awal Dapur Sari? Perubahan Anda akan hilang." : "Hapus semua data dan skenario di workspace Anda lalu mulai dari nol? Tindakan ini tidak bisa dibatalkan."}</p>
              <Button type="button" variant="outline" size="sm" onClick={() => setConfirming(false)}>Batal</Button>
              <Button type="button" size="sm" onClick={confirmReset}>{isDemo ? "Ya, Reset" : "Ya, Kosongkan"}</Button>
            </div>
          )}
          {actionError && <div className="state-panel error-panel" role="alert"><CircleAlert size={20} aria-hidden="true" /><p>{actionError}</p></div>}
        </div>
      </section>
      <div className="structure-stack">
        <StructureEditor data={data} onChange={setData} />
      </div>
    </>
  );
}
