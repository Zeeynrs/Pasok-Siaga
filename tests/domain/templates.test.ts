import { describe, expect, it } from "vitest";
import { EMPTY_WORKSPACE_FIXTURE } from "@/lib/domain/fixture";
import { STARTER_TEMPLATES, applyStarterTemplate } from "@/lib/domain/templates";
import { validateWorkspaceData } from "@/lib/domain/validation";
import { compareScenarios } from "@/lib/solver/compare";

describe("STARTER_TEMPLATES", () => {
  it("provides 4 valid culinary templates that solve cleanly with positive recovery", async () => {
    expect(STARTER_TEMPLATES.map((t) => t.id)).toEqual([
      "dapur_sari",
      "kedai_kopi",
      "dimsum_beku",
      "martabak_kue",
    ]);
    for (const tpl of STARTER_TEMPLATES) {
      const valid = validateWorkspaceData(tpl.data);
      const { comparison } = await compareScenarios(valid.snapshot, valid.scenarios);
      expect(comparison.loss_idr).toBeGreaterThan(0);
      expect(comparison.recovered_idr).toBeGreaterThan(0);
    }
  });

  it("preserves workspace business id and sets user source in workspace mode", () => {
    const next = applyStarterTemplate(EMPTY_WORKSPACE_FIXTURE, "kedai_kopi", "workspace");
    expect(next.snapshot.business.id).toBe("usaha");
    expect(next.snapshot.demo_data).toBe(false);
    expect(next.scenarios.every((s) => s.source === "user")).toBe(true);
    expect(next.snapshot.suppliers.length).toBeGreaterThanOrEqual(2);
  });

  it("throws an explicit error for an unknown template id", () => {
    expect(() => applyStarterTemplate(EMPTY_WORKSPACE_FIXTURE, "tidak_ada", "workspace")).toThrow(/Template/);
  });
});
