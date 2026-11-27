"use client";

import { Suspense, useCallback, useEffect, useId, useRef, useState, type ReactNode, type RefObject } from "react";
import { ChevronDown, Plus, Trash2 } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateInput, NumberInput, TextInput } from "@/components/ui/number-input";
import {
  addAlternativeOffer,
  addCommittedDelivery,
  addMaterial,
  addProduct,
  addSupplier,
  removeAlternativeOffer,
  removeCommittedDelivery,
  removeMaterial,
  removeProduct,
  removeSupplier,
  setBomQuantity,
  setMaterialUnitKind,
} from "@/lib/domain/mutations";
import type { UnitKind, WorkspaceData } from "@/lib/domain/types";
import { formatQuantity } from "@/lib/format";
import { notify } from "@/lib/notify";

interface Props {
  data: WorkspaceData;
  onChange: (next: WorkspaceData) => void;
}

const UNIT_KIND_LABEL: Record<UnitKind, string> = { mass: "Berat (g)", volume: "Volume (ml)", count: "Jumlah (pcs)" };
const MOBILE_QUERY = "(max-width: 680px)";

function OffersQuerySync({ onFocusOffers }: { onFocusOffers: () => void }) {
  const searchParams = useSearchParams();
  const focus = searchParams.get("focus");
  useEffect(() => {
    if (focus === "offers") onFocusOffers();
  }, [focus, onFocusOffers]);
  return null;
}

/**
 * Editor struktur usaha: pemasok, bahan, produk, resep, pengiriman, dan penawaran (tambah/ubah/hapus).
 * Stok, permintaan, dan batas pak ada di formulir parameter. Setiap perubahan langsung diterapkan dan
 * memunculkan notifikasi: aksi tambah/hapus langsung, ketikan beruntun digabung jadi satu toast.
 */
