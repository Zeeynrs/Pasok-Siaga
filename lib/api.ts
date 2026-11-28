import type { ScenarioConfig, ScenarioResult, WorkspaceData, WorkspaceSnapshot, ComparisonSummary } from "@/lib/domain/types";
import type { StressTestResult } from "@/lib/solver/stress-test";
import type { ComparisonResult, SimulationResult } from "@/lib/types";
import { toComparisonView, toSimulationView } from "@/lib/view-models";

/** Galat API berpesan Indonesia; `status` 0 berarti server tidak terjangkau. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function request<T>(url: string, init?: RequestInit, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { cache: "no-store", ...init, signal });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ApiError("Server belum dapat dihubungi. Periksa koneksi internet lalu coba lagi.", 0);
  }
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  if (!response.ok) throw new ApiError(body?.error ?? "Terjadi kesalahan. Coba lagi beberapa saat.", response.status);
  if (body === null) throw new ApiError("Server mengembalikan respons yang tidak dapat dibaca.", response.status);
  return body as T;
}

export const postJson = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

export const putJson = (body: unknown): RequestInit => ({ ...postJson(body), method: "PUT" });

/** Simulasi satu skenario (POST /api/simulate) sebagai view model tampilan. */
export async function previewScenario(
  snapshot: WorkspaceSnapshot,
  scenario: ScenarioConfig,
  signal?: AbortSignal,
): Promise<SimulationResult> {
  const { result } = await request<{ result: ScenarioResult }>("/api/simulate", postJson({ snapshot, scenario }), signal);
  return toSimulationView(result, snapshot, scenario);
}

/** Bandingkan seluruh skenario (POST /api/simulate/compare). */
export async function compareAll(data: WorkspaceData, signal?: AbortSignal): Promise<ComparisonResult> {
  const { results } = await request<{ results: ScenarioResult[]; comparison: ComparisonSummary }>(
    "/api/simulate/compare",
    postJson({ snapshot: data.snapshot, scenarios: data.scenarios }),
    signal,
  );
  return toComparisonView(results, data.scenarios, data.snapshot);
}

/** Jalankan uji ketahanan & titik impas premi penawaran (POST /api/simulate/stress-test). */
export async function runStressTestPreview(
  data: WorkspaceData,
  options?: { delayScenarioId?: string; offerScenarioId?: string },
  signal?: AbortSignal,
): Promise<StressTestResult> {
  const { stress_test } = await request<{ stress_test: StressTestResult }>(
    "/api/simulate/stress-test",
    postJson({
      snapshot: data.snapshot,
      scenarios: data.scenarios,
      delayScenarioId: options?.delayScenarioId,
      offerScenarioId: options?.offerScenarioId,
    }),
    signal,
  );
  return stress_test;
}
