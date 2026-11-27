import { describe, expect, it } from "vitest";
import { DAPUR_SARI_FALLBACK_FIXTURE } from "@/lib/domain/fixture";
import { solveScenario } from "@/lib/solver/milp-solver";
import { compareScenarios } from "@/lib/solver/compare";
import { toComparisonView, toSimulationView } from "@/lib/view-models";
import {
  buildWhatsAppShareUrl,
  comparisonToCsv,
  formatWhatsAppOrderMessage,
  simulationToCsv,
} from "@/lib/export";

describe("export helpers", () => {
  it("formats WhatsApp order message with alternative purchases grouped by supplier", async () => {
    const { snapshot, scenarios } = structuredClone(DAPUR_SARI_FALLBACK_FIXTURE);
    const mitigation = scenarios.find((s) => s.id === "mitigation")!;
    const view = toSimulationView(await solveScenario(snapshot, mitigation), snapshot, mitigation);
    const msg = formatWhatsAppOrderMessage(view, snapshot);

    expect(msg).toContain("Dapur Sari");
    expect(msg).toContain("Pemasok B");
    expect(msg).toContain("Tepung terigu");
    expect(msg).toContain("12 pak");
    expect(msg).toContain("12 kg");
    expect(msg).toContain("Kue kering: 30");
    expect(buildWhatsAppShareUrl(msg)).toMatch(/^https:\/\/wa\.me\/\?text=/);
  });

  it("formats production summary cleanly when there are no alternative purchases", async () => {
    const { snapshot, scenarios } = structuredClone(DAPUR_SARI_FALLBACK_FIXTURE);
    const baseline = scenarios.find((s) => s.id === "baseline")!;
    const view = toSimulationView(await solveScenario(snapshot, baseline), snapshot, baseline);
    const msg = formatWhatsAppOrderMessage(view, snapshot);

    expect(msg).toContain("Ringkasan Rencana Produksi");
    expect(msg).not.toContain("Order Pemasok Alternatif");
    expect(msg).toContain("Rp");
  });

  it("generates UTF-8 BOM CSV with RFC-4180 quoting for special characters", async () => {
    const { snapshot, scenarios } = structuredClone(DAPUR_SARI_FALLBACK_FIXTURE);
    snapshot.products[0].name = 'Roti "Manis", Spesial';
    const baseline = scenarios.find((s) => s.id === "baseline")!;
    const view = toSimulationView(await solveScenario(snapshot, baseline), snapshot, baseline);
    const csv = simulationToCsv(view, snapshot);

    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain('"Roti ""Manis"", Spesial"');

    const { results } = await compareScenarios(snapshot, scenarios);
    const compCsv = comparisonToCsv(toComparisonView(results, scenarios, snapshot));
    expect(compCsv.startsWith("\uFEFF")).toBe(true);
    expect(compCsv).toContain("Normal");
    expect(compCsv).toContain("55%");
  });
});