export function StructureEditor({ data, onChange }: Props) {
  const s = data.snapshot;
  // Di layar kecil panel dimulai tertutup agar halaman tidak terlalu panjang.
  const [openByDefault] = useState(() => typeof window === "undefined" || !window.matchMedia?.(MOBILE_QUERY).matches);
  const offersRef = useRef<HTMLDetailsElement>(null);
  const [offersOpen, setOffersOpen] = useState(openByDefault);
  const [focusOffers, setFocusOffers] = useState(false);

  const handleFocusOffers = useCallback(() => {
    setOffersOpen(true);
    setFocusOffers(true);
  }, []);

  useEffect(() => {
    if (!focusOffers) return;
    offersRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  }, [focusOffers]);

  /** Terapkan perubahan eksplisit (tambah/hapus) beserta notifikasinya. */
  const commit = (next: WorkspaceData, message: string) => {
    onChange(next);
    notify.success(message);
  };
  /** Ubah isian pada salinan dalam; notifikasi digabung agar tidak muncul tiap ketikan. */
  const patch = (fn: (draft: WorkspaceData) => void, message = "Perubahan data diterapkan.") => {
    const draft = structuredClone(data);
    fn(draft);
    onChange(draft);
    notify.changed(message);
  };
  const unitOf = (id: string) => s.materials.find((m) => m.id === id)?.base_unit ?? "g";

  return (
    <>
      <Suspense fallback={null}>
        <OffersQuerySync onFocusOffers={handleFocusOffers} />
      </Suspense>
      <Panel title="Profil usaha" description="Nama, sektor, dan tanggal acuan perencanaan." open={openByDefault}>
        <div className="parameter-fields entity-fields">
          <TextInput label="Nama usaha" value={s.business.name} onCommit={(v) => patch((d) => void (d.snapshot.business.name = v), "Profil usaha diperbarui.")} />
          <TextInput label="Sektor" value={s.business.sector} onCommit={(v) => patch((d) => void (d.snapshot.business.sector = v), "Profil usaha diperbarui.")} />
          <DateInput label="Tanggal perencanaan (batas)" value={s.business.planning_cutoff_date} onCommit={(v) => patch((d) => void (d.snapshot.business.planning_cutoff_date = v), "Profil usaha diperbarui.")} />
          <DateInput
            label="Tanggal simulasi"
            value={s.scenario_date}
            onCommit={(v) => patch((d) => { d.snapshot.scenario_date = v; d.snapshot.business.scenario_date = v; }, "Profil usaha diperbarui.")}
          />
        </div>
      </Panel>

      <Panel title="Pemasok" tour="structure" count={s.suppliers.length} description="Pemasok yang dinonaktifkan tidak dihitung di semua skenario." open={openByDefault}>
        <ul className="entity-list">
          {s.suppliers.map((sup, i) => (
            <li key={sup.id} className="entity-row">
              <TextInput label={`Nama ${sup.name}`} value={sup.name} onCommit={(v) => patch((d) => void (d.snapshot.suppliers[i].name = v), "Pemasok diperbarui.")} />
              <label className="check-row entity-check">
                <input type="checkbox" checked={sup.active} onChange={(e) => patch((d) => void (d.snapshot.suppliers[i].active = e.target.checked), `Pemasok "${sup.name}" ${e.target.checked ? "diaktifkan" : "dinonaktifkan"}.`)} />
                <span>{sup.name} aktif</span>
              </label>
              <RemoveButton label={`Hapus ${sup.name}`} onClick={() => commit(removeSupplier(data, sup.id), `Pemasok "${sup.name}" dihapus.`)} />
            </li>
          ))}
          {s.suppliers.length === 0 && <li className="muted">Belum ada pemasok.</li>}
        </ul>
        <AddRow label="Nama pemasok baru" button="Tambah Pemasok" onAdd={(name) => commit(addSupplier(data, name), `Pemasok "${name}" ditambahkan.`)} />
      </Panel>

      <Panel title="Bahan baku" count={s.materials.length} description="Stok bahan diatur di formulir parameter di atas." open={openByDefault}>
        <ul className="entity-list">
          {s.materials.map((m, i) => (
            <li key={m.id} className="entity-row">
              <TextInput label={`Nama ${m.name}`} value={m.name} onCommit={(v) => patch((d) => void (d.snapshot.materials[i].name = v), "Bahan diperbarui.")} />
              <SelectField
                label={`Jenis ${m.name}`}
                value={m.unit_kind}
                options={Object.entries(UNIT_KIND_LABEL).map(([id, name]) => ({ id, name }))}
                onChange={(v) => commit(setMaterialUnitKind(data, m.id, v as UnitKind), `Jenis bahan "${m.name}" diubah.`)}
              />
              <RemoveButton label={`Hapus ${m.name}`} onClick={() => commit(removeMaterial(data, m.id), `Bahan "${m.name}" dihapus beserta resep, pengiriman, dan penawarannya.`)} />
            </li>
          ))}
          {s.materials.length === 0 && <li className="muted">Belum ada bahan baku.</li>}
        </ul>
        <AddRow label="Nama bahan baru" button="Tambah Bahan" onAdd={(name) => commit(addMaterial(data, name), `Bahan "${name}" ditambahkan.`)} />
      </Panel>

      <Panel title="Produk" count={s.products.length} description="Permintaan produk diatur di formulir parameter di atas." open={openByDefault}>
        <ul className="entity-list">
          {s.products.map((p, i) => (
            <li key={p.id} className="entity-row">
              <TextInput label={`Nama ${p.name}`} value={p.name} onCommit={(v) => patch((d) => void (d.snapshot.products[i].name = v), "Produk diperbarui.")} />
              <NumberInput
                label={`Kontribusi ${p.name} (Rp per unit)`}
                value={p.unit_contribution_idr}
                max={10_000_000}
                onCommit={(n) => patch((d) => void (d.snapshot.products[i].unit_contribution_idr = n), "Produk diperbarui.")}
              />
              <RemoveButton label={`Hapus ${p.name}`} onClick={() => commit(removeProduct(data, p.id), `Produk "${p.name}" dihapus beserta resepnya.`)} />
            </li>
          ))}
          {s.products.length === 0 && <li className="muted">Belum ada produk.</li>}
        </ul>
        <AddRow label="Nama produk baru" button="Tambah Produk" onAdd={(name) => commit(addProduct(data, name), `Produk "${name}" ditambahkan.`)} />
      </Panel>

      <Panel title="Resep" description="Kebutuhan bahan untuk satu unit produk. Isi 0 bila bahan tidak dipakai." open={openByDefault}>
        {s.products.length === 0 || s.materials.length === 0 ? (
          <p className="muted">Tambahkan produk dan bahan terlebih dahulu.</p>
        ) : (
          <div className="table-scroll">
            <table className="data-table recipe-table" aria-label="Resep produk">
              <thead>
                <tr>
                  <th scope="col">Produk</th>
                  {s.materials.map((m) => <th key={m.id} scope="col">{m.name}</th>)}
                </tr>
              </thead>
              <tbody>
                {s.products.map((p) => (
                  <tr key={p.id}>
                    <th scope="row">{p.name}</th>
                    {s.materials.map((m) => (
                      <td key={m.id}>
                        <NumberInput
                          hideLabel
                          label={`Resep ${p.name} – ${m.name} (${m.base_unit})`}
                          value={s.bom.find((b) => b.product_id === p.id && b.material_id === m.id)?.quantity_per_product ?? 0}
                          onCommit={(n) => {
                            onChange(setBomQuantity(data, p.id, m.id, n));
                            notify.changed("Resep diperbarui.");
                          }}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="Pengiriman terjadwal" count={s.committed_deliveries.length} description="Pasokan yang sudah dijanjikan pemasok sebelum batas waktu." open={openByDefault}>
        <ul className="entity-list">
          {s.committed_deliveries.map((dl, i) => (
            <li key={dl.id} className="entity-row entity-row-wide">
              <SelectField label={`Pemasok pengiriman ${i + 1}`} value={dl.supplier_id} options={s.suppliers} onChange={(v) => patch((d) => void (d.snapshot.committed_deliveries[i].supplier_id = v), "Pengiriman diperbarui.")} />
              <SelectField label={`Bahan pengiriman ${i + 1}`} value={dl.material_id} options={s.materials} onChange={(v) => patch((d) => void (d.snapshot.committed_deliveries[i].material_id = v), "Pengiriman diperbarui.")} />
              <NumberInput
                label={`Jumlah pengiriman ${i + 1} (${unitOf(dl.material_id)})`}
                value={dl.quantity_base_units}
                min={1}
                hint={formatQuantity(dl.quantity_base_units, unitOf(dl.material_id))}
                onCommit={(n) => patch((d) => void (d.snapshot.committed_deliveries[i].quantity_base_units = n), "Pengiriman diperbarui.")}
              />
              <DateInput label={`Tanggal tiba pengiriman ${i + 1}`} value={dl.arrival_date} onCommit={(v) => patch((d) => void (d.snapshot.committed_deliveries[i].arrival_date = v), "Pengiriman diperbarui.")} />
              <label className="check-row entity-check">
                <input type="checkbox" checked={dl.enabled_in_baseline} onChange={(e) => patch((d) => void (d.snapshot.committed_deliveries[i].enabled_in_baseline = e.target.checked), "Pengiriman diperbarui.")} />
                <span>Aktif di kondisi normal {i + 1}</span>
              </label>
              <RemoveButton label={`Hapus pengiriman ${i + 1}`} onClick={() => commit(removeCommittedDelivery(data, dl.id), `Pengiriman ${i + 1} dihapus.`)} />
            </li>
          ))}
          {s.committed_deliveries.length === 0 && <li className="muted">Belum ada pengiriman terjadwal.</li>}
        </ul>
        <AddButton label="Tambah Pengiriman" disabled={s.suppliers.length === 0 || s.materials.length === 0} onClick={() => commit(addCommittedDelivery(data, s.suppliers[0].id, s.materials[0].id), "Pengiriman terjadwal ditambahkan. Lengkapi pemasok, bahan, jumlah, dan tanggalnya.")} />
        {(s.suppliers.length === 0 || s.materials.length === 0) && <p className="muted">Tambahkan pemasok dan bahan dulu sebelum membuat pengiriman.</p>}
      </Panel>

      <Panel
        title="Penawaran alternatif"
        count={s.alternative_offers.length}
        description="Pembelian cadangan: batas pak diatur di formulir parameter di atas."
        open={offersOpen}
        onOpenChange={setOffersOpen}
        panelRef={offersRef}
      >
        <ul className="entity-list">
          {s.alternative_offers.map((o, i) => (
            <li key={o.id} className="entity-row entity-row-wide">
              <SelectField label={`Pemasok penawaran ${i + 1}`} value={o.supplier_id} options={s.suppliers} onChange={(v) => patch((d) => void (d.snapshot.alternative_offers[i].supplier_id = v), "Penawaran diperbarui.")} />
              <SelectField label={`Bahan penawaran ${i + 1}`} value={o.material_id} options={s.materials} onChange={(v) => patch((d) => void (d.snapshot.alternative_offers[i].material_id = v), "Penawaran diperbarui.")} />
              <NumberInput
                label={`Isi per pak penawaran ${i + 1} (${unitOf(o.material_id)})`}
                value={o.pack_size_base_units}
                min={1}
                onCommit={(n) => patch((d) => void (d.snapshot.alternative_offers[i].pack_size_base_units = n), "Penawaran diperbarui.")}
              />
              <NumberInput label={`Lead time penawaran ${i + 1} (hari)`} value={o.lead_days} max={365} onCommit={(n) => patch((d) => void (d.snapshot.alternative_offers[i].lead_days = n), "Penawaran diperbarui.")} />
              <NumberInput
                label={`Biaya tambahan per pak penawaran ${i + 1} (Rp)`}
                value={o.incremental_premium_idr_per_pack}
                max={10_000_000}
                onCommit={(n) => patch((d) => void (d.snapshot.alternative_offers[i].incremental_premium_idr_per_pack = n), "Penawaran diperbarui.")}
              />
              <label className="check-row entity-check">
                <input type="checkbox" checked={o.enabled_in_scenario} onChange={(e) => patch((d) => void (d.snapshot.alternative_offers[i].enabled_in_scenario = e.target.checked), "Penawaran diperbarui.")} />
                <span>Tersedia untuk skenario {i + 1}</span>
              </label>
              <RemoveButton label={`Hapus penawaran ${i + 1}`} onClick={() => commit(removeAlternativeOffer(data, o.id), `Penawaran ${i + 1} dihapus.`)} />
            </li>
          ))}
          {s.alternative_offers.length === 0 && <li className="muted">Belum ada penawaran alternatif.</li>}
        </ul>
        <AddButton label="Tambah Penawaran" disabled={s.suppliers.length === 0 || s.materials.length === 0} onClick={() => commit(addAlternativeOffer(data, s.suppliers[0].id, s.materials[0].id), "Penawaran alternatif ditambahkan. Lengkapi isi pak, lead time, dan biayanya.")} />
        {(s.suppliers.length === 0 || s.materials.length === 0) && <p className="muted">Tambahkan pemasok dan bahan dulu sebelum membuat penawaran.</p>}
      </Panel>
    </>
  );
}

/** Panel akordeon: judul, jumlah item, dan chevron. Isi tetap ada di DOM saat tertutup. */
function Panel({
  title,
  description,
  count,
  tour,
  open: openProp,
  onOpenChange,
  panelRef,
  children,
}: {
  title: string;
  description: string;
  count?: number;
  tour?: string;
  open: boolean;
  onOpenChange?: (open: boolean) => void;
  panelRef?: RefObject<HTMLDetailsElement | null>;
  children: ReactNode;
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(openProp);
  const open = onOpenChange ? openProp : uncontrolledOpen;
  return (
    <details
      ref={panelRef}
      className="panel structure-panel"
      data-tour={tour}
      open={open}
      onToggle={(event) => {
        const next = event.currentTarget.open;
        if (onOpenChange) onOpenChange(next);
        else setUncontrolledOpen(next);
      }}
    >
      <summary className="panel-heading">
        <div>
          <h2>{title}{count !== undefined && <span className="count-badge">{count}</span>}</h2>
          <p>{description}</p>
        </div>
        <ChevronDown size={20} aria-hidden="true" />
      </summary>
      <div className="panel-body">{children}</div>
    </details>
  );
}

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return <Button type="button" variant="ghost" size="sm" className="entity-remove" onClick={onClick}><Trash2 size={16} aria-hidden="true" /> {label}</Button>;
}

function AddButton({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return <Button type="button" variant="outline" size="sm" className="entity-add" onClick={onClick} disabled={disabled}><Plus size={16} aria-hidden="true" /> {label}</Button>;
}

function AddRow({ label, button, onAdd }: { label: string; button: string; onAdd: (name: string) => void }) {
  const id = useId();
  const [name, setName] = useState("");
  return (
    <form
      className="add-row"
      onSubmit={(event) => {
        event.preventDefault();
        if (!name.trim()) return;
        onAdd(name.trim());
        setName("");
      }}
    >
      <div className="field">
        <label htmlFor={id}>{label}</label>
        <Input id={id} value={name} maxLength={100} onChange={(event) => setName(event.target.value)} />
      </div>
      <Button type="submit" variant="outline" size="sm" disabled={!name.trim()}><Plus size={16} aria-hidden="true" /> {button}</Button>
    </form>
  );
}

function SelectField({ label, value, options, onChange }: { label: string; value: string; options: { id: string; name: string }[]; onChange: (id: string) => void }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
    </div>
  );
}
