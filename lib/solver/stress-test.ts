import type { ScenarioConfig, ScenarioResult, WorkspaceSnapshot } from "@/lib/domain/types";
import { resolveScenarioInputs } from "./inputs";
import { solveScenario } from "./milp-solver";

export interface DelayStressPoint {
  delay_days: number;
  net_contribution_idr: number | null;
  status: ScenarioResult["status"];
  unmet_units: number;
}

export interface PremiumSamplePoint {
  premium_idr: number;
  net_contribution_idr: number | null;
  packs_bought: number;
  status: ScenarioResult["status"];
}

export interface OfferBreakeven {
  offer_id: string;
  supplier_name: string;
  material_name: string;
  current_premium_idr: number;
  max_viable_premium_idr: number | null;
  headroom_idr: number | null;
  points: PremiumSamplePoint[];
}

export interface StressTestResult {
  delay_scenario_id: string;
  offer_scenario_id: string;
  baseline_net_idr: number | null;
  critical_delay_days: number | null;
  delay_curve: DelayStressPoint[];
  no_offer_net_idr: number | null;
  offer_breakevens: OfferBreakeven[];
}

const MAX_DELAY_DAYS = 5;
const MIN_SEARCH_HI_IDR = 10_000;
const MAX_SEARCH_HI_IDR = 10_000_000;
const SAMPLE_POINT_COUNT = 6;

function pickDelayScenario(scenarios: ScenarioConfig[], delayScenarioId?: string): ScenarioConfig | undefined {
  return (
    (delayScenarioId ? scenarios.find((s) => s.id === delayScenarioId) : undefined) ??
    scenarios.find((s) => s.id === "baseline") ??
    scenarios[0]
  );
}

function pickOfferScenario(scenarios: ScenarioConfig[], offerScenarioId?: string): ScenarioConfig | undefined {
  return (
    (offerScenarioId ? scenarios.find((s) => s.id === offerScenarioId) : undefined) ??
    scenarios.find((s) => s.id === "mitigation") ??
    scenarios.find((s) => s.enabled_offer_ids.length > 0) ??
    scenarios[0]
  );
}

function toDelayPoint(delayDays: number, res: ScenarioResult): DelayStressPoint {
  return {
    delay_days: delayDays,
    net_contribution_idr: res.status === "Optimal" ? res.net_contribution_idr : null,
    status: res.status,
    unmet_units: res.production.reduce((sum, line) => sum + Math.max(0, line.demand_units - line.units), 0),
  };
}

async function buildDelayCurve(
  snapshot: WorkspaceSnapshot,
  delayBase: ScenarioConfig,
): Promise<{ baselineNet: number | null; criticalDelayDays: number | null; delayCurve: DelayStressPoint[] }> {
  const inputs = resolveScenarioInputs(snapshot, delayBase);
  const activeDeliveryIds = inputs.deliveryStatuses.filter((d) => d.counted).map((d) => d.delivery_id);
  const delayCurve: DelayStressPoint[] = [];

  if (activeDeliveryIds.length === 0) {
    const baseRes = await solveScenario(snapshot, delayBase);
    for (let delayDays = 0; delayDays <= MAX_DELAY_DAYS; delayDays += 1) {
      delayCurve.push(toDelayPoint(delayDays, baseRes));
    }
    return {
      baselineNet: delayCurve[0]?.net_contribution_idr ?? null,
      criticalDelayDays: null,
      delayCurve,
    };
  }

  for (let delayDays = 0; delayDays <= MAX_DELAY_DAYS; delayDays += 1) {
    const scenario: ScenarioConfig =
      delayDays === 0
        ? delayBase
        : {
            ...delayBase,
            disruptions: [
              ...delayBase.disruptions,
              ...activeDeliveryIds.map((delivery_id) => ({
                type: "delay_delivery" as const,
                delivery_id,
                delay_days: delayDays,
              })),
            ],
          };
    delayCurve.push(toDelayPoint(delayDays, await solveScenario(snapshot, scenario)));
  }

  const baselineNet = delayCurve[0]?.net_contribution_idr ?? null;
  const criticalPoint =
    baselineNet === null
      ? null
      : delayCurve.find(
          (pt) =>
            pt.delay_days > 0 &&
            (pt.status !== "Optimal" || (pt.net_contribution_idr !== null && pt.net_contribution_idr < baselineNet)),
        ) ?? null;

  return {
    baselineNet,
    criticalDelayDays: criticalPoint ? criticalPoint.delay_days : null,
    delayCurve,
  };
}

function buildSamplePremiums(hi: number, anchors: number[], targetCount = SAMPLE_POINT_COUNT): number[] {
  const set = new Set<number>(anchors.filter((v) => v >= 0));
  set.add(0);
  set.add(hi);

  while (set.size < targetCount) {
    const sorted = [...set].sort((a, b) => a - b);
    let bestGap = 1;
    let bestMid = -1;
    for (let i = 1; i < sorted.length; i += 1) {
      const gap = sorted[i] - sorted[i - 1];
      if (gap > bestGap) {
        bestGap = gap;
        bestMid = Math.floor((sorted[i - 1] + sorted[i]) / 2);
      }
    }
    if (bestMid < 0 || set.has(bestMid)) break;
    set.add(bestMid);
  }

  return [...set].sort((a, b) => a - b);
}

