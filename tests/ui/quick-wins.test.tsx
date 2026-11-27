// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DAPUR_SARI_FALLBACK_FIXTURE, EMPTY_WORKSPACE_FIXTURE } from "@/lib/domain/fixture";
import { computeInputsSignature } from "@/lib/domain/signature";
import { compareScenarios } from "@/lib/solver/compare";
import { solveScenario } from "@/lib/solver/milp-solver";

vi.mock("@/lib/notify", () => ({ notify: { success: vi.fn(), error: vi.fn(), info: vi.fn(), changed: vi.fn() } }));
vi.mock("@/features/network/network-canvas", () => ({ NetworkCanvas: () => <div data-testid="graph-canvas" /> }));
vi.mock("@/features/simulation/comparison-chart", () => ({ ComparisonChart: () => <div data-testid="chart" /> }));

let searchQuery = "";
const replace = vi.fn();
const router = { replace, push: vi.fn() };
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/dashboard",
  useSearchParams: () => new URLSearchParams(searchQuery),
}));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { signOut: vi.fn().mockResolvedValue({}) } }) }));

import { Workspace } from "@/components/workspace";
import { Dashboard } from "@/features/dashboard/dashboard";
import { DataEditor } from "@/features/data-editor/data-editor";
import { SupplyNetwork } from "@/features/network/supply-network";
import { Comparison } from "@/features/simulation/comparison";
import { Simulator } from "@/features/simulation/simulator";
import { notify } from "@/lib/notify";
import { resetStoredValues } from "@/lib/use-stored-value";

const BUSINESS_ID = "11111111-1111-4111-8111-111111111111";
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

async function handler(url: string, init?: RequestInit): Promise<Response> {
  const method = init?.method ?? "GET";
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  if (url === "/api/demo") return json(structuredClone(DAPUR_SARI_FALLBACK_FIXTURE));
  if (url === "/api/simulate") return json({ result: await solveScenario(body.snapshot, body.scenario) });
  if (url === "/api/simulate/compare") {
    const { results, comparison } = await compareScenarios(body.snapshot, body.scenarios);
    return json({ results, comparison, inputs_signature: computeInputsSignature(body.snapshot, body.scenarios) });
  }
  if (url === "/api/workspace" && method === "GET") {
    return json({ businessId: BUSINESS_ID, ...structuredClone(EMPTY_WORKSPACE_FIXTURE) });
  }
  if (url === "/api/workspace" && method === "PUT") {
    return json({ ok: true, snapshot: body.snapshot, scenarios: body.scenarios });
  }
  return json({ error: "tidak ditemukan" }, 404);
}

