import { beforeAll, describe, expect, it } from "vitest";
import { DAPUR_SARI_FALLBACK_FIXTURE } from "@/lib/domain/fixture";
import type { ScenarioResult, WorkspaceData } from "@/lib/domain/types";
import { analyzeNetwork, recomputeComparisonView, toComparisonView, toSimulationView } from "@/lib/view-models";
import { solveScenario } from "@/lib/solver/milp-solver";

const fresh = (): WorkspaceData => structuredClone(DAPUR_SARI_FALLBACK_FIXTURE);
const byId = (id: string) => fresh().scenarios.find((s) => s.id === id)!;
let results: ScenarioResult[];

beforeAll(async () => {
  const { snapshot, scenarios } = fresh();
  results = await Promise.all(scenarios.map((s) => solveScenario(snapshot, s)));
});

describe("analyzeNetwork", () => {
  it("normal: supplier A active, flour single-source, sugar/butter stock-only, products ready", () => {
    const net = analyzeNetwork(fresh().snapshot, byId("baseline"));
    const node = (id: string) => net.nodes.find((n) => n.id === id)!;
    expect(node("supplier:supplier_a").status).toBe("active");
    expect(node("supplier:supplier_b").status).toBe("inactive");
    expect(node("material:flour").status).toBe("single_source");
    expect(node("material:sugar").status).toBe("stock_only");
    expect(node("material:butter").status).toBe("stock_only");
    expect(node("product:bread").status).toBe("ready");
    expect(net.single_source_risks).toEqual([
      { material_id: "flour", supplier_id: "supplier_a", product_ids: ["bread", "cookies"] },
    ]);
    expect(net.warnings).toContain("Tepung terigu bergantung pada satu pemasok aktif, Pemasok A.");
    expect(node("material:flour").detail).toBe("1 pemasok masuk perhitungan. Stok awal 8.000 g.");
  });

  it("builds ref-compatible node and edge ids with active flags", () => {
    const net = analyzeNetwork(fresh().snapshot, byId("baseline"));
    const edge = (id: string) => net.edges.find((e) => e.id === id)!;
    expect(edge("committed:supplier_a_flour_delivery")).toMatchObject({
      source: "supplier:supplier_a", target: "material:flour", kind: "committed", active: true,
    });
    expect(edge("alternative:supplier_b_flour_offer")).toMatchObject({ kind: "alternative", active: false });
    expect(edge("bom:flour:bread")).toMatchObject({ source: "material:flour", target: "product:bread", kind: "bom", active: true });
    expect(net.edges).toHaveLength(8);
  });

  it("outage: supplier A inactive, flour falls back to stock-only, and the outage is explained", () => {
    const net = analyzeNetwork(fresh().snapshot, byId("outage"));
    expect(net.nodes.find((n) => n.id === "supplier:supplier_a")!.status).toBe("inactive");
    expect(net.nodes.find((n) => n.id === "material:flour")!.status).toBe("stock_only");
    expect(net.single_source_risks).toEqual([]);
    expect(net.warnings).toContain("Pemasok A dinonaktifkan dalam skenario ini.");
  });

  it("mitigation: supplier B becomes the single active source of flour", () => {
    const net = analyzeNetwork(fresh().snapshot, byId("mitigation"));
    expect(net.nodes.find((n) => n.id === "supplier:supplier_b")!.status).toBe("active");
    expect(net.single_source_risks[0]).toMatchObject({ material_id: "flour", supplier_id: "supplier_b" });
  });

  it("warns about offers that arrive after the cutoff and products that cannot be made", () => {
    const d = fresh();
    d.snapshot.alternative_offers[0].lead_days = 3;
    const net = analyzeNetwork(d.snapshot, d.scenarios.find((s) => s.id === "mitigation")!);
    expect(net.warnings).toContain("Penawaran Tepung terigu dari Pemasok B tiba setelah batas waktu produksi.");

    const empty = fresh();
    empty.snapshot.materials[0].stock_on_hand = 0;
    const out = analyzeNetwork(empty.snapshot, empty.scenarios.find((s) => s.id === "outage")!);
    expect(out.nodes.find((n) => n.id === "material:flour")!.status).toBe("inactive");
    expect(out.nodes.find((n) => n.id === "product:bread")!.status).toBe("inactive");
    expect(out.warnings).toContain("Tepung terigu tidak memiliki stok atau pemasok aktif dalam skenario ini.");
  });
});

