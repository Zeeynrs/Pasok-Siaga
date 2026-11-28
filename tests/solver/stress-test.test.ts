import { describe, expect, it } from "vitest";
import { DAPUR_SARI_FALLBACK_FIXTURE } from "@/lib/domain/fixture";
import { runStressTest } from "@/lib/solver/stress-test";

const fresh = () => structuredClone(DAPUR_SARI_FALLBACK_FIXTURE);

describe("runStressTest (Dapur Sari)", () => {
  it("computes delay_curve 0..5 with critical_delay_days = 2 on Dapur Sari", async () => {
    const { snapshot, scenarios } = fresh();
    const res = await runStressTest(snapshot, scenarios);

    expect(res.delay_scenario_id).toBe("baseline");
    expect(res.baseline_net_idr).toBe(450_000);
    expect(res.critical_delay_days).toBe(2);
    expect(res.delay_curve).toHaveLength(6);
    expect(res.delay_curve.map((p) => p.delay_days)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(res.delay_curve[0]).toEqual({
      delay_days: 0,
      net_contribution_idr: 450_000,
      status: "Optimal",
      unmet_units: 0,
    });
    expect(res.delay_curve[1].net_contribution_idr).toBe(450_000);
    expect(res.delay_curve[2].net_contribution_idr).toBe(210_000);
    expect(res.delay_curve[2].unmet_units).toBe(80);
    expect(res.delay_curve[5].net_contribution_idr).toBe(210_000);
  });

  it("computes offer_breakevens with max_viable_premium_idr = 11_999 and headroom_idr = 10_999", async () => {
    const { snapshot, scenarios } = fresh();
    const res = await runStressTest(snapshot, scenarios);

    expect(res.offer_scenario_id).toBe("mitigation");
    expect(res.no_offer_net_idr).toBe(210_000);
    expect(res.offer_breakevens).toHaveLength(1);

    const ob = res.offer_breakevens[0];
    expect(ob.offer_id).toBe("supplier_b_flour_offer");
    expect(ob.supplier_name).toBe("Pemasok B");
    expect(ob.material_name).toBe("Tepung terigu");
    expect(ob.current_premium_idr).toBe(1_000);
    expect(ob.max_viable_premium_idr).toBe(11_999);
    expect(ob.headroom_idr).toBe(10_999);

    expect(ob.points.length).toBe(6);
    for (let i = 1; i < ob.points.length; i++) {
      expect(ob.points[i].premium_idr).toBeGreaterThan(ob.points[i - 1].premium_idr);
    }
    expect(ob.points[0].packs_bought).toBeGreaterThan(0);
    expect(ob.points[ob.points.length - 1].packs_bought).toBe(0);
    expect(ob.points.some((p) => p.premium_idr === 1_000)).toBe(true);
    expect(ob.points.some((p) => p.premium_idr === 11_999)).toBe(true);
  });

  it("returns null breakeven when no offers are eligible or offer is not bought even at 0 premium", async () => {
    const noOffers = fresh();
    noOffers.scenarios[2].enabled_offer_ids = [];
    const resEmpty = await runStressTest(noOffers.snapshot, noOffers.scenarios, {
      offerScenarioId: "mitigation",
    });
    expect(resEmpty.offer_breakevens).toEqual([]);

    const enoughStock = fresh();
    enoughStock.snapshot.materials[0].stock_on_hand = 40_000;
    const resEnough = await runStressTest(enoughStock.snapshot, enoughStock.scenarios);
    expect(resEnough.offer_breakevens).toHaveLength(1);
    expect(resEnough.offer_breakevens[0].max_viable_premium_idr).toBeNull();
    expect(resEnough.offer_breakevens[0].headroom_idr).toBeNull();
    expect(resEnough.offer_breakevens[0].points.length).toBeGreaterThanOrEqual(2);
    expect(resEnough.offer_breakevens[0].points[0].packs_bought).toBe(0);
  });

  it("returns critical_delay_days = null when there are no active committed deliveries", async () => {
    const mod = fresh();
    mod.snapshot.committed_deliveries = [];
    const res = await runStressTest(mod.snapshot, mod.scenarios);

    expect(res.critical_delay_days).toBeNull();
    expect(res.baseline_net_idr).toBe(210_000);
    expect(res.delay_curve).toHaveLength(6);
    for (const pt of res.delay_curve) {
      expect(pt.status).toBe("Optimal");
      expect(pt.net_contribution_idr).toBe(210_000);
    }
  });

  it("falls back safely when optional scenario IDs are unknown", async () => {
    const { snapshot, scenarios } = fresh();
    const res = await runStressTest(snapshot, scenarios, {
      delayScenarioId: "tidak-ada",
      offerScenarioId: "juga-tidak-ada",
    });
    expect(res.delay_scenario_id).toBe("baseline");
    expect(res.offer_scenario_id).toBe("mitigation");
    expect(res.critical_delay_days).toBe(2);
    expect(res.offer_breakevens[0].max_viable_premium_idr).toBe(11_999);
  });
});
