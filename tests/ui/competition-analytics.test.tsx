// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DAPUR_SARI_FALLBACK_FIXTURE, EMPTY_WORKSPACE_FIXTURE } from "@/lib/domain/fixture";
import { computeInputsSignature } from "@/lib/domain/signature";
import { compareScenarios } from "@/lib/solver/compare";
import { solveScenario } from "@/lib/solver/milp-solver";
import { runStressTest } from "@/lib/solver/stress-test";

vi.mock("@/lib/notify", () => ({ notify: { success: vi.fn(), error: vi.fn(), info: vi.fn(), changed: vi.fn() } }));
vi.mock("@/features/network/network-canvas", () => ({ NetworkCanvas: () => <div data-testid="graph-canvas" /> }));
vi.mock("@/features/simulation/comparison-chart", () => ({ ComparisonChart: () => <div data-testid="chart" /> }));

const delayChartSpy = vi.fn();
const premiumChartSpy = vi.fn();
vi.mock("@/features/simulation/stress-test-chart", () => ({
  StressDelayChart: (props: { data: { label: string; contribution: number | null }[] }) => {
    delayChartSpy(props);
    return <div data-testid="stress-delay-chart" data-points={props.data.length} />;
  },
  StressPremiumChart: (props: { data: { premiumLabel: string; contribution: number | null; packs: number }[] }) => {
    premiumChartSpy(props);
    return <div data-testid="stress-premium-chart" data-points={props.data.length} />;
  },
}));

const replace = vi.fn();
const router = { replace, push: vi.fn() };
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/comparison",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { signOut: vi.fn().mockResolvedValue({}) } }) }));

import { Workspace } from "@/components/workspace";
import { DataEditor } from "@/features/data-editor/data-editor";
import { Comparison } from "@/features/simulation/comparison";
import { StressTestPanel } from "@/features/simulation/stress-test-panel";
import { notify } from "@/lib/notify";
import { resetStoredValues } from "@/lib/use-stored-value";

const BUSINESS_ID = "11111111-1111-4111-8111-111111111111";
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

let calls: { url: string; method: string; body: unknown; signal?: AbortSignal | null }[] = [];

async function handler(url: string, init?: RequestInit): Promise<Response> {
  const method = init?.method ?? "GET";
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  calls.push({ url, method, body, signal: init?.signal });
  if (url === "/api/demo") return json(structuredClone(DAPUR_SARI_FALLBACK_FIXTURE));
  if (url === "/api/simulate") return json({ result: await solveScenario(body.snapshot, body.scenario) });
  if (url === "/api/simulate/compare") {
    const { results, comparison } = await compareScenarios(body.snapshot, body.scenarios);
    return json({ results, comparison, inputs_signature: computeInputsSignature(body.snapshot, body.scenarios) });
  }
  if (url === "/api/simulate/stress-test") {
    const stress_test = await runStressTest(body.snapshot, body.scenarios, {
      delayScenarioId: body.delayScenarioId,
      offerScenarioId: body.offerScenarioId,
    });
    return json({ stress_test, inputs_signature: computeInputsSignature(body.snapshot, body.scenarios) });
  }
  if (url === "/api/workspace" && method === "GET") {
    return json({ businessId: BUSINESS_ID, ...structuredClone(EMPTY_WORKSPACE_FIXTURE) });
  }
  if (url === "/api/workspace" && method === "PUT") {
    return json({ ok: true, snapshot: body.snapshot, scenarios: body.scenarios });
  }
  return json({ error: "tidak ditemukan" }, 404);
}

const countCalls = (url: string) => calls.filter((c) => c.url === url).length;

