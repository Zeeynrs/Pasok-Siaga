import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { HttpError, handleError, readJson } from "@/lib/api/http";
import { computeInputsSignature } from "@/lib/domain/signature";
import { validateWorkspaceData } from "@/lib/domain/validation";
import { runStressTest } from "@/lib/solver/stress-test";

const optionalSlug = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/, "ID skenario tidak valid.")
  .optional();

export async function POST(request: NextRequest) {
  try {
    const body = (await readJson(request)) as {
      snapshot?: unknown;
      scenarios?: unknown;
      delayScenarioId?: unknown;
      offerScenarioId?: unknown;
    } | null;
    if (!body || typeof body !== "object" || !body.snapshot || !body.scenarios) {
      throw new HttpError("Data simulasi tidak lengkap: snapshot dan scenarios wajib diisi.", 400);
    }

    const delayId = optionalSlug.safeParse(body.delayScenarioId);
    const offerId = optionalSlug.safeParse(body.offerScenarioId);
    if (!delayId.success || !offerId.success) {
      throw new HttpError("ID skenario tidak valid.", 400);
    }

    const { snapshot, scenarios } = validateWorkspaceData({ snapshot: body.snapshot, scenarios: body.scenarios });
    const stress_test = await runStressTest(snapshot, scenarios, {
      delayScenarioId: delayId.data,
      offerScenarioId: offerId.data,
    });
    return NextResponse.json({ stress_test, inputs_signature: computeInputsSignature(snapshot, scenarios) });
  } catch (err) {
    return handleError(err);
  }
}