describe("toSimulationView", () => {
  it("normal: optimal plan, full demand, one explanation", () => {
    const { snapshot } = fresh();
    const view = toSimulationView(results[0], snapshot, byId("baseline"));
    expect(view.solver_status).toBe("OPTIMAL");
    expect(view.scenario_name).toBe("Normal");
    expect(view.cutoff_date).toBe("2026-11-24");
    expect(view.kpis).toEqual({ gross_contribution_idr: 450_000, incremental_premium_idr: 0, net_contribution_idr: 450_000 });
    expect(view.production.find((p) => p.product_id === "bread")).toMatchObject({ name: "Roti", units: 100, unmet_units: 0 });
    expect(view.purchases).toEqual([]);
    expect(view.explanations).toEqual(["Stok dan pengiriman yang dipakai pada rencana ini memenuhi semua permintaan."]);
  });

  it("outage: explains the disabled supplier, unmet demand and the limiting material", () => {
    const view = toSimulationView(results[1], fresh().snapshot, byId("outage"));
    expect(view.kpis!.net_contribution_idr).toBe(210_000);
    expect(view.explanations).toEqual([
      "Pemasok A dinonaktifkan dalam skenario ini.",
      "Permintaan Roti yang belum terpenuhi sebanyak 80 unit.",
      "Pasokan Tepung terigu membatasi tambahan produksi pada rencana ini.",
    ]);
    const flour = view.material_usage.find((m) => m.material_id === "flour")!;
    expect(flour).toMatchObject({ name: "Tepung terigu", base_unit: "g", used_units: 8000, remaining_units: 0, is_bottleneck: true });
  });

  it("mitigation: lists the alternative purchase with its premium", () => {
    const view = toSimulationView(results[2], fresh().snapshot, byId("mitigation"));
    expect(view.purchases).toEqual([
      {
        offer_id: "supplier_b_flour_offer", supplier_id: "supplier_b", material_id: "flour",
        packs: 12, base_units: 12_000, incremental_premium_idr: 12_000,
      },
    ]);
    expect(view.kpis).toMatchObject({ gross_contribution_idr: 354_000, incremental_premium_idr: 12_000, net_contribution_idr: 342_000 });
    expect(view.explanations).toContain("Rencana memakai 12 pak Tepung terigu dari Pemasok B.");
  });

  it("adds an offer warning when an enabled offer cannot be used, and handles solver failures", () => {
    const d = fresh();
    d.snapshot.alternative_offers[0].enabled_in_scenario = false;
    const sc = d.scenarios.find((s) => s.id === "mitigation")!;
    const view = toSimulationView(results[2], d.snapshot, sc);
    expect(view.warnings).toContain("Penawaran Tepung terigu dari Pemasok B dinonaktifkan pada data pasokan.");

    const failed: ScenarioResult = { ...results[0], status: "Error", message: "gagal", production: [], material_usage: [], alternative_purchases: [] };
    const bad = toSimulationView(failed, fresh().snapshot, byId("baseline"));
    expect(bad.solver_status).toBe("ERROR");
    expect(bad.kpis).toBeNull();
    expect(bad.warnings).toContain("Rencana produksi tidak dapat dihitung atau diverifikasi. Coba lagi.");
    const infeasible = toSimulationView({ ...failed, status: "Infeasible" }, fresh().snapshot, byId("baseline"));
    expect(infeasible.solver_status).toBe("INFEASIBLE");
  });
});

describe("toComparisonView", () => {
  it("computes at-risk, recovered and recovery percentage plus consecutive deltas", () => {
    const { snapshot, scenarios } = fresh();
    const view = toComparisonView(results, scenarios, snapshot);
    expect(view.contribution_at_risk_idr).toBe(240_000);
    expect(view.recovered_contribution_idr).toBe(132_000);
    expect(view.recovery_pct).toBeCloseTo(55, 5);
    expect(view.results.map((r) => r.scenario_id)).toEqual(["baseline", "outage", "mitigation"]);
    expect(view.deltas).toHaveLength(2);
    expect(view.deltas[0]).toMatchObject({ from_scenario_id: "baseline", to_scenario_id: "outage", net_contribution_delta_idr: -240_000 });
    expect(view.deltas[0].net_contribution_delta_pct).toBeCloseTo(-53.3333, 3);
    expect(view.deltas[1]).toMatchObject({ net_contribution_delta_idr: 132_000 });
    expect(view.warnings).toEqual([]);
  });

  it("recovery percentage is not applicable when nothing is at risk, and warns when mitigation is worse", async () => {
    const d = fresh();
    d.snapshot.materials[0].stock_on_hand = 40_000;
    const rs = await Promise.all(d.scenarios.map((s) => solveScenario(d.snapshot, s)));
    const none = toComparisonView(rs, d.scenarios, d.snapshot);
    expect(none.contribution_at_risk_idr).toBe(0);
    expect(none.recovery_pct).toBeNull();

    const worse = rs.map((r) => (r.scenario_id === "mitigation" ? { ...r, net_contribution_idr: -5 } : r));
    expect(toComparisonView(worse, d.scenarios, d.snapshot).warnings).toContain(
      "Skenario mitigasi menghasilkan estimasi kontribusi lebih rendah daripada skenario gangguan.",
    );
  });
});

