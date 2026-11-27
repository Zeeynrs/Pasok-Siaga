// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
