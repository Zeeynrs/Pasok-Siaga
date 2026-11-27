import { DAPUR_SARI_FALLBACK_FIXTURE } from "./fixture";
import type { ScenarioConfig, WorkspaceData } from "./types";
import { validateWorkspaceData } from "./validation";

export interface StarterTemplate {
  id: string;
  name: string;
  sector: string;
  tagline: string;
  highlight: string;
  data: WorkspaceData;
}

const PLAN_CUTOFF = "2026-11-24";
const SCENARIO_DATE = "2026-11-23";

function coreScenarios(primarySupplierId: string, backupOfferId: string): ScenarioConfig[] {
  return [
    {
      id: "baseline",
      name: "Normal",
      cutoff_date: PLAN_CUTOFF,
      disabled_supplier_ids: [],
      enabled_offer_ids: [],
      disruptions: [],
      overrides: {},
      source: "demo",
    },
    {
      id: "outage",
      name: "Pemasok Utama Gagal",
      cutoff_date: PLAN_CUTOFF,
      disabled_supplier_ids: [primarySupplierId],
      enabled_offer_ids: [],
      disruptions: [],
      overrides: {},
      source: "demo",
    },
    {
      id: "mitigation",
      name: "Mitigasi: Pemasok Alternatif Aktif",
      cutoff_date: PLAN_CUTOFF,
      disabled_supplier_ids: [primarySupplierId],
      enabled_offer_ids: [backupOfferId],
      disruptions: [],
      overrides: {},
      source: "demo",
    },
  ];
}

