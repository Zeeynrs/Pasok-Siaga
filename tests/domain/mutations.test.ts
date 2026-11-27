import { describe, expect, it } from "vitest";
import { DAPUR_SARI_FALLBACK_FIXTURE } from "@/lib/domain/fixture";
import {
  addAlternativeOffer,
  addCommittedDelivery,
  addMaterial,
  addProduct,
  addScenario,
  addSupplier,
  prepareSupplierOutageScenario,
  removeAlternativeOffer,
  removeCommittedDelivery,
  removeMaterial,
  removeProduct,
  removeScenario,
  removeSupplier,
  setBomQuantity,
  setMaterialUnitKind,
  slugify,
} from "@/lib/domain/mutations";
import { validateWorkspaceData } from "@/lib/domain/validation";

const fresh = () => structuredClone(DAPUR_SARI_FALLBACK_FIXTURE);

describe("slugify", () => {
  it("produces valid unique slugs", () => {
    expect(slugify("Tepung Terigu Premium!", [])).toBe("tepung_terigu_premium");
    expect(slugify("Tepung", ["tepung"])).toBe("tepung_2");
    expect(slugify("!!!", [], "bahan")).toBe("bahan");
    expect(slugify("Gula", ["gula", "gula_2"])).toBe("gula_3");
  });
});

describe("entity mutations keep the workspace valid", () => {
  it("adds a supplier, material and product", () => {
    let d = fresh();
    d = addSupplier(d, "Pemasok C");
    d = addMaterial(d, "Telur");
    d = addProduct(d, "Donat");
    expect(d.snapshot.suppliers.at(-1)).toMatchObject({ id: "pemasok_c", name: "Pemasok C", active: true });
    expect(d.snapshot.materials.at(-1)).toMatchObject({ id: "telur", unit_kind: "mass", base_unit: "g", stock_on_hand: 0 });
    expect(d.snapshot.products.at(-1)).toMatchObject({ id: "donat", demand_units: 0 });
    expect(() => validateWorkspaceData(d)).not.toThrow();
  });

  it("does not mutate the input", () => {
    const d = fresh();
    addSupplier(d, "X");
    expect(d).toEqual(DAPUR_SARI_FALLBACK_FIXTURE);
  });

  it("removing a supplier cascades to deliveries, offers and scenario references", () => {
    const d = removeSupplier(fresh(), "supplier_a");
    expect(d.snapshot.committed_deliveries).toHaveLength(0);
    expect(d.scenarios.find((s) => s.id === "outage")!.disabled_supplier_ids).toEqual([]);
    expect(() => validateWorkspaceData(d)).not.toThrow();

    const b = removeSupplier(fresh(), "supplier_b");
    expect(b.snapshot.alternative_offers).toHaveLength(0);
    expect(b.scenarios.find((s) => s.id === "mitigation")!.enabled_offer_ids).toEqual([]);
    expect(() => validateWorkspaceData(b)).not.toThrow();
  });

  it("removing a material cascades to BOM, deliveries, offers and overrides", () => {
    const d = fresh();
    d.scenarios[0].overrides = { stock_by_material: { flour: 10 } };
    const out = removeMaterial(d, "flour");
    expect(out.snapshot.bom.every((b) => b.material_id !== "flour")).toBe(true);
    expect(out.snapshot.committed_deliveries).toHaveLength(0);
    expect(out.snapshot.alternative_offers).toHaveLength(0);
    expect(out.scenarios[0].overrides.stock_by_material).toEqual({});
    expect(() => validateWorkspaceData(out)).not.toThrow();
  });

  it("removing a product cascades to BOM and demand overrides", () => {
    const d = fresh();
    d.scenarios[0].overrides = { demand_by_product: { bread: 5 } };
    const out = removeProduct(d, "bread");
    expect(out.snapshot.bom.every((b) => b.product_id !== "bread")).toBe(true);
    expect(out.scenarios[0].overrides.demand_by_product).toEqual({});
    expect(() => validateWorkspaceData(out)).not.toThrow();
  });

  it("removing a delivery drops matching disruptions", () => {
    const d = fresh();
    d.scenarios[1].disruptions.push({ type: "delay_delivery", delivery_id: "supplier_a_flour_delivery", delay_days: 2 });
    const out = removeCommittedDelivery(d, "supplier_a_flour_delivery");
    expect(out.scenarios[1].disruptions).toEqual([]);
    expect(() => validateWorkspaceData(out)).not.toThrow();
  });

  it("adds deliveries and offers with sensible defaults and removes offers from scenarios", () => {
    let d = addCommittedDelivery(fresh(), "supplier_b", "sugar");
    expect(d.snapshot.committed_deliveries.at(-1)).toMatchObject({
      supplier_id: "supplier_b", material_id: "sugar", quantity_base_units: 1,
      arrival_date: "2026-11-23", enabled_in_baseline: true,
    });
    d = addAlternativeOffer(d, "supplier_b", "sugar");
    expect(d.snapshot.alternative_offers.at(-1)).toMatchObject({ pack_size_base_units: 1000, max_packs: 10, enabled_in_scenario: true });
    expect(() => validateWorkspaceData(d)).not.toThrow();

    const out = removeAlternativeOffer(d, "supplier_b_flour_offer");
    expect(out.scenarios.find((s) => s.id === "mitigation")!.enabled_offer_ids).toEqual([]);
    expect(() => validateWorkspaceData(out)).not.toThrow();
  });

  it("setBomQuantity upserts and removes rows (0 removes)", () => {
    let d = setBomQuantity(fresh(), "bread", "flour", 300);
    expect(d.snapshot.bom.find((b) => b.product_id === "bread" && b.material_id === "flour")!.quantity_per_product).toBe(300);
    d = setBomQuantity(d, "bread", "flour", 0);
    expect(d.snapshot.bom.some((b) => b.product_id === "bread" && b.material_id === "flour")).toBe(false);
    d = setBomQuantity(d, "bread", "flour", 120);
    expect(d.snapshot.bom.filter((b) => b.product_id === "bread" && b.material_id === "flour")).toHaveLength(1);
    expect(() => validateWorkspaceData(d)).not.toThrow();
  });

  it("setMaterialUnitKind keeps unit_kind/base_unit consistent", () => {
    const d = setMaterialUnitKind(fresh(), "flour", "volume");
    expect(d.snapshot.materials.find((m) => m.id === "flour")).toMatchObject({ unit_kind: "volume", base_unit: "ml" });
    expect(() => validateWorkspaceData(d)).not.toThrow();
  });
});