describe("recomputeComparisonView", () => {
  const defaultRoles = { baselineId: "baseline", outageId: "outage", mitigationId: "mitigation" };

  it("matches toComparisonView when using default roles and omitting or passing all visibleIds", () => {
    const { snapshot, scenarios } = fresh();
    const baseView = toComparisonView(results, scenarios, snapshot);
    expect(recomputeComparisonView(baseView, defaultRoles)).toEqual(baseView);
    expect(recomputeComparisonView(baseView, defaultRoles, ["baseline", "outage", "mitigation"])).toEqual(baseView);
  });

  it("recomputes recovered contribution and recovery percentage when a custom scenario is chosen as mitigationId", async () => {
    const d = fresh();
    const customScenario = {
      ...d.scenarios.find((s) => s.id === "mitigation")!,
      id: "mitigasi_2",
      name: "Mitigasi Stok Tambahan",
      overrides: { stock_by_material: { flour: 16_000 } },
    };
    const scenarios = [...d.scenarios, customScenario];
    const rs = await Promise.all(scenarios.map((s) => solveScenario(d.snapshot, s)));
    const baseView = toComparisonView(rs, scenarios, d.snapshot);

    const recomputed = recomputeComparisonView(baseView, {
      ...defaultRoles,
      mitigationId: "mitigasi_2",
    });

    const customNet = baseView.results.find((r) => r.scenario_id === "mitigasi_2")!.kpis!.net_contribution_idr;
    const outageNet = baseView.results.find((r) => r.scenario_id === "outage")!.kpis!.net_contribution_idr;
    expect(customNet).toBeGreaterThan(baseView.results.find((r) => r.scenario_id === "mitigation")!.kpis!.net_contribution_idr);
    expect(recomputed.contribution_at_risk_idr).toBe(240_000);
    expect(recomputed.recovered_contribution_idr).toBe(customNet - outageNet);
    expect(recomputed.recovery_pct).toBeCloseTo(((customNet - outageNet) * 100) / 240_000, 5);
  });

  it("computes recovery KPIs from full outcome.results even when visibleIds hides a role scenario", async () => {
    const d = fresh();
    const customScenario = {
      ...d.scenarios.find((s) => s.id === "mitigation")!,
      id: "mitigasi_2",
      name: "Mitigasi Stok Tambahan",
      overrides: { stock_by_material: { flour: 16_000 } },
    };
    const scenarios = [...d.scenarios, customScenario];
    const rs = await Promise.all(scenarios.map((s) => solveScenario(d.snapshot, s)));
    const baseView = toComparisonView(rs, scenarios, d.snapshot);

    const filtered = recomputeComparisonView(
      baseView,
      { ...defaultRoles, mitigationId: "mitigasi_2" },
      ["baseline", "mitigasi_2"],
    );

    const baselineNet = baseView.results.find((r) => r.scenario_id === "baseline")!.kpis!.net_contribution_idr;
    const outageNet = baseView.results.find((r) => r.scenario_id === "outage")!.kpis!.net_contribution_idr;
    const customNet = baseView.results.find((r) => r.scenario_id === "mitigasi_2")!.kpis!.net_contribution_idr;

    expect(filtered.contribution_at_risk_idr).toBe(240_000);
    expect(filtered.recovered_contribution_idr).toBe(customNet - outageNet);
    expect(filtered.recovery_pct).toBeCloseTo(((customNet - outageNet) * 100) / 240_000, 5);
    expect(filtered.results.map((r) => r.scenario_id)).toEqual(["baseline", "mitigasi_2"]);
    expect(filtered.deltas).toHaveLength(1);
    expect(filtered.deltas[0]).toMatchObject({
      from_scenario_id: "baseline",
      to_scenario_id: "mitigasi_2",
      net_contribution_delta_idr: customNet - baselineNet,
    });
  });
});
