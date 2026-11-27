import type { ScenarioConfig, ScenarioResult, SolverStatus as DomainStatus, WorkspaceSnapshot } from "@/lib/domain/types";
import { resolveScenarioInputs } from "@/lib/solver/inputs";
import type {
  ComparisonResult,
  NetworkEdge,
  NetworkNode,
  NetworkResult,
  SimulationResult,
  SolverStatus,
} from "@/lib/types";

/**
 * Adaptor dari model domain/solver ke tipe tampilan. Teks penjelasan dan peringatan dalam Bahasa Indonesia
 * dibangun di sini agar komponen UI tetap sederhana.
 */

const formatInt = (n: number) => n.toLocaleString("id-ID");

/** Pesan gangguan (pemasok dinonaktifkan atau pengiriman melewati batas) untuk satu skenario. */
function disruptionNotes(snapshot: WorkspaceSnapshot, scenario: ScenarioConfig): string[] {
  const inputs = resolveScenarioInputs(snapshot, scenario);
  const notes = snapshot.suppliers
    .filter((s) => scenario.disabled_supplier_ids.includes(s.id))
    .map((s) => `${s.name} dinonaktifkan dalam skenario ini.`);
  for (const status of inputs.deliveryStatuses) {
    if (status.counted || !status.reason?.startsWith("Tiba")) continue;
    const delivery = snapshot.committed_deliveries.find((d) => d.id === status.delivery_id);
    const supplier = snapshot.suppliers.find((s) => s.id === delivery?.supplier_id);
    if (!supplier) continue;
    notes.push(
      status.delay_days > 0
        ? `Pengiriman dari ${supplier.name} tertunda ${status.delay_days} hari dan tiba ${status.effective_arrival}, setelah batas waktu produksi.`
        : `Pengiriman dari ${supplier.name} pada ${status.effective_arrival} tiba setelah batas waktu produksi.`,
    );
  }
  return [...new Set(notes)];
}

/** Peringatan untuk penawaran yang diaktifkan di skenario tetapi tidak dapat dipakai. */
function offerWarnings(snapshot: WorkspaceSnapshot, scenario: ScenarioConfig): string[] {
  const inputs = resolveScenarioInputs(snapshot, scenario);
  const warnings: string[] = [];
  for (const info of inputs.offerInfo) {
    if (!scenario.enabled_offer_ids.includes(info.offer.id) || info.eligible) continue;
    const material = snapshot.materials.find((m) => m.id === info.offer.material_id)?.name ?? info.offer.material_id;
    const supplier = snapshot.suppliers.find((s) => s.id === info.offer.supplier_id)?.name ?? info.offer.supplier_id;
    const label = `Penawaran ${material} dari ${supplier}`;
    if (info.reason === "Dinonaktifkan di Data Usaha") warnings.push(`${label} dinonaktifkan pada data pasokan.`);
    else if (info.reason?.startsWith("Tiba")) warnings.push(`${label} tiba setelah batas waktu produksi.`);
    else warnings.push(`${label} tidak tersedia selama waktu pemesanan dan pengiriman.`);
  }
  return warnings;
}

/* ------------------------------- Jaringan pasok ------------------------------ */