beforeEach(() => {
  calls = [];
  delayChartSpy.mockReset();
  premiumChartSpy.mockReset();
  replace.mockReset();
  router.push.mockReset();
  for (const fn of Object.values(notify)) vi.mocked(fn).mockReset();
  sessionStorage.clear();
  localStorage.clear();
  resetStoredValues();
  localStorage.setItem("microchain:onboarding:v1", "done");
  localStorage.setItem("microchain:tour:v1", "done");
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    media: "",
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => handler(url, init)));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("StressTestPanel di halaman Comparison", () => {
  it("does not call /api/simulate/stress-test automatically on mount", async () => {
    render(
      <Workspace mode="demo">
        <Comparison />
      </Workspace>,
    );
    await screen.findByText("Persentase pemulihan");

    expect(countCalls("/api/simulate/compare")).toBe(1);
    expect(countCalls("/api/simulate/stress-test")).toBe(0);
    expect(screen.getByRole("button", { name: "Jalankan Stress-Test Otomatis" })).toBeInTheDocument();
  });

  it("runs /api/simulate/stress-test once on click and renders delay (+2 hari) and Pemasok B breakeven (Rp 11.999)", async () => {
    const user = userEvent.setup();
    render(
      <Workspace mode="demo">
        <Comparison />
      </Workspace>,
    );
    await screen.findByText("Persentase pemulihan");

    await user.click(screen.getByRole("button", { name: "Jalankan Stress-Test Otomatis" }));

    await waitFor(() => expect(countCalls("/api/simulate/stress-test")).toBe(1));
    const stressPanel = await screen.findByRole("region", { name: /Uji Ketahanan/i });
    const summaryMetrics = stressPanel.querySelector(".stress-test-metrics") as HTMLElement;

    expect(await within(summaryMetrics).findByText("+2 hari")).toBeInTheDocument();
    expect(within(stressPanel).getAllByText(/Rp\s11\.999/).length).toBeGreaterThan(0);
    expect(within(stressPanel).getByText(/Pemasok B/)).toBeInTheDocument();
    expect(await within(stressPanel).findByTestId("stress-delay-chart")).toBeInTheDocument();
    expect(await within(stressPanel).findByTestId("stress-premium-chart")).toBeInTheDocument();
    expect(delayChartSpy).toHaveBeenCalled();
    expect(premiumChartSpy).toHaveBeenCalled();
    expect(within(stressPanel).getByRole("button", { name: "Hitung Ulang Stress-Test" })).toBeInTheDocument();
  });

  it("marks previous stress-test result as stale when signature changes and clears after rerun", async () => {
    const user = userEvent.setup();
    const initialData = structuredClone(DAPUR_SARI_FALLBACK_FIXTURE);
    const initialSig = computeInputsSignature(initialData.snapshot, initialData.scenarios);

    const updatedData = structuredClone(DAPUR_SARI_FALLBACK_FIXTURE);
    updatedData.snapshot.materials[0].stock_on_hand = 15000;
    const updatedSig = computeInputsSignature(updatedData.snapshot, updatedData.scenarios);

    const { rerender } = render(<StressTestPanel data={initialData} signature={initialSig} />);

    await user.click(screen.getByRole("button", { name: "Jalankan Stress-Test Otomatis" }));
    await screen.findAllByText("+2 hari");
    expect(countCalls("/api/simulate/stress-test")).toBe(1);
    expect(document.querySelector(".stale-notice")).not.toBeInTheDocument();

    rerender(<StressTestPanel data={updatedData} signature={updatedSig} />);

    const staleNotice = document.querySelector(".stale-notice");
    expect(staleNotice).toBeInTheDocument();
    expect(staleNotice).toHaveTextContent(/basi/i);

    await user.click(within(staleNotice as HTMLElement).getByRole("button", { name: "Hitung Ulang Stress-Test" }));
    await waitFor(() => expect(countCalls("/api/simulate/stress-test")).toBe(2));
    await waitFor(() => expect(document.querySelector(".stale-notice")).not.toBeInTheDocument());
  });

  it("resets safely without auto-calling stress-test after editing data in DataEditor and returning to Comparison", async () => {
    const user = userEvent.setup();
    function NavigationHarness() {
      const [page, setPage] = useState<"comparison" | "data">("comparison");
      return (
        <Workspace mode="demo">
          <button type="button" onClick={() => setPage("comparison")}>Ke Perbandingan</button>
          <button type="button" onClick={() => setPage("data")}>Ke Data Usaha</button>
          {page === "comparison" ? <Comparison /> : <DataEditor />}
        </Workspace>
      );
    }

    render(<NavigationHarness />);
    await screen.findByText("Persentase pemulihan");

    await user.click(screen.getByRole("button", { name: "Jalankan Stress-Test Otomatis" }));
    await screen.findAllByText("+2 hari");
    expect(countCalls("/api/simulate/stress-test")).toBe(1);

    await user.click(screen.getByRole("button", { name: "Ke Data Usaha" }));
    const stockInput = await screen.findByLabelText("Stok tepung terigu (g)");
    await user.clear(stockInput);
    await user.type(stockInput, "9000");
    await user.click(screen.getByRole("button", { name: "Simpan Perubahan" }));

    await user.click(screen.getByRole("button", { name: "Ke Perbandingan" }));
    await screen.findByText("Persentase pemulihan");

    expect(countCalls("/api/simulate/compare")).toBe(2);
    expect(countCalls("/api/simulate/stress-test")).toBe(1);
    expect(screen.getByRole("button", { name: "Jalankan Stress-Test Otomatis" })).toBeInTheDocument();
  });

  it("supports switching stress-test scenarios and flags result stale until rerun", async () => {
    const user = userEvent.setup();
    const data = structuredClone(DAPUR_SARI_FALLBACK_FIXTURE);
    const sig = computeInputsSignature(data.snapshot, data.scenarios);

    render(<StressTestPanel data={data} signature={sig} />);

    await user.click(screen.getByRole("button", { name: "Jalankan Stress-Test Otomatis" }));
    await screen.findAllByText("+2 hari");
    expect(countCalls("/api/simulate/stress-test")).toBe(1);

    const delaySelect = screen.getByLabelText("Skenario uji keterlambatan");
    await user.selectOptions(delaySelect, "outage");

    const staleNotice = document.querySelector(".stale-notice");
    expect(staleNotice).toBeInTheDocument();
    await user.click(within(staleNotice as HTMLElement).getByRole("button", { name: "Hitung Ulang Stress-Test" }));

    await waitFor(() => expect(countCalls("/api/simulate/stress-test")).toBe(2));
    const lastStressCall = calls.filter((c) => c.url === "/api/simulate/stress-test").at(-1);
    expect((lastStressCall?.body as { delayScenarioId?: string })?.delayScenarioId).toBe("outage");
    await waitFor(() => expect(document.querySelector(".stale-notice")).not.toBeInTheDocument());
  });

  it("aborts in-flight stress-test request on unmount and shows informative message when no active deliveries or offers exist", async () => {
    const user = userEvent.setup();
    const emptyData = structuredClone(EMPTY_WORKSPACE_FIXTURE);
    const emptySig = computeInputsSignature(emptyData.snapshot, emptyData.scenarios);

    let rejectPending: ((reason?: unknown) => void) | null = null;
    let capturedSignal: AbortSignal | null | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: RequestInit) => {
        if (url === "/api/simulate/stress-test") {
          capturedSignal = init?.signal;
          return new Promise<Response>((_resolve, reject) => {
            rejectPending = reject;
            init?.signal?.addEventListener("abort", () => {
              reject(new DOMException("Aborted", "AbortError"));
            });
          });
        }
        return handler(url, init);
      }),
    );

    const { unmount } = render(<StressTestPanel data={emptyData} signature={emptySig} />);
    await user.click(screen.getByRole("button", { name: "Jalankan Stress-Test Otomatis" }));
    expect(capturedSignal).toBeTruthy();
    expect(capturedSignal?.aborted).toBe(false);

    unmount();
    expect(capturedSignal?.aborted).toBe(true);
    expect(rejectPending).not.toBeNull();

    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => handler(url, init)));
    render(<StressTestPanel data={emptyData} signature={emptySig} />);
    await user.click(screen.getByRole("button", { name: "Jalankan Stress-Test Otomatis" }));

    expect(await screen.findByText(/Belum ada pengiriman terjadwal aktif/i)).toBeInTheDocument();
    expect(screen.getByText(/Belum ada penawaran alternatif/i)).toBeInTheDocument();
  });
});