async function solveOfferBreakeven(
  snapshot: WorkspaceSnapshot,
  offerBase: ScenarioConfig,
  offerId: string,
  supplierName: string,
  materialName: string,
  currentPremium: number,
): Promise<OfferBreakeven> {
  const withoutOfferRes = await solveScenario(snapshot, {
    ...offerBase,
    enabled_offer_ids: offerBase.enabled_offer_ids.filter((id) => id !== offerId),
  });
  const withoutThisOfferNet = withoutOfferRes.status === "Optimal" ? withoutOfferRes.net_contribution_idr : null;

  const cache = new Map<number, PremiumSamplePoint>();
  const evalAt = async (premiumIdr: number): Promise<PremiumSamplePoint> => {
    const cached = cache.get(premiumIdr);
    if (cached) return cached;

    const modSnapshot: WorkspaceSnapshot = {
      ...snapshot,
      alternative_offers: snapshot.alternative_offers.map((o) =>
        o.id === offerId ? { ...o, incremental_premium_idr_per_pack: premiumIdr } : o,
      ),
    };
    const res = await solveScenario(modSnapshot, offerBase);
    const purchase = res.alternative_purchases.find((p) => p.offer_id === offerId);
    const point: PremiumSamplePoint = {
      premium_idr: premiumIdr,
      net_contribution_idr: res.status === "Optimal" ? res.net_contribution_idr : null,
      packs_bought: purchase?.packs_bought ?? 0,
      status: res.status,
    };
    cache.set(premiumIdr, point);
    return point;
  };

  const isViable = (pt: PremiumSamplePoint) =>
    pt.status === "Optimal" &&
    pt.net_contribution_idr !== null &&
    pt.packs_bought > 0 &&
    (withoutThisOfferNet === null || pt.net_contribution_idr > withoutThisOfferNet);

  const atZero = await evalAt(0);
  let hi = Math.min(MAX_SEARCH_HI_IDR, Math.max(currentPremium * 2, MIN_SEARCH_HI_IDR));
  let maxViable: number | null = null;

  if (isViable(atZero)) {
    while (hi < MAX_SEARCH_HI_IDR) {
      const atHi = await evalAt(hi);
      if (
        atHi.status !== "Optimal" ||
        atHi.packs_bought === 0 ||
        (atHi.net_contribution_idr !== null && withoutThisOfferNet !== null && atHi.net_contribution_idr < withoutThisOfferNet)
      ) {
        break;
      }
      hi = Math.min(MAX_SEARCH_HI_IDR, hi * 2);
    }

    let lo = 0;
    let right = hi;
    let best = 0;
    while (lo <= right) {
      const mid = Math.floor((lo + right) / 2);
      const pt = await evalAt(mid);
      if (isViable(pt)) {
        best = mid;
        lo = mid + 1;
      } else {
        right = mid - 1;
      }
    }
    maxViable = best;
  }

  const upperBound = Math.max(hi, currentPremium);
  const anchors = [0, currentPremium, upperBound, ...(maxViable !== null ? [maxViable] : [])];
  const samplePremiums = buildSamplePremiums(upperBound, anchors);
  const points: PremiumSamplePoint[] = [];
  for (const p of samplePremiums) {
    points.push(await evalAt(p));
  }

  return {
    offer_id: offerId,
    supplier_name: supplierName,
    material_name: materialName,
    current_premium_idr: currentPremium,
    max_viable_premium_idr: maxViable,
    headroom_idr: maxViable !== null ? maxViable - currentPremium : null,
    points,
  };
}

/**
 * Jalankan uji ketahanan keterlambatan pengiriman (0..5 hari) serta analisis titik impas premi
 * penawaran alternatif (binary search integer per penawaran yang layak).
 */
export async function runStressTest(
  snapshot: WorkspaceSnapshot,
  scenarios: ScenarioConfig[],
  options?: { delayScenarioId?: string; offerScenarioId?: string },
): Promise<StressTestResult> {
  const delayBase = pickDelayScenario(scenarios, options?.delayScenarioId);
  const offerBase = pickOfferScenario(scenarios, options?.offerScenarioId);

  if (!delayBase || !offerBase) {
    return {
      delay_scenario_id: "",
      offer_scenario_id: "",
      baseline_net_idr: null,
      critical_delay_days: null,
      delay_curve: [],
      no_offer_net_idr: null,
      offer_breakevens: [],
    };
  }

  const { baselineNet, criticalDelayDays, delayCurve } = await buildDelayCurve(snapshot, delayBase);

  const noOfferRes = await solveScenario(snapshot, { ...offerBase, enabled_offer_ids: [] });
  const noOfferNetIdr = noOfferRes.status === "Optimal" ? noOfferRes.net_contribution_idr : null;

  const supplierNameById = new Map(snapshot.suppliers.map((s) => [s.id, s.name]));
  const materialNameById = new Map(snapshot.materials.map((m) => [m.id, m.name]));
  const offerInputs = resolveScenarioInputs(snapshot, offerBase);
  const eligibleOffers = offerInputs.offerInfo.filter((info) => info.eligible);

  const offerBreakevens: OfferBreakeven[] = [];
  for (const info of eligibleOffers) {
    const o = info.offer;
    offerBreakevens.push(
      await solveOfferBreakeven(
        snapshot,
        offerBase,
        o.id,
        supplierNameById.get(o.supplier_id) ?? o.supplier_id,
        materialNameById.get(o.material_id) ?? o.material_id,
        o.incremental_premium_idr_per_pack,
      ),
    );
  }

  return {
    delay_scenario_id: delayBase.id,
    offer_scenario_id: offerBase.id,
    baseline_net_idr: baselineNet,
    critical_delay_days: criticalDelayDays,
    delay_curve: delayCurve,
    no_offer_net_idr: noOfferNetIdr,
    offer_breakevens: offerBreakevens,
  };
}