beforeEach(() => {
  searchQuery = "";
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

describe("Template starter sektor kuliner", () => {
  it("hides template cards on empty Dashboard until user clicks Pilih Template Starter, then applies Kedai Kopi Susu", async () => {
    render(
      <Workspace mode="workspace">
        <Dashboard />
      </Workspace>,
    );
    await screen.findByRole("heading", { level: 1 });

    expect(screen.getByText("Mulai dari nol")).toBeInTheDocument();
    expect(screen.queryByText(/Dapur Sari/)).not.toBeInTheDocument();
    expect(screen.queryByText("Kedai Kopi Susu")).not.toBeInTheDocument();

    const toggleButton = screen.getByRole("button", { name: "Pilih Template Starter" });
    await userEvent.click(toggleButton);

    expect(screen.getByText("Toko Roti & Kue (Dapur Sari)")).toBeInTheDocument();
    expect(screen.getByText("Kedai Kopi Susu")).toBeInTheDocument();
    expect(screen.getByText("Dimsum & Frozen Food")).toBeInTheDocument();
    expect(screen.getByText("Martabak & Kue Malam")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Pakai template Kedai Kopi Susu" }));

    expect(screen.getAllByText("Kedai Kopi Susu").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Susu segar").length).toBeGreaterThan(0);
    expect(screen.getByText(/Es Kopi Susu Aren/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Simpan ke Workspace/ })).toBeEnabled();
    expect(notify.success).toHaveBeenCalled();
  });

  it("asks for confirmation on DataEditor before overwriting existing data and refreshes inputs after confirm", async () => {
    render(
      <Workspace mode="demo">
        <DataEditor />
      </Workspace>,
    );
    await screen.findByRole("heading", { level: 1 });
    expect(screen.getByLabelText("Nama usaha")).toHaveValue("Dapur Sari");

    await userEvent.click(screen.getByRole("button", { name: /Template Starter/ }));
    await userEvent.click(screen.getByRole("button", { name: "Pakai template Kedai Kopi Susu" }));

    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toBeInTheDocument();
    expect(screen.getByLabelText("Nama usaha")).toHaveValue("Dapur Sari");

    await userEvent.click(screen.getByRole("button", { name: "Ya, Terapkan Template" }));

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Nama usaha")).toHaveValue("Kedai Kopi Susu");
    expect(screen.getByLabelText("Stok susu segar (ml)")).toHaveValue(6000);
    expect(notify.success).toHaveBeenCalled();
  });

  it("opens Template Starter panel automatically when ?panel=templates is present", async () => {
    searchQuery = "panel=templates";
    render(
      <Workspace mode="demo">
        <DataEditor />
      </Workspace>,
    );
    await screen.findByRole("heading", { level: 1 });
    expect(screen.getByRole("button", { name: "Pakai template Kedai Kopi Susu" })).toBeInTheDocument();
  });
});

describe("Salin pesan WhatsApp & ekspor CSV", () => {
  it("shows WhatsApp order copy, Buka WhatsApp link, and CSV download after mitigation simulation", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    render(
      <Workspace mode="demo">
        <Simulator />
      </Workspace>,
    );
    await screen.findByRole("heading", { level: 1 });

    await user.click(screen.getByRole("radio", { name: "Mitigasi: Pemasok Alternatif Aktif" }));
    await user.click(screen.getByRole("button", { name: "Jalankan Simulasi" }));
    await screen.findByRole("heading", { name: "Hasil Simulasi" });

    const copyBtn = screen.getByRole("button", { name: "Salin Pesan Order (WA)" });
    const waLink = screen.getByRole("link", { name: "Buka WhatsApp" });
    const csvBtn = screen.getByRole("button", { name: "Unduh CSV" });

    expect(copyBtn).toBeInTheDocument();
    expect(waLink).toHaveAttribute("href", expect.stringMatching(/^https:\/\/wa\.me\/\?text=/));
    expect(csvBtn).toBeInTheDocument();

    await user.click(copyBtn);
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText.mock.calls[0][0]).toContain("Pemasok B");
    expect(notify.success).toHaveBeenCalled();
  });

  it("uses Salin Ringkasan without Buka WhatsApp link on Normal scenario", async () => {
    const user = userEvent.setup();
    const createObjectURL = vi.fn(() => "blob:sim-csv");
    const revokeObjectURL = vi.fn();
    const BaseURL = globalThis.URL;
    class StubURL extends BaseURL {
      static createObjectURL = createObjectURL;
      static revokeObjectURL = revokeObjectURL;
    }
    vi.stubGlobal("URL", StubURL);
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    render(
      <Workspace mode="demo">
        <Simulator />
      </Workspace>,
    );
    await screen.findByRole("heading", { level: 1 });

    await user.click(screen.getByRole("radio", { name: "Normal" }));
    await user.click(screen.getByRole("button", { name: "Jalankan Simulasi" }));
    await screen.findByRole("heading", { name: "Hasil Simulasi" });

    expect(screen.getByRole("button", { name: "Salin Ringkasan" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Buka WhatsApp" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Unduh CSV" }));
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it("renders Unduh CSV on Comparison and triggers CSV download", async () => {
    const user = userEvent.setup();
    const createObjectURL = vi.fn(() => "blob:comp-csv");
    const revokeObjectURL = vi.fn();
    const BaseURL = globalThis.URL;
    class StubURL extends BaseURL {
      static createObjectURL = createObjectURL;
      static revokeObjectURL = revokeObjectURL;
    }
    vi.stubGlobal("URL", StubURL);
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    render(
      <Workspace mode="demo">
        <Comparison />
      </Workspace>,
    );
    await screen.findByText("Persentase pemulihan");

    const csvBtn = screen.getByRole("button", { name: "Unduh CSV" });
    await user.click(csvBtn);

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    const blob = (createObjectURL.mock.calls[0] as unknown[])[0] as Blob;
    expect(blob).toBeInstanceOf(Blob);
    const text = await blob.text();
    expect(text).toContain("Normal");
    expect(text).toContain("55%");
  });
});

describe("Perbandingan antar skenario kustom", () => {
  it("allows selecting custom scenario roles, filtering visible scenarios, disabling the last checkbox, and exporting filtered CSV", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.fn((url: string, init?: RequestInit) => handler(url, init));
    vi.stubGlobal("fetch", fetchSpy);

    const createObjectURL = vi.fn(() => "blob:filtered-comp-csv");
    const revokeObjectURL = vi.fn();
    const BaseURL = globalThis.URL;
    class StubURL extends BaseURL {
      static createObjectURL = createObjectURL;
      static revokeObjectURL = revokeObjectURL;
    }
    vi.stubGlobal("URL", StubURL);
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    function SimAndComparisonHarness() {
      const [page, setPage] = useState<"simulator" | "comparison">("simulator");
      return (
        <Workspace mode="demo">
          <button type="button" onClick={() => setPage("comparison")}>Buka Halaman Perbandingan</button>
          {page === "simulator" ? <Simulator /> : <Comparison />}
        </Workspace>
      );
    }

    render(<SimAndComparisonHarness />);
    await screen.findByRole("heading", { level: 1 });

    // Buat skenario kustom dari Mitigasi lalu aktifkan kembali Pemasok A agar kontribusinya naik ke Rp 450.000
    await user.click(screen.getByRole("radio", { name: "Mitigasi: Pemasok Alternatif Aktif" }));
    await user.click(screen.getByRole("button", { name: "Tambah Skenario" }));
    expect(screen.getByRole("radio", { name: "Skenario 1" })).toBeChecked();

    await user.click(screen.getByText("Atur skenario"));
    await user.click(screen.getByRole("checkbox", { name: "Pemasok A gagal kirim" }));

    await user.click(screen.getByRole("button", { name: "Buka Halaman Perbandingan" }));
    await screen.findByText("Persentase pemulihan");

    const compareCalls = () => fetchSpy.mock.calls.filter(([url]) => url === "/api/simulate/compare").length;
    expect(compareCalls()).toBe(1);

    // Panel kontrol Atur Pembanding tersedia dengan 3 dropdown peran & checkbox filter skenario
    expect(screen.getByRole("heading", { name: "Atur Pembanding" })).toBeInTheDocument();
    const baselineSelect = screen.getByLabelText("Acuan Normal") as HTMLSelectElement;
    const outageSelect = screen.getByLabelText("Skenario Gangguan") as HTMLSelectElement;
    const mitigationSelect = screen.getByLabelText("Skenario Mitigasi") as HTMLSelectElement;

    expect(baselineSelect.value).toBe("baseline");
    expect(outageSelect.value).toBe("outage");
    expect(mitigationSelect.value).toBe("mitigation");

    // Ubah Skenario Mitigasi ke skenario kustom tanpa memanggil ulang /api/simulate/compare
    await user.selectOptions(mitigationSelect, "skenario_1");
    expect(compareCalls()).toBe(1);

    const metrics = document.querySelector(".comparison-metrics") as HTMLElement;
    expect(within(metrics).getAllByText(/Rp\s240\.000/)).toHaveLength(2);
    expect(within(metrics).getByText("100%")).toBeInTheDocument();
    expect(within(metrics).queryByText("55%")).not.toBeInTheDocument();

    // Nonaktifkan checkbox filter hingga tersisa 1 skenario aktif (yang harus disabled)
    const normalCheck = screen.getByRole("checkbox", { name: "Normal" });
    const outageCheck = screen.getByRole("checkbox", { name: "Pemasok Utama Gagal" });
    const mitigationCheck = screen.getByRole("checkbox", { name: "Mitigasi: Pemasok Alternatif Aktif" });
    const customCheck = screen.getByRole("checkbox", { name: "Skenario 1" });

    await user.click(outageCheck);
    await user.click(mitigationCheck);

    const table = screen.getAllByRole("table")[0];
    expect(within(table).queryByText("Pemasok Utama Gagal")).not.toBeInTheDocument();
    expect(within(table).queryByText("Mitigasi: Pemasok Alternatif Aktif")).not.toBeInTheDocument();
    expect(within(table).getByText("Normal")).toBeInTheDocument();
    expect(within(table).getByText("Skenario 1")).toBeInTheDocument();

    // KPI pemulihan tetap memakai skenario peran dari hasil penuh walau Pemasok Utama Gagal disembunyikan
    expect(within(metrics).getByText("100%")).toBeInTheDocument();

    // Nonaktifkan Normal sehingga tinggal Skenario 1; checkbox terakhir menjadi disabled
    await user.click(normalCheck);
    expect(customCheck).toBeChecked();
    expect(customCheck).toBeDisabled();
    expect(within(table).queryByText("Normal")).not.toBeInTheDocument();
    expect(within(table).getByText("Skenario 1")).toBeInTheDocument();

    // Aktifkan kembali Normal agar ekspor CSV berisi 2 skenario terfilter saja
    await user.click(normalCheck);
    expect(customCheck).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Unduh CSV" }));
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    const blob = (createObjectURL.mock.calls[0] as unknown[])[0] as Blob;
    const csv = await blob.text();
    expect(csv).toContain("Normal");
    expect(csv).toContain("Skenario 1");
    expect(csv).toContain("100%");
    expect(csv).not.toContain("Pemasok Utama Gagal");
    expect(compareCalls()).toBe(1);
  });
});

describe("Aksi cepat dari Jaringan Pasok", () => {
  it("tests supplier failure from SupplyNetwork detail, creates/selects outage scenario, and navigates to simulator", async () => {
    const user = userEvent.setup();
    function NetworkToSimHarness() {
      const [page, setPage] = useState<"network" | "simulator">("network");
      return (
        <Workspace mode="demo">
          <button type="button" onClick={() => setPage("simulator")}>Buka Halaman Simulator</button>
          {page === "network" ? <SupplyNetwork /> : <Simulator />}
        </Workspace>
      );
    }

    render(<NetworkToSimHarness />);
    await screen.findByRole("heading", { level: 1 });

    await user.click(screen.getByRole("button", { name: "Daftar" }));
    await user.click(screen.getByRole("button", { name: /Pemasok B/ }));

    const detail = screen.getByRole("region", { name: "Detail hubungan" });
    const testBtn = within(detail).getByRole("button", { name: "Uji jika pemasok ini gagal" });
    await user.click(testBtn);

    expect(router.push).toHaveBeenCalledWith("/simulator");

    await user.click(screen.getByRole("button", { name: "Buka Halaman Simulator" }));
    expect(screen.getByRole("radio", { name: "Uji Gagal: Pemasok B" })).toBeChecked();
  });

  it("shows backup offer and simulator quick actions on material node and navigates to /data?focus=offers", async () => {
    const user = userEvent.setup();
    render(
      <Workspace mode="demo">
        <SupplyNetwork />
      </Workspace>,
    );
    await screen.findByRole("heading", { level: 1 });

    await user.click(screen.getByRole("button", { name: "Daftar" }));
    await user.click(screen.getByRole("button", { name: /Tepung terigu/ }));

    const detail = screen.getByRole("region", { name: "Detail hubungan" });
    const backupBtn = within(detail).getByRole("button", { name: "Tambah pemasok cadangan" });
    const simBtn = within(detail).getByRole("button", { name: "Buka Simulator" });
    expect(backupBtn).toBeInTheDocument();
    expect(simBtn).toBeInTheDocument();

    await user.click(backupBtn);
    expect(router.push).toHaveBeenCalledWith("/data?focus=offers");

    await user.click(simBtn);
    expect(router.push).toHaveBeenCalledWith("/simulator");
  });

  it("shows Simulasikan produksi on product node and navigates to /simulator", async () => {
    const user = userEvent.setup();
    render(
      <Workspace mode="demo">
        <SupplyNetwork />
      </Workspace>,
    );
    await screen.findByRole("heading", { level: 1 });

    await user.click(screen.getByRole("button", { name: "Daftar" }));
    await user.click(screen.getByRole("button", { name: /Roti/ }));

    const detail = screen.getByRole("region", { name: "Detail hubungan" });
    const simBtn = within(detail).getByRole("button", { name: "Simulasikan produksi" });
    await user.click(simBtn);
    expect(router.push).toHaveBeenCalledWith("/simulator");
  });

  it("opens Penawaran alternatif panel in StructureEditor when focus=offers even on mobile without scrollIntoView", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("max-width"),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    searchQuery = "focus=offers";

    render(
      <Workspace mode="demo">
        <DataEditor />
      </Workspace>,
    );
    await screen.findByRole("heading", { level: 1 });

    const offersDetails = screen.getByRole("heading", { name: /Penawaran alternatif/ }).closest("details");
    const suppliersDetails = document.querySelector('[data-tour="structure"]');
    expect(offersDetails).toHaveAttribute("open");
    expect(suppliersDetails).not.toHaveAttribute("open");
  });
});
