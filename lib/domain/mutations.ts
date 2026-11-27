import {
  MAX_SCENARIOS,
  CORE_SCENARIO_IDS,
  type BaseUnit,
  type ScenarioConfig,
  type UnitKind,
  type WorkspaceData,
} from "./types";

/**
 * Mutasi murni atas `WorkspaceData` (tidak mengubah masukan). Setiap penghapusan entitas
 * ikut membersihkan referensi turunannya agar hasil akhir selalu lolos `validateWorkspaceData`.
 */

const UNIT_FOR_KIND: Record<UnitKind, BaseUnit> = { mass: "g", volume: "ml", count: "pcs" };

/** Slug valid & unik (`^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`) dari teks bebas. */
export function slugify(text: string, taken: string[], fallback = "item"): string {
  const base =
    text
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 56) || fallback;
  if (!taken.includes(base)) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base}_${i}`;
    if (!taken.includes(candidate)) return candidate;
  }
}

const clone = (d: WorkspaceData): WorkspaceData => structuredClone(d);
const omitKeys = (rec: Record<string, number> | undefined, keys: Set<string>) =>
  Object.fromEntries(Object.entries(rec ?? {}).filter(([k]) => !keys.has(k)));

/** Bersihkan referensi skenario ke entitas yang sudah dihapus. */
function pruneScenarios(
  d: WorkspaceData,
  gone: { suppliers?: string[]; offers?: string[]; deliveries?: string[]; materials?: string[]; products?: string[] },
): void {
  const suppliers = new Set(gone.suppliers);
  const offers = new Set(gone.offers);
  const deliveries = new Set(gone.deliveries);
  const materials = new Set(gone.materials);
  const products = new Set(gone.products);
  for (const sc of d.scenarios) {
    sc.disabled_supplier_ids = sc.disabled_supplier_ids.filter((id) => !suppliers.has(id));
    sc.enabled_offer_ids = sc.enabled_offer_ids.filter((id) => !offers.has(id));
    sc.disruptions = sc.disruptions.filter((x) => !deliveries.has(x.delivery_id));
    if (sc.overrides.stock_by_material) sc.overrides.stock_by_material = omitKeys(sc.overrides.stock_by_material, materials);
    if (sc.overrides.demand_by_product) sc.overrides.demand_by_product = omitKeys(sc.overrides.demand_by_product, products);
  }
}

export function addSupplier(data: WorkspaceData, name: string): WorkspaceData {
  const d = clone(data);
  const id = slugify(name, d.snapshot.suppliers.map((s) => s.id), "pemasok");
  d.snapshot.suppliers.push({ id, name: name.trim() || "Pemasok baru", active: true, notes: "" });
  return d;
}

export function removeSupplier(data: WorkspaceData, id: string): WorkspaceData {
  const d = clone(data);
  const deliveries = d.snapshot.committed_deliveries.filter((x) => x.supplier_id === id).map((x) => x.id);
  const offers = d.snapshot.alternative_offers.filter((x) => x.supplier_id === id).map((x) => x.id);
  d.snapshot.suppliers = d.snapshot.suppliers.filter((s) => s.id !== id);
  d.snapshot.committed_deliveries = d.snapshot.committed_deliveries.filter((x) => x.supplier_id !== id);
  d.snapshot.alternative_offers = d.snapshot.alternative_offers.filter((x) => x.supplier_id !== id);
  pruneScenarios(d, { suppliers: [id], deliveries, offers });
  return d;
}

export function addMaterial(data: WorkspaceData, name: string): WorkspaceData {
  const d = clone(data);
  const id = slugify(name, d.snapshot.materials.map((m) => m.id), "bahan");
  d.snapshot.materials.push({ id, name: name.trim() || "Bahan baru", unit_kind: "mass", base_unit: "g", stock_on_hand: 0 });
  return d;
}

export function setMaterialUnitKind(data: WorkspaceData, id: string, kind: UnitKind): WorkspaceData {
  const d = clone(data);
  const m = d.snapshot.materials.find((x) => x.id === id);
  if (m) {
    m.unit_kind = kind;
    m.base_unit = UNIT_FOR_KIND[kind];
  }
  return d;
}

export function removeMaterial(data: WorkspaceData, id: string): WorkspaceData {
  const d = clone(data);
  const deliveries = d.snapshot.committed_deliveries.filter((x) => x.material_id === id).map((x) => x.id);
  const offers = d.snapshot.alternative_offers.filter((x) => x.material_id === id).map((x) => x.id);
  d.snapshot.materials = d.snapshot.materials.filter((m) => m.id !== id);
  d.snapshot.bom = d.snapshot.bom.filter((b) => b.material_id !== id);
  d.snapshot.committed_deliveries = d.snapshot.committed_deliveries.filter((x) => x.material_id !== id);
  d.snapshot.alternative_offers = d.snapshot.alternative_offers.filter((x) => x.material_id !== id);
  pruneScenarios(d, { materials: [id], deliveries, offers });
  return d;
}

export function addProduct(data: WorkspaceData, name: string): WorkspaceData {
  const d = clone(data);
  const id = slugify(name, d.snapshot.products.map((p) => p.id), "produk");
  d.snapshot.products.push({ id, name: name.trim() || "Produk baru", demand_units: 0, unit_contribution_idr: 0 });
  return d;
}

export function removeProduct(data: WorkspaceData, id: string): WorkspaceData {
  const d = clone(data);
  d.snapshot.products = d.snapshot.products.filter((p) => p.id !== id);
  d.snapshot.bom = d.snapshot.bom.filter((b) => b.product_id !== id);
  pruneScenarios(d, { products: [id] });
  return d;
}

/** Atur kebutuhan bahan per produk; `quantity <= 0` menghapus baris resep. */
export function setBomQuantity(data: WorkspaceData, productId: string, materialId: string, quantity: number): WorkspaceData {
  const d = clone(data);
  const rest = d.snapshot.bom.filter((b) => !(b.product_id === productId && b.material_id === materialId));
  if (quantity > 0) rest.push({ product_id: productId, material_id: materialId, quantity_per_product: quantity });
  d.snapshot.bom = rest;
  return d;
}

export function addCommittedDelivery(data: WorkspaceData, supplierId: string, materialId: string): WorkspaceData {
  const d = clone(data);
  const id = slugify(`${supplierId}_${materialId}_delivery`, d.snapshot.committed_deliveries.map((x) => x.id));
  d.snapshot.committed_deliveries.push({
    id,
    supplier_id: supplierId,
    material_id: materialId,
    quantity_base_units: 1,
    arrival_date: d.snapshot.scenario_date,
    enabled_in_baseline: true,
  });
  return d;
}

export function removeCommittedDelivery(data: WorkspaceData, id: string): WorkspaceData {
  const d = clone(data);
  d.snapshot.committed_deliveries = d.snapshot.committed_deliveries.filter((x) => x.id !== id);
  pruneScenarios(d, { deliveries: [id] });
  return d;
}

export function addAlternativeOffer(data: WorkspaceData, supplierId: string, materialId: string): WorkspaceData {
  const d = clone(data);
  const id = slugify(`${supplierId}_${materialId}_offer`, d.snapshot.alternative_offers.map((x) => x.id));
  d.snapshot.alternative_offers.push({
    id,
    supplier_id: supplierId,
    material_id: materialId,
    pack_size_base_units: 1000,
    max_packs: 10,
    lead_days: 1,
    incremental_premium_idr_per_pack: 0,
    enabled_in_scenario: true,
  });
  return d;
}

export function removeAlternativeOffer(data: WorkspaceData, id: string): WorkspaceData {
  const d = clone(data);
  d.snapshot.alternative_offers = d.snapshot.alternative_offers.filter((x) => x.id !== id);
  pruneScenarios(d, { offers: [id] });
  return d;
}

/** Tambah skenario kustom sebagai salinan skenario `fromId`; diabaikan bila sudah mencapai batas. */
export function addScenario(data: WorkspaceData, fromId: string, name: string): WorkspaceData {
  if (data.scenarios.length >= MAX_SCENARIOS) return data;
  const d = clone(data);
  const source = d.scenarios.find((s) => s.id === fromId) ?? d.scenarios[0];
  const id = slugify(name, d.scenarios.map((s) => s.id), "skenario");
  const copy: ScenarioConfig = { ...structuredClone(source), id, name: name.trim() || "Skenario baru", source: "user" };
  d.scenarios.push(copy);
  return d;
}

export function removeScenario(data: WorkspaceData, id: string): WorkspaceData {
  if ((CORE_SCENARIO_IDS as readonly string[]).includes(id)) return data;
  const d = clone(data);
  d.scenarios = d.scenarios.filter((s) => s.id !== id);
  return d;
}

export function updateScenario(data: WorkspaceData, next: ScenarioConfig): WorkspaceData {
  const d = clone(data);
  d.scenarios = d.scenarios.map((s) => (s.id === next.id ? next : s));
  return d;
}

export interface OutageScenarioPrep {
  data: WorkspaceData;
  scenarioId: string;
  created: boolean;
  fallbackUpdated: boolean;
}

/**
 * Siapkan skenario uji gangguan pemasok tunggal: pakai yang sudah ada bila cocok,
 * buat baru berbasis `baseline` jika kuota masih tersedia, atau perbarui `outage` saat penuh.
 */
export function prepareSupplierOutageScenario(data: WorkspaceData, supplierId: string): OutageScenarioPrep {
  const existing = data.scenarios.find(
    (s) =>
      s.id !== "baseline" &&
      s.disabled_supplier_ids.length === 1 &&
      s.disabled_supplier_ids[0] === supplierId &&
      s.enabled_offer_ids.length === 0,
  );
  if (existing) {
    return { data, scenarioId: existing.id, created: false, fallbackUpdated: false };
  }

  const d = clone(data);
  if (d.scenarios.length < MAX_SCENARIOS) {
    const baseline = d.scenarios.find((s) => s.id === "baseline") ?? d.scenarios[0];
    const supplierName = d.snapshot.suppliers.find((s) => s.id === supplierId)?.name ?? supplierId;
    const name = `Uji Gagal: ${supplierName}`.slice(0, 100);
    const id = slugify(name, d.scenarios.map((s) => s.id), "uji_gagal");
    const created: ScenarioConfig = {
      ...structuredClone(baseline),
      id,
      name,
      disabled_supplier_ids: [supplierId],
      enabled_offer_ids: [],
      source: "user",
    };
    d.scenarios.push(created);
    return { data: d, scenarioId: id, created: true, fallbackUpdated: false };
  }

  const outage = d.scenarios.find((s) => s.id === "outage") ?? d.scenarios[0];
  outage.disabled_supplier_ids = [supplierId];
  outage.enabled_offer_ids = [];
  outage.disruptions = [];
  return { data: d, scenarioId: outage.id, created: false, fallbackUpdated: true };
}