export function analyzeNetwork(snapshot: WorkspaceSnapshot, scenario: ScenarioConfig): NetworkResult {
  const inputs = resolveScenarioInputs(snapshot, scenario);
  const counted = new Map(inputs.deliveryStatuses.map((d) => [d.delivery_id, d.counted]));
  const offerById = new Map(inputs.offerInfo.map((o) => [o.offer.id, o]));

  const edges: NetworkEdge[] = [];
  const suppliersPerMaterial = new Map<string, Set<string>>();
  const activeSuppliers = new Set<string>();
  const available = new Map(snapshot.materials.map((m) => [m.id, scenario.overrides.stock_by_material?.[m.id] ?? m.stock_on_hand]));
  const productsPerMaterial = new Map<string, string[]>();
  const unreadyProducts = new Set<string>();

  const supplyEdge = (kind: "committed" | "alternative", supplyId: string, supplierId: string, materialId: string, units: number) => {
    if (units > 0) {
      suppliersPerMaterial.set(materialId, (suppliersPerMaterial.get(materialId) ?? new Set()).add(supplierId));
      activeSuppliers.add(supplierId);
      available.set(materialId, (available.get(materialId) ?? 0) + units);
    }
    edges.push({
      id: `${kind}:${supplyId}`,
      source: `supplier:${supplierId}`,
      target: `material:${materialId}`,
      kind,
      active: units > 0,
    });
  };

  for (const d of snapshot.committed_deliveries) {
    supplyEdge("committed", d.id, d.supplier_id, d.material_id, counted.get(d.id) ? d.quantity_base_units : 0);
  }
  for (const o of snapshot.alternative_offers) {
    supplyEdge("alternative", o.id, o.supplier_id, o.material_id, (offerById.get(o.id)?.maxPacks ?? 0) * o.pack_size_base_units);
  }
  for (const item of snapshot.bom) {
    productsPerMaterial.set(item.material_id, [...(productsPerMaterial.get(item.material_id) ?? []), item.product_id]);
    if ((available.get(item.material_id) ?? 0) < item.quantity_per_product) unreadyProducts.add(item.product_id);
    edges.push({
      id: `bom:${item.material_id}:${item.product_id}`,
      source: `material:${item.material_id}`,
      target: `product:${item.product_id}`,
      kind: "bom",
      active: true,
    });
  }

  const nodes: NetworkNode[] = [];
  for (const s of snapshot.suppliers) {
    const active = activeSuppliers.has(s.id);
    nodes.push({
      id: `supplier:${s.id}`, entity_id: s.id, kind: "supplier", label: s.name,
      status: active ? "active" : "inactive",
      detail: active ? "Pasokan memenuhi batas skenario." : "Pasokan tidak dihitung dalam skenario ini.",
    });
  }

  const risks: NetworkResult["single_source_risks"] = [];
  const warnings = [...disruptionNotes(snapshot, scenario), ...offerWarnings(snapshot, scenario)];
  const supplierName = new Map(snapshot.suppliers.map((s) => [s.id, s.name]));
  for (const m of snapshot.materials) {
    const supplierIds = [...(suppliersPerMaterial.get(m.id) ?? [])].sort();
    const productIds = [...(productsPerMaterial.get(m.id) ?? [])].sort();
    const stock = scenario.overrides.stock_by_material?.[m.id] ?? m.stock_on_hand;
    let status: NetworkNode["status"];
    if (supplierIds.length === 1) {
      status = "single_source";
      risks.push({ material_id: m.id, supplier_id: supplierIds[0], product_ids: productIds });
      warnings.push(`${m.name} bergantung pada satu pemasok aktif, ${supplierName.get(supplierIds[0])}.`);
    } else if (supplierIds.length > 1) {
      status = "ready";
    } else if (stock > 0) {
      status = "stock_only";
    } else {
      status = "inactive";
      if (productIds.length) warnings.push(`${m.name} tidak memiliki stok atau pemasok aktif dalam skenario ini.`);
    }
    nodes.push({
      id: `material:${m.id}`, entity_id: m.id, kind: "material", label: m.name, status,
      detail: `${supplierIds.length} pemasok masuk perhitungan. Stok awal ${formatInt(stock)} ${m.base_unit}.`,
    });
  }

  for (const p of snapshot.products) {
    const ready = !unreadyProducts.has(p.id);
    nodes.push({
      id: `product:${p.id}`, entity_id: p.id, kind: "product", label: p.name, status: ready ? "ready" : "inactive",
      detail: ready
        ? "Pasokan potensial mencukupi kebutuhan bahan untuk satu unit."
        : "Pasokan potensial belum mencukupi kebutuhan bahan untuk satu unit.",
    });
  }

  return { nodes, edges, single_source_risks: risks, warnings: [...new Set(warnings)] };
}

/* ---------------------------------- Simulasi --------------------------------- */

const STATUS: Record<DomainStatus, SolverStatus> = { Optimal: "OPTIMAL", Infeasible: "INFEASIBLE", Error: "ERROR" };
const STATUS_WARNING: Partial<Record<SolverStatus, string>> = {
  INFEASIBLE: "Solver tidak menemukan rencana yang memenuhi batas model.",
  ERROR: "Rencana produksi tidak dapat dihitung atau diverifikasi. Coba lagi.",
};

