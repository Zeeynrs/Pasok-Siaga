import { beforeAll, describe, expect, it } from "vitest";
import { DAPUR_SARI_FALLBACK_FIXTURE } from "@/lib/domain/fixture";
import type { ScenarioResult, WorkspaceData } from "@/lib/domain/types";
import { analyzeNetwork, computeResilienceScore, recomputeComparisonView, toComparisonView, toSimulationView } from "@/lib/view-models";
import { formatMoney } from "@/lib/format";
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

  it("attaches simulation overlays on nodes and used alternative edges when simulation is optimal", () => {
    const { snapshot } = fresh();
    const mitigation = byId("mitigation");
    const mitigationSim = toSimulationView(results[2], snapshot, mitigation);
    const net = analyzeNetwork(snapshot, mitigation, mitigationSim);
    const node = (id: string) => net.nodes.find((n) => n.id === id)!;
    const edge = (id: string) => net.edges.find((e) => e.id === id)!;

    expect(node("product:bread").overlay).toEqual({
      metric: "68/100 unit",
      badge: "Sebagian",
      tone: "warning",
    });
    expect(node("product:cookies").overlay).toEqual({
      metric: "30/30 unit",
      badge: "Terpenuhi",
      tone: "good",
    });
    expect(node("material:flour").overlay).toEqual({
      metric: "100% terpakai",
      badge: "Pembatas",
      tone: "bad",
    });
    expect(node("material:sugar").overlay).toMatchObject({
      badge: "Cukup",
      tone: "good",
    });
    expect(node("supplier:supplier_b").overlay).toEqual({
      badge: "Dipakai 12 pak",
      metric: formatMoney(12_000),
      tone: "good",
    });
    expect(node("supplier:supplier_a").overlay).toBeUndefined();
    expect(edge("alternative:supplier_b_flour_offer")).toMatchObject({
      used: true,
      overlayLabel: "12 pak",
    });
  });

  it("preserves exact baseline output without overlay/used when simulation is omitted or kpis is null", () => {
    const { snapshot } = fresh();
    const baseline = byId("baseline");
    const plain = analyzeNetwork(snapshot, baseline);
    const failed = toSimulationView(
      { ...results[0], status: "Error", message: "gagal", production: [], material_usage: [], alternative_purchases: [] },
      snapshot,
      baseline,
    );
    expect(failed.kpis).toBeNull();
    expect(analyzeNetwork(snapshot, baseline, null)).toEqual(plain);
    expect(analyzeNetwork(snapshot, baseline, failed)).toEqual(plain);
    expect(plain.nodes.every((n) => n.overlay === undefined)).toBe(true);
    expect(plain.edges.every((e) => e.used === undefined && e.overlayLabel === undefined)).toBe(true);
  });

  it("handles zero available_units in simulation material_usage without NaN", () => {
    const { snapshot } = fresh();
    const outage = byId("outage");
    const sim = toSimulationView(results[1], snapshot, outage);
    const zeroSim = {
      ...sim,
      material_usage: sim.material_usage.map((m) =>
        m.material_id === "flour" ? { ...m, available_units: 0, used_units: 0, remaining_units: 0 } : m,
      ),
    };
    const net = analyzeNetwork(snapshot, outage, zeroSim);
    expect(net.nodes.find((n) => n.id === "material:flour")!.overlay?.metric).toBe("0% terpakai");
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

describe("computeResilienceScore", () => {
  it("computes deterministic weighted resilience score for Dapur Sari", () => {
    const { snapshot, scenarios } = fresh();
    const network = analyzeNetwork(snapshot, byId("baseline"));
    const comparison = toComparisonView(results, scenarios, snapshot);

    const resilience = computeResilienceScore(snapshot, network, comparison);
    expect(resilience.structural_pct).toBe(100);
    expect(resilience.outage_retention_pct).toBe(47);
    expect(resilience.mitigation_score_pct).toBe(76);
    expect(resilience.score).toBe(75);
    expect(resilience.grade).toBe("Tangguh");
    expect(resilience.tone).toBe("good");
    expect(resilience.summary).toContain("75/100");
  });

  it("drops structural_pct when backup supplier is removed from snapshot", () => {
    const d = fresh();
    d.snapshot.alternative_offers = [];
    const network = analyzeNetwork(d.snapshot, byId("baseline"));
    const comparison = toComparisonView(results, d.scenarios, d.snapshot);

    const resilience = computeResilienceScore(d.snapshot, network, comparison);
    expect(resilience.structural_pct).toBe(67);
    expect(resilience.score).toBe(65);
    expect(resilience.grade).toBe("Cukup Siap");
    expect(resilience.tone).toBe("warning");
  });

  it("handles null comparison, zero baseline, empty bom, and extreme values without NaN or Infinity", () => {
    const { snapshot, scenarios } = fresh();
    const network = analyzeNetwork(snapshot, byId("baseline"));

    const noComp = computeResilienceScore(snapshot, network, null);
    expect(noComp).toMatchObject({
      score: 100,
      grade: "Tangguh",
      tone: "good",
      structural_pct: 100,
      outage_retention_pct: null,
      mitigation_score_pct: null,
    });
    expect(Number.isFinite(noComp.score)).toBe(true);

    const zeroBaselineComp = toComparisonView(
      results.map((r) => (r.scenario_id === "baseline" ? { ...r, net_contribution_idr: 0 } : r)),
      scenarios,
      snapshot,
    );
    const zeroBase = computeResilienceScore(snapshot, network, zeroBaselineComp);
    expect(zeroBase.outage_retention_pct).toBeNull();
    expect(zeroBase.mitigation_score_pct).toBeNull();
    expect(zeroBase.score).toBe(100);
    expect(Number.isFinite(zeroBase.score)).toBe(true);

    const emptyBomSnapshot = {
      ...snapshot,
      bom: [],
      committed_deliveries: [],
      alternative_offers: [],
    };
    const emptyNet = analyzeNetwork(emptyBomSnapshot, byId("baseline"));
    const emptyScore = computeResilienceScore(emptyBomSnapshot, emptyNet, null);
    expect(emptyScore.structural_pct).toBe(100);
    expect(emptyScore.score).toBe(100);
    expect(Number.isFinite(emptyScore.score)).toBe(true);

    const badComp = toComparisonView(
      results.map((r) =>
        r.scenario_id === "outage"
          ? { ...r, net_contribution_idr: -50_000 }
          : r.scenario_id === "mitigation"
            ? { ...r, net_contribution_idr: 50_000 }
            : r,
      ),
      scenarios,
      snapshot,
    );
    const badSnap = fresh().snapshot;
    badSnap.alternative_offers = [];
    const badNet = analyzeNetwork(badSnap, byId("baseline"));
    const rentan = computeResilienceScore(badSnap, badNet, badComp);
    expect(rentan.outage_retention_pct).toBe(0);
    expect(rentan.mitigation_score_pct).toBe(11);
    expect(rentan.score).toBe(25);
    expect(rentan.grade).toBe("Rentan");
    expect(rentan.tone).toBe("bad");
  });
});