export const STARTER_TEMPLATES: readonly StarterTemplate[] = [
  {
    id: "dapur_sari",
    name: "Toko Roti & Kue (Dapur Sari)",
    sector: "Toko roti dan kue",
    tagline: "Produksi roti dan kue kering harian dengan pasokan tepung terjadwal.",
    highlight: "2 pemasok · 3 bahan · 2 produk",
    data: DAPUR_SARI_FALLBACK_FIXTURE,
  },
  {
    id: "kedai_kopi",
    name: "Kedai Kopi Susu",
    sector: "Kedai kopi & minuman",
    tagline: "Es kopi susu aren dan kopi karamel yang bergantung pada pasokan susu segar.",
    highlight: "2 pemasok · 3 bahan · 2 produk",
    data: {
      snapshot: {
        business: {
          id: "kedai_kopi",
          name: "Kedai Kopi Susu",
          sector: "Kedai kopi & minuman",
          currency: "IDR",
          planning_cutoff_date: PLAN_CUTOFF,
          scenario_date: SCENARIO_DATE,
        },
        suppliers: [
          { id: "supplier_susu_utama", name: "Pemasok Susu Segar", active: true, notes: "Pemasok utama susu segar harian." },
          { id: "supplier_susu_cadangan", name: "Distributor Minuman Cadangan", active: true, notes: "Pemasok alternatif susu karton." },
        ],
        materials: [
          { id: "susu", name: "Susu segar", unit_kind: "volume", base_unit: "ml", stock_on_hand: 6000 },
          { id: "biji_kopi", name: "Biji kopi espresso", unit_kind: "mass", base_unit: "g", stock_on_hand: 4000 },
          { id: "gula_aren", name: "Gula aren cair", unit_kind: "volume", base_unit: "ml", stock_on_hand: 5000 },
        ],
        products: [
          { id: "kopi_susu", name: "Es Kopi Susu Aren", demand_units: 120, unit_contribution_idr: 10000 },
          { id: "kopi_karamel", name: "Kopi Susu Karamel", demand_units: 40, unit_contribution_idr: 12000 },
        ],
        bom: [
          { product_id: "kopi_susu", material_id: "susu", quantity_per_product: 150 },
          { product_id: "kopi_susu", material_id: "biji_kopi", quantity_per_product: 18 },
          { product_id: "kopi_susu", material_id: "gula_aren", quantity_per_product: 25 },
          { product_id: "kopi_karamel", material_id: "susu", quantity_per_product: 180 },
          { product_id: "kopi_karamel", material_id: "biji_kopi", quantity_per_product: 18 },
          { product_id: "kopi_karamel", material_id: "gula_aren", quantity_per_product: 20 },
        ],
        committed_deliveries: [
          {
            id: "susu_delivery_utama",
            supplier_id: "supplier_susu_utama",
            material_id: "susu",
            quantity_base_units: 20000,
            arrival_date: SCENARIO_DATE,
            enabled_in_baseline: true,
          },
        ],
        alternative_offers: [
          {
            id: "susu_offer_cadangan",
            supplier_id: "supplier_susu_cadangan",
            material_id: "susu",
            pack_size_base_units: 1000,
            max_packs: 12,
            lead_days: 1,
            incremental_premium_idr_per_pack: 4000,
            enabled_in_scenario: true,
          },
        ],
        scenario_date: SCENARIO_DATE,
        demo_data: true,
      },
      scenarios: coreScenarios("supplier_susu_utama", "susu_offer_cadangan"),
    },
  },
  {
    id: "dimsum_beku",
    name: "Dimsum & Frozen Food",
    sector: "Makanan beku & camilan",
    tagline: "Produksi dimsum ayam dan siomay kukus dengan pasokan daging giling dingin.",
    highlight: "2 pemasok · 3 bahan · 2 produk",
    data: {
      snapshot: {
        business: {
          id: "dimsum_beku",
          name: "Dimsum & Frozen Food",
          sector: "Makanan beku & camilan",
          currency: "IDR",
          planning_cutoff_date: PLAN_CUTOFF,
          scenario_date: SCENARIO_DATE,
        },
        suppliers: [
          { id: "supplier_ayam_utama", name: "Pemasok Daging Segar", active: true, notes: "Pemasok utama daging ayam giling." },
          { id: "supplier_ayam_cadangan", name: "Pemasok Beku Alternatif", active: true, notes: "Pemasok cadangan daging ayam beku." },
        ],
        materials: [
          { id: "daging_ayam", name: "Daging ayam giling", unit_kind: "mass", base_unit: "g", stock_on_hand: 4000 },
          { id: "kulit_dimsum", name: "Kulit dimsum", unit_kind: "count", base_unit: "pcs", stock_on_hand: 2000 },
          { id: "tepung_tapioka", name: "Tepung tapioka", unit_kind: "mass", base_unit: "g", stock_on_hand: 6000 },
        ],
        products: [
          { id: "dimsum_ayam", name: "Dimsum Ayam (pak)", demand_units: 80, unit_contribution_idr: 8000 },
          { id: "siomay_kukus", name: "Siomay Kukus (pak)", demand_units: 50, unit_contribution_idr: 10000 },
        ],
        bom: [
          { product_id: "dimsum_ayam", material_id: "daging_ayam", quantity_per_product: 120 },
          { product_id: "dimsum_ayam", material_id: "kulit_dimsum", quantity_per_product: 4 },
          { product_id: "dimsum_ayam", material_id: "tepung_tapioka", quantity_per_product: 30 },
          { product_id: "siomay_kukus", material_id: "daging_ayam", quantity_per_product: 150 },
          { product_id: "siomay_kukus", material_id: "kulit_dimsum", quantity_per_product: 5 },
          { product_id: "siomay_kukus", material_id: "tepung_tapioka", quantity_per_product: 40 },
        ],
        committed_deliveries: [
          {
            id: "ayam_delivery_utama",
            supplier_id: "supplier_ayam_utama",
            material_id: "daging_ayam",
            quantity_base_units: 14000,
            arrival_date: SCENARIO_DATE,
            enabled_in_baseline: true,
          },
        ],
        alternative_offers: [
          {
            id: "ayam_offer_cadangan",
            supplier_id: "supplier_ayam_cadangan",
            material_id: "daging_ayam",
            pack_size_base_units: 1000,
            max_packs: 10,
            lead_days: 1,
            incremental_premium_idr_per_pack: 5000,
            enabled_in_scenario: true,
          },
        ],
        scenario_date: SCENARIO_DATE,
        demo_data: true,
      },
      scenarios: coreScenarios("supplier_ayam_utama", "ayam_offer_cadangan"),
    },
  },
  {
    id: "martabak_kue",
    name: "Martabak & Kue Malam",
    sector: "Kuliner malam & jajanan",
    tagline: "Martabak manis dan terang bulan mini dengan ketergantungan pada pasokan keju.",
    highlight: "2 pemasok · 3 bahan · 2 produk",
    data: {
      snapshot: {
        business: {
          id: "martabak_kue",
          name: "Martabak & Kue Malam",
          sector: "Kuliner malam & jajanan",
          currency: "IDR",
          planning_cutoff_date: PLAN_CUTOFF,
          scenario_date: SCENARIO_DATE,
        },
        suppliers: [
          { id: "supplier_keju_utama", name: "Agen Bahan Kue Utama", active: true, notes: "Pemasok utama keju cheddar." },
          { id: "supplier_keju_cadangan", name: "Grosir Bahan Kue Cadangan", active: true, notes: "Pemasok darurat keju blok." },
        ],
        materials: [
          { id: "keju", name: "Keju cheddar", unit_kind: "mass", base_unit: "g", stock_on_hand: 3000 },
          { id: "tepung_terigu", name: "Tepung terigu", unit_kind: "mass", base_unit: "g", stock_on_hand: 25000 },
          { id: "susu_kental", name: "Susu kental manis", unit_kind: "volume", base_unit: "ml", stock_on_hand: 15000 },
        ],
        products: [
          { id: "martabak_keju", name: "Martabak Manis Keju", demand_units: 60, unit_contribution_idr: 15000 },
          { id: "terang_bulan_mini", name: "Terang Bulan Mini", demand_units: 40, unit_contribution_idr: 12000 },
        ],
        bom: [
          { product_id: "martabak_keju", material_id: "keju", quantity_per_product: 150 },
          { product_id: "martabak_keju", material_id: "tepung_terigu", quantity_per_product: 250 },
          { product_id: "martabak_keju", material_id: "susu_kental", quantity_per_product: 60 },
          { product_id: "terang_bulan_mini", material_id: "keju", quantity_per_product: 100 },
          { product_id: "terang_bulan_mini", material_id: "tepung_terigu", quantity_per_product: 200 },
          { product_id: "terang_bulan_mini", material_id: "susu_kental", quantity_per_product: 50 },
        ],
        committed_deliveries: [
          {
            id: "keju_delivery_utama",
            supplier_id: "supplier_keju_utama",
            material_id: "keju",
            quantity_base_units: 11000,
            arrival_date: SCENARIO_DATE,
            enabled_in_baseline: true,
          },
        ],
        alternative_offers: [
          {
            id: "keju_offer_cadangan",
            supplier_id: "supplier_keju_cadangan",
            material_id: "keju",
            pack_size_base_units: 1000,
            max_packs: 8,
            lead_days: 1,
            incremental_premium_idr_per_pack: 6000,
            enabled_in_scenario: true,
          },
        ],
        scenario_date: SCENARIO_DATE,
        demo_data: true,
      },
      scenarios: coreScenarios("supplier_keju_utama", "keju_offer_cadangan"),
    },
  },
];

/**
 * Terapkan template starter pilihan ke workspace saat ini sambil menjaga `business.id`
 * serta menyelaraskan flag `demo_data` dan `source` skenario dengan mode aktif.
 */
export function applyStarterTemplate(
  current: WorkspaceData,
  templateId: string,
  mode: "demo" | "workspace",
): WorkspaceData {
  const template = STARTER_TEMPLATES.find((item) => item.id === templateId);
  if (!template) {
    throw new Error(`Template "${templateId}" tidak ditemukan.`);
  }

  const next = structuredClone(template.data);
  next.snapshot.business.id = current.snapshot.business.id;
  next.snapshot.demo_data = mode === "demo";
  const source = mode === "demo" ? "demo" : "user";
  next.scenarios = next.scenarios.map((scenario) => ({ ...scenario, source }));

  return validateWorkspaceData(next);
}
