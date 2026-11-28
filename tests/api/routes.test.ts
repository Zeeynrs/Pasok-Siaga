import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DAPUR_SARI_FALLBACK_FIXTURE } from "@/lib/domain/fixture";
import type { WorkspaceData } from "@/lib/domain/types";
import { WorkspaceRepoError } from "@/lib/supabase/workspace-repo";

const fresh = (): WorkspaceData => structuredClone(DAPUR_SARI_FALLBACK_FIXTURE);
const BUSINESS_ID = "11111111-1111-4111-8111-111111111111";

const auth = {
  getUser: vi.fn(),
  exchangeCodeForSession: vi.fn(),
};
const supabase = { auth };

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => supabase) }));
vi.mock("@/lib/supabase/workspace-repo", async (orig) => ({
  ...(await orig<typeof import("@/lib/supabase/workspace-repo")>()),
  loadDemoTemplate: vi.fn(),
  loadUserWorkspace: vi.fn(),
  saveUserWorkspace: vi.fn(),
  resetUserWorkspace: vi.fn(),
}));

import * as repo from "@/lib/supabase/workspace-repo";
import { GET as getDemo } from "@/app/api/demo/route";
import { POST as simulate } from "@/app/api/simulate/route";
import { POST as compare } from "@/app/api/simulate/compare/route";
import { POST as stressTest } from "@/app/api/simulate/stress-test/route";
import { GET as getWorkspace, PUT as putWorkspace } from "@/app/api/workspace/route";
import { POST as resetWorkspace } from "@/app/api/workspace/reset/route";
import { GET as authCallback } from "@/app/auth/callback/route";

