/**
 * Tipe tampilan (view model) yang dipakai komponen UI. Bentuknya mengikuti kebutuhan layar;
 * model domain kanonik ada di `lib/domain/types.ts` dan diubah ke sini oleh `lib/view-models.ts`.
 */
export type BaseUnit = "g" | "ml" | "pcs";

export type SolverStatus = "OPTIMAL" | "FEASIBLE" | "INFEASIBLE" | "UNKNOWN" | "MODEL_INVALID" | "ERROR";

export interface SimulationResult {
  scenario_id: string;
  scenario_name: string;
  solver_status: SolverStatus;
  cutoff_date: string;
  production: { product_id: string; name: string; units: number; demand_units: number; unmet_units: number }[];
  purchases: {
    offer_id: string;
    supplier_id: string;
    material_id: string;
    packs: number;
    base_units: number;
    incremental_premium_idr: number;
  }[];
  material_usage: {
    material_id: string;
    name: string;
    base_unit: BaseUnit;
    available_units: number;
    used_units: number;
    remaining_units: number;
    is_bottleneck: boolean;
  }[];
  kpis: { gross_contribution_idr: number; incremental_premium_idr: number; net_contribution_idr: number } | null;
  explanations: string[];
  warnings: string[];
}

export interface ComparisonResult {
  results: SimulationResult[];
  deltas: {
    from_scenario_id: string;
    to_scenario_id: string;
    net_contribution_delta_idr: number | null;
    net_contribution_delta_pct: number | null;
  }[];
  contribution_at_risk_idr: number | null;
  recovered_contribution_idr: number | null;
  recovery_pct: number | null;
  warnings: string[];
}

export type NetworkKind = "supplier" | "material" | "product";

export interface NetworkOverlay {
  badge: string;
  metric: string;
  tone: "good" | "warning" | "bad" | "neutral";
}

export interface NetworkNode {
  id: string;
  entity_id: string;
  label: string;
  kind: NetworkKind;
  status: "active" | "inactive" | "single_source" | "stock_only" | "ready";
  detail: string;
  overlay?: NetworkOverlay;
}

export interface NetworkEdge {
  id: string;
  source: string;
  target: string;
  kind: "committed" | "alternative" | "bom";
  active: boolean;
  overlayLabel?: string;
  used?: boolean;
}

export interface NetworkResult {
  nodes: NetworkNode[];
  edges: NetworkEdge[];
  single_source_risks: { material_id: string; supplier_id: string; product_ids: string[] }[];
  warnings: string[];
}

export interface ResilienceScore {
  score: number;
  grade: "Tangguh" | "Cukup Siap" | "Rentan";
  tone: "good" | "warning" | "bad";
  structural_pct: number;
  outage_retention_pct: number | null;
  mitigation_score_pct: number | null;
  summary: string;
}