describe("scenario mutations", () => {
  it("adds custom scenarios by copying the source, up to 10", () => {
    let d = fresh();
    d = addScenario(d, "mitigation", "Skenario Uji");
    const added = d.scenarios.at(-1)!;
    expect(added).toMatchObject({ id: "skenario_uji", name: "Skenario Uji", source: "user" });
    expect(added.enabled_offer_ids).toEqual(["supplier_b_flour_offer"]);
    for (let i = 0; i < 20; i++) d = addScenario(d, "baseline", `Tambahan ${i}`);
    expect(d.scenarios).toHaveLength(10);
    expect(() => validateWorkspaceData(d)).not.toThrow();
  });

  it("never removes core scenarios", () => {
    const d = fresh();
    expect(removeScenario(d, "baseline").scenarios).toHaveLength(3);
    const withCustom = addScenario(d, "baseline", "Kustom");
    expect(removeScenario(withCustom, "kustom").scenarios).toHaveLength(3);
  });

  it("prepareSupplierOutageScenario creates a new scenario based on baseline when none matches and scenarios < MAX_SCENARIOS", () => {
    const original = fresh();
    const prep = prepareSupplierOutageScenario(original, "supplier_b");
    expect(prep.created).toBe(true);
    expect(prep.fallbackUpdated).toBe(false);
    expect(prep.data.scenarios).toHaveLength(4);
    const created = prep.data.scenarios.find((s) => s.id === prep.scenarioId);
    expect(created).toMatchObject({
      name: "Uji Gagal: Pemasok B",
      disabled_supplier_ids: ["supplier_b"],
      enabled_offer_ids: [],
      source: "user",
    });
    expect(original.scenarios).toHaveLength(3);
    expect(() => validateWorkspaceData(prep.data)).not.toThrow();
  });

  it("prepareSupplierOutageScenario reuses an existing non-baseline scenario matching [supplierId] with empty offers", () => {
    const prep = prepareSupplierOutageScenario(fresh(), "supplier_a");
    expect(prep.created).toBe(false);
    expect(prep.fallbackUpdated).toBe(false);
    expect(prep.scenarioId).toBe("outage");
    expect(prep.data.scenarios).toHaveLength(3);
    expect(() => validateWorkspaceData(prep.data)).not.toThrow();
  });

  it("prepareSupplierOutageScenario updates outage scenario when MAX_SCENARIOS is reached and no match exists", () => {
    let d = fresh();
    for (let i = 0; i < 7; i++) d = addScenario(d, "baseline", `Tambahan ${i}`);
    expect(d.scenarios).toHaveLength(10);

    const prep = prepareSupplierOutageScenario(d, "supplier_b");
    expect(prep.created).toBe(false);
    expect(prep.fallbackUpdated).toBe(true);
    expect(prep.scenarioId).toBe("outage");
    expect(prep.data.scenarios).toHaveLength(10);
    expect(prep.data.scenarios.find((s) => s.id === "outage")!.disabled_supplier_ids).toEqual(["supplier_b"]);
    expect(prep.data.scenarios.find((s) => s.id === "outage")!.enabled_offer_ids).toEqual([]);
    expect(() => validateWorkspaceData(prep.data)).not.toThrow();
  });
});