const post = (url: string, body: unknown, method = "POST") =>
  new NextRequest(`http://localhost${url}`, {
    method,
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
const get = (url: string) => new NextRequest(`http://localhost${url}`);

beforeEach(() => {
  vi.clearAllMocks();
  auth.getUser.mockResolvedValue({ data: { user: null }, error: null });
});

describe("POST /api/simulate", () => {
  it("returns 200 with result and inputs_signature for Dapur Sari", async () => {
    const { snapshot, scenarios } = fresh();
    const res = await simulate(post("/api/simulate", { snapshot, scenario: scenarios[2] }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.net_contribution_idr).toBe(342_000);
    expect(body.inputs_signature).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns 400 in Indonesian for negative stock or wrong units, without stack traces", async () => {
    const { snapshot, scenarios } = fresh();
    snapshot.materials[0].stock_on_hand = -5;
    const res = await simulate(post("/api/simulate", { snapshot, scenario: scenarios[0] }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/tidak valid/i);
    expect(JSON.stringify(body)).not.toMatch(/at .*\.(ts|js)|stack/i);

    const bad = fresh();
    bad.snapshot.materials[0].base_unit = "ml";
    const res2 = await simulate(post("/api/simulate", { snapshot: bad.snapshot, scenario: bad.scenarios[0] }));
    expect(res2.status).toBe(400);
  });

  it("returns 400 for malformed JSON and missing fields", async () => {
    expect((await simulate(post("/api/simulate", "{not json"))).status).toBe(400);
    expect((await simulate(post("/api/simulate", { snapshot: fresh().snapshot }))).status).toBe(400);
  });

  it("rejects oversized bodies with 413", async () => {
    const res = await simulate(post("/api/simulate", JSON.stringify({ pad: "x".repeat(2_000_000) })));
    expect(res.status).toBe(413);
  });
});

describe("POST /api/simulate/compare", () => {
  it("returns results, comparison and signature", async () => {
    const { snapshot, scenarios } = fresh();
    const res = await compare(post("/api/simulate/compare", { snapshot, scenarios }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results).toHaveLength(3);
    expect(body.comparison.recovered_idr).toBe(132_000);
    expect(body.inputs_signature).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns 400 when a core scenario is missing", async () => {
    const { snapshot, scenarios } = fresh();
    const res = await compare(post("/api/simulate/compare", { snapshot, scenarios: scenarios.slice(0, 2) }));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/simulate/stress-test", () => {
  it("returns 200 with stress_test and inputs_signature for Dapur Sari", async () => {
    const { snapshot, scenarios } = fresh();
    const res = await stressTest(post("/api/simulate/stress-test", { snapshot, scenarios }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.stress_test.critical_delay_days).toBe(2);
    expect(body.stress_test.offer_breakevens[0].max_viable_premium_idr).toBe(11_999);
    expect(body.inputs_signature).toMatch(/^[0-9a-f]{64}$/);
  });

  it("handles optional delayScenarioId and offerScenarioId safely", async () => {
    const { snapshot, scenarios } = fresh();
    const okRes = await stressTest(
      post("/api/simulate/stress-test", {
        snapshot,
        scenarios,
        delayScenarioId: "tidak_dikenal",
        offerScenarioId: "mitigation",
      }),
    );
    expect(okRes.status).toBe(200);

    const badSlugRes = await stressTest(
      post("/api/simulate/stress-test", {
        snapshot,
        scenarios,
        delayScenarioId: "bad id!",
      }),
    );
    expect(badSlugRes.status).toBe(400);
    expect((await badSlugRes.json()).error).toMatch(/tidak valid/i);
  });

  it("returns 400 in Indonesian for malformed JSON, missing fields, or negative stock", async () => {
    const badJson = await stressTest(post("/api/simulate/stress-test", "{not json"));
    expect(badJson.status).toBe(400);
    expect((await badJson.json()).error).toMatch(/tidak valid/i);

    const incomplete = await stressTest(post("/api/simulate/stress-test", { snapshot: fresh().snapshot }));
    expect(incomplete.status).toBe(400);
    expect((await incomplete.json()).error).toMatch(/tidak lengkap/i);

    const neg = fresh();
    neg.snapshot.materials[0].stock_on_hand = -5;
    const negRes = await stressTest(post("/api/simulate/stress-test", neg));
    expect(negRes.status).toBe(400);
    const negBody = await negRes.json();
    expect(negBody.error).toMatch(/tidak valid/i);
    expect(JSON.stringify(negBody)).not.toMatch(/at .*\.(ts|js)|stack/i);
  });

  it("rejects oversized bodies with 413", async () => {
    const res = await stressTest(post("/api/simulate/stress-test", JSON.stringify({ pad: "x".repeat(2_000_000) })));
    expect(res.status).toBe(413);
  });
});

describe("GET /api/demo", () => {
  it("returns the template snapshot and scenarios", async () => {
    vi.mocked(repo.loadDemoTemplate).mockResolvedValue({ ...fresh(), snapshot: { ...fresh().snapshot, demo_data: true } });
    const res = await getDemo();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.snapshot.business.id).toBe("dapur_sari");
    expect(body.scenarios).toHaveLength(3);
  });

  it("maps repository errors to friendly status codes", async () => {
    vi.mocked(repo.loadDemoTemplate).mockRejectedValue(new WorkspaceRepoError("Template demo Dapur Sari belum tersedia.", 404));
    const res = await getDemo();
    expect(res.status).toBe(404);
    expect((await res.json()).error).toContain("Template demo");
  });
});

describe("/api/workspace", () => {
  const signedIn = () => auth.getUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });

  it("GET returns 401 without a session", async () => {
    const res = await getWorkspace();
    expect(res.status).toBe(401);
    expect(repo.loadUserWorkspace).not.toHaveBeenCalled();
  });

  it("GET returns businessId, snapshot and scenarios for a signed-in user", async () => {
    signedIn();
    vi.mocked(repo.loadUserWorkspace).mockResolvedValue({ businessId: BUSINESS_ID, data: fresh() });
    const res = await getWorkspace();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.businessId).toBe(BUSINESS_ID);
    expect(body.snapshot.business.id).toBe("dapur_sari");
  });

  it("PUT returns 401 without a session and 400 for invalid payloads", async () => {
    const data = fresh();
    expect((await putWorkspace(post("/api/workspace", { businessId: BUSINESS_ID, ...data }, "PUT"))).status).toBe(401);

    signedIn();
    data.snapshot.bom[0].quantity_per_product = 0;
    expect((await putWorkspace(post("/api/workspace", { businessId: BUSINESS_ID, ...data }, "PUT"))).status).toBe(400);
    expect((await putWorkspace(post("/api/workspace", { businessId: "bukan-uuid", ...fresh() }, "PUT"))).status).toBe(400);
    expect(repo.saveUserWorkspace).not.toHaveBeenCalled();
  });

  it("PUT refuses to delete core scenarios", async () => {
    signedIn();
    const data = fresh();
    data.scenarios = data.scenarios.filter((s) => s.id !== "outage");
    const res = await putWorkspace(post("/api/workspace", { businessId: BUSINESS_ID, ...data }, "PUT"));
    expect(res.status).toBe(400);
    expect(repo.saveUserWorkspace).not.toHaveBeenCalled();
  });

  it("PUT saves and returns ok with the persisted data", async () => {
    signedIn();
    const data = fresh();
    vi.mocked(repo.saveUserWorkspace).mockResolvedValue(data);
    const res = await putWorkspace(post("/api/workspace", { businessId: BUSINESS_ID, ...data }, "PUT"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.snapshot.business.id).toBe("dapur_sari");
    expect(repo.saveUserWorkspace).toHaveBeenCalledWith(supabase, BUSINESS_ID, data);
  });

  it("POST /reset returns 401 without session and the reset workspace with one", async () => {
    expect((await resetWorkspace()).status).toBe(401);
    signedIn();
    vi.mocked(repo.resetUserWorkspace).mockResolvedValue({ businessId: BUSINESS_ID, data: fresh() });
    const res = await resetWorkspace();
    expect(res.status).toBe(200);
    expect((await res.json()).businessId).toBe(BUSINESS_ID);
  });

  it("hides unexpected internal errors behind a generic message", async () => {
    signedIn();
    vi.mocked(repo.loadUserWorkspace).mockRejectedValue(new Error("connection refused 10.0.0.5:5432 secret=abc"));
    const res = await getWorkspace();
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toMatch(/10\.0\.0\.5|secret/);
  });
});

describe("GET /auth/callback", () => {
  it("redirects to /login with an error when the code is missing", async () => {
    const res = await authCallback(get("/auth/callback"));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/login");
  });

  it("exchanges the code, ensures the workspace and redirects to /workspace", async () => {
    auth.exchangeCodeForSession.mockResolvedValue({ error: null });
    vi.mocked(repo.loadUserWorkspace).mockResolvedValue({ businessId: BUSINESS_ID, data: fresh() });
    const res = await authCallback(get("/auth/callback?code=abc&next=https://evil.example"));
    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith("abc");
    expect(new URL(res.headers.get("location")!).pathname).toBe("/workspace");
    expect(new URL(res.headers.get("location")!).host).toBe("localhost");
  });

  it("sends reset links (next=/reset-password) to the change-password page, not the workspace, and skips workspace setup", async () => {
    auth.exchangeCodeForSession.mockResolvedValue({ error: null });
    const res = await authCallback(get("/auth/callback?code=abc&next=/reset-password"));
    expect(new URL(res.headers.get("location")!).pathname).toBe("/reset-password");
    expect(repo.loadUserWorkspace).not.toHaveBeenCalled();
  });

  it("also recognises the reset cookie when Supabase drops the next parameter, then clears it", async () => {
    auth.exchangeCodeForSession.mockResolvedValue({ error: null });
    const req = new NextRequest("http://localhost/auth/callback?code=abc", { headers: { cookie: "microchain-reset=1" } });
    const res = await authCallback(req);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/reset-password");
    expect(res.headers.get("set-cookie") ?? "").toMatch(/microchain-reset=;/);
  });

  it("only honours the exact /reset-password target; other next values go to the workspace", async () => {
    auth.exchangeCodeForSession.mockResolvedValue({ error: null });
    vi.mocked(repo.loadUserWorkspace).mockResolvedValue({ businessId: BUSINESS_ID, data: fresh() });
    for (const next of ["/reset-password/../admin", "//evil.example", "https://evil.example/reset-password"]) {
      const res = await authCallback(get("/auth/callback?code=abc&next=" + encodeURIComponent(next)));
      const location = new URL(res.headers.get("location")!);
      expect(location.pathname).toBe("/workspace");
      expect(location.host).toBe("localhost");
    }
  });

  it("redirects to /login when the exchange fails", async () => {
    auth.exchangeCodeForSession.mockResolvedValue({ error: { message: "invalid" } });
    const res = await authCallback(get("/auth/callback?code=bad"));
    expect(new URL(res.headers.get("location")!).pathname).toBe("/login");
  });
});