export function toSimulationView(result: ScenarioResult, snapshot: WorkspaceSnapshot, scenario: ScenarioConfig): SimulationResult {
  const status = STATUS[result.status];
  const hasPlan = result.status === "Optimal";

  const production = snapshot.products.flatMap((p) => {
    const line = result.production.find((l) => l.product_id === p.id);
    return line ? [{ product_id: p.id, name: p.name, units: line.units, demand_units: line.demand_units, unmet_units: Math.max(0, line.demand_units - line.units) }] : [];
  });
  const material_usage = snapshot.materials.flatMap((m) => {
    const usage = result.material_usage.find((u) => u.material_id === m.id);
    return usage
      ? [{
          material_id: m.id, name: m.name, base_unit: m.base_unit,
          available_units: usage.available, used_units: usage.used, remaining_units: usage.remaining,
          is_bottleneck: result.bottleneck_material_ids.includes(m.id),
        }]
      : [];
  });
  const purchases = result.alternative_purchases
    .filter((a) => a.packs_bought > 0)
    .flatMap((a) => {
      const offer = snapshot.alternative_offers.find((o) => o.id === a.offer_id);
      return offer
        ? [{
            offer_id: a.offer_id, supplier_id: offer.supplier_id, material_id: offer.material_id,
            packs: a.packs_bought, base_units: a.quantity_base_units, incremental_premium_idr: a.premium_idr,
          }]
        : [];
    });

  const explanations = disruptionNotes(snapshot, scenario);
  const warnings = offerWarnings(snapshot, scenario);
  const statusWarning = STATUS_WARNING[status];
  if (statusWarning) warnings.push(statusWarning);

  if (hasPlan) {
    const plan = production
      .filter((p) => p.unmet_units > 0)
      .map((p) => `Permintaan ${p.name} yang belum terpenuhi sebanyak ${formatInt(p.unmet_units)} unit.`);
    for (const m of material_usage) {
      if (m.is_bottleneck) plan.push(`Pasokan ${m.name} membatasi tambahan produksi pada rencana ini.`);
    }
    const supplierName = new Map(snapshot.suppliers.map((s) => [s.id, s.name]));
    const materialName = new Map(snapshot.materials.map((m) => [m.id, m.name]));
    for (const p of purchases) {
      plan.push(`Rencana memakai ${formatInt(p.packs)} pak ${materialName.get(p.material_id)} dari ${supplierName.get(p.supplier_id)}.`);
    }
    if (explanations.length === 0 && plan.length === 0) {
      plan.push("Stok dan pengiriman yang dipakai pada rencana ini memenuhi semua permintaan.");
    }
    explanations.push(...plan);
  }

  return {
    scenario_id: scenario.id,
    scenario_name: scenario.name,
    solver_status: status,
    cutoff_date: scenario.cutoff_date,
    production: hasPlan ? production : [],
    purchases: hasPlan ? purchases : [],
    material_usage: hasPlan ? material_usage : [],
    kpis: hasPlan
      ? {
          gross_contribution_idr: result.gross_contribution_idr,
          incremental_premium_idr: result.alternative_premium_idr,
          net_contribution_idr: result.net_contribution_idr,
        }
      : null,
    explanations,
    warnings,
  };
}

/* -------------------------------- Perbandingan ------------------------------- */

export interface ComparisonRoles {
  baselineId: string;
  outageId: string;
  mitigationId: string;
}

const DEFAULT_COMPARISON_ROLES: ComparisonRoles = {
  baselineId: "baseline",
  outageId: "outage",
  mitigationId: "mitigation",
};

const pct = (delta: number | null, reference: number | null) =>
  reference && delta !== null ? (delta * 100) / reference : null;

/** Menyusun ringkasan KPI pemulihan (dari semua skenario sesuai peran) serta selisih berurutan dan peringatan atas skenario terlihat. */
function summarizeComparison(
  allViews: SimulationResult[],
  visibleViews: SimulationResult[],
  roles: ComparisonRoles,
): ComparisonResult {
  const net = (id: string) => allViews.find((v) => v.scenario_id === id)?.kpis?.net_contribution_idr ?? null;

  const deltas = visibleViews.slice(1).map((current, i) => {
    const previous = visibleViews[i];
    const from = previous.kpis?.net_contribution_idr ?? null;
    const to = current.kpis?.net_contribution_idr ?? null;
    const delta = from !== null && to !== null ? to - from : null;
    return {
      from_scenario_id: previous.scenario_id,
      to_scenario_id: current.scenario_id,
      net_contribution_delta_idr: delta,
      net_contribution_delta_pct: pct(delta, from),
    };
  });

  const baseline = net(roles.baselineId);
  const outage = net(roles.outageId);
  const mitigation = net(roles.mitigationId);
  const atRisk = baseline !== null && outage !== null ? Math.max(0, baseline - outage) : null;
  const recovered = mitigation !== null && outage !== null ? mitigation - outage : null;

  const warnings: string[] = [];
  if (visibleViews.some((v) => v.kpis === null)) warnings.push("Selisih untuk skenario yang belum memiliki rencana tidak dapat dihitung.");
  if (recovered !== null && recovered < 0) {
    warnings.push("Skenario mitigasi menghasilkan estimasi kontribusi lebih rendah daripada skenario gangguan.");
  }

  return {
    results: visibleViews,
    deltas,
    contribution_at_risk_idr: atRisk,
    recovered_contribution_idr: recovered,
    recovery_pct: pct(recovered, atRisk),
    warnings,
  };
}

export function toComparisonView(
  results: ScenarioResult[],
  scenarios: ScenarioConfig[],
  snapshot: WorkspaceSnapshot,
): ComparisonResult {
  const views = scenarios.flatMap((scenario) => {
    const result = results.find((r) => r.scenario_id === scenario.id);
    return result ? [toSimulationView(result, snapshot, scenario)] : [];
  });
  return summarizeComparison(views, views, DEFAULT_COMPARISON_ROLES);
}

/** Menghitung ulang tampilan perbandingan secara lokal berdasarkan peran pembanding dan daftar skenario yang terlihat. */
export function recomputeComparisonView(
  outcome: ComparisonResult,
  roles: ComparisonRoles,
  visibleIds?: string[],
): ComparisonResult {
  const visibleSet = visibleIds ? new Set(visibleIds) : null;
  const visibleViews = visibleSet
    ? outcome.results.filter((v) => visibleSet.has(v.scenario_id))
    : outcome.results;
  return summarizeComparison(outcome.results, visibleViews, roles);
}
