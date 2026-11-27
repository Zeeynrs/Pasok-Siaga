import type { WorkspaceSnapshot } from "@/lib/domain/types";
import { formatDate, formatMoney, formatNumber, formatPercent, formatQuantity } from "@/lib/format";
import type { ComparisonResult, SimulationResult } from "@/lib/types";

const UTF8_BOM = "\uFEFF";

function cleanBusinessName(name: string): string {
  return name.replace(/\s*\(DATA SIMULASI\)\s*$/i, "").trim() || name;
}

function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(rows: (string | number | null | undefined)[][]): string {
  return UTF8_BOM + rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}

function formatProductionLines(result: SimulationResult): string[] {
  if (!result.production.length) return ["- Belum ada rencana produksi."];
  return result.production.map(
    (item) => `- ${item.name}: ${formatNumber(item.units)} / ${formatNumber(item.demand_units)} unit`,
  );
}

/**
 * Menyusun pesan teks Bahasa Indonesia yang rapi untuk WhatsApp dari hasil simulasi:
 * daftar pembelian alternatif dikelompokkan per pemasok (bila ada), atau ringkasan
 * rencana produksi dan sisa bahan bila tidak ada pembelian alternatif.
 */
export function formatWhatsAppOrderMessage(result: SimulationResult, snapshot: WorkspaceSnapshot): string {
  const businessName = cleanBusinessName(snapshot.business.name);
  const suppliers = new Map(snapshot.suppliers.map((item) => [item.id, item.name]));
  const materials = new Map(snapshot.materials.map((item) => [item.id, item]));
  const purchases = result.purchases.filter((item) => item.packs > 0);
  const lines: string[] = [];

  if (purchases.length > 0) {
    lines.push(`*Order Pemasok Alternatif — ${businessName}*`);
    lines.push(`Skenario: ${result.scenario_name}`);
    lines.push(`Batas waktu pasokan: ${formatDate(result.cutoff_date)}`);

    const grouped = new Map<string, typeof purchases>();
    for (const purchase of purchases) {
      const list = grouped.get(purchase.supplier_id) ?? [];
      list.push(purchase);
      grouped.set(purchase.supplier_id, list);
    }

    for (const [supplierId, items] of grouped) {
      lines.push("");
      lines.push(`*${suppliers.get(supplierId) ?? supplierId}*`);
      for (const item of items) {
        const material = materials.get(item.material_id);
        const qty = material
          ? formatQuantity(item.base_units, material.base_unit)
          : formatNumber(item.base_units);
        lines.push(
          `- ${material?.name ?? item.material_id}: ${formatNumber(item.packs)} pak (${qty}, biaya tambahan ${formatMoney(item.incremental_premium_idr)})`,
        );
      }
    }

    lines.push("", "*Target produksi:*", ...formatProductionLines(result));
  } else {
    lines.push(`*Ringkasan Rencana Produksi — ${businessName}*`);
    lines.push(`Skenario: ${result.scenario_name}`);
    lines.push(`Batas waktu pasokan: ${formatDate(result.cutoff_date)}`);
    lines.push("", "*Rencana produksi:*", ...formatProductionLines(result));

    if (result.material_usage.length > 0) {
      lines.push("", "*Sisa bahan:*");
      for (const item of result.material_usage) {
        lines.push(
          `- ${item.name}: terpakai ${formatQuantity(item.used_units, item.base_unit)}, sisa ${formatQuantity(item.remaining_units, item.base_unit)}`,
        );
      }
    }
  }

  if (result.kpis) {
    lines.push("", `*Estimasi kontribusi bersih:* ${formatMoney(result.kpis.net_contribution_idr)}`);
  }

  return lines.join("\n");
}

/** Membuat tautan berbagi WhatsApp (`wa.me`) dengan teks pesan terenkode URL. */
export function buildWhatsAppShareUrl(message: string): string {
  return `https://wa.me/?text=${encodeURIComponent(message)}`;
}

/** Mengekspor satu hasil simulasi beserta KPI, produksi, bahan, dan pembelian alternatif ke CSV UTF-8 BOM. */
export function simulationToCsv(result: SimulationResult, snapshot: WorkspaceSnapshot): string {
  const suppliers = new Map(snapshot.suppliers.map((item) => [item.id, item.name]));
  const materials = new Map(snapshot.materials.map((item) => [item.id, item]));

  const rows: (string | number | null | undefined)[][] = [
    ["Ringkasan Simulasi", "Nilai"],
    ["Usaha", cleanBusinessName(snapshot.business.name)],
    ["Skenario", result.scenario_name],
    ["Status Solver", result.solver_status],
    ["Batas Waktu Pasokan", formatDate(result.cutoff_date)],
  ];

  if (result.kpis) {
    rows.push(
      ["Kontribusi Kotor (IDR)", result.kpis.gross_contribution_idr],
      ["Biaya Tambahan Pasokan (IDR)", result.kpis.incremental_premium_idr],
      ["Estimasi Kontribusi Bersih (IDR)", result.kpis.net_contribution_idr],
    );
  }

  rows.push(
    [],
    ["Rencana Produksi"],
    ["Produk", "Produksi (unit)", "Permintaan (unit)", "Kurang (unit)"],
    ...result.production.map((item) => [item.name, item.units, item.demand_units, item.unmet_units]),
    [],
    ["Penggunaan Bahan"],
    ["Bahan", "Satuan", "Terpakai", "Tersedia", "Sisa", "Pembatas"],
    ...result.material_usage.map((item) => [
      item.name,
      item.base_unit,
      item.used_units,
      item.available_units,
      item.remaining_units,
      item.is_bottleneck ? "Ya" : "Tidak",
    ]),
    [],
    ["Pembelian Alternatif"],
    ["Pemasok", "Bahan", "Pak", "Jumlah", "Satuan", "Biaya Tambahan (IDR)"],
    ...result.purchases.map((item) => {
      const material = materials.get(item.material_id);
      return [
        suppliers.get(item.supplier_id) ?? item.supplier_id,
        material?.name ?? item.material_id,
        item.packs,
        item.base_units,
        material?.base_unit ?? "",
        item.incremental_premium_idr,
      ];
    }),
  );

  return toCsv(rows);
}

/** Mengekspor hasil perbandingan skenario (KPI pemulihan, kontribusi per skenario, dan selisih) ke CSV UTF-8 BOM. */
export function comparisonToCsv(outcome: ComparisonResult): string {
  const names = new Map(outcome.results.map((item) => [item.scenario_id, item.scenario_name]));

  const rows: (string | number | null | undefined)[][] = [
    ["Ringkasan Pemulihan", "Nilai"],
    ["Kontribusi Berisiko Hilang", formatMoney(outcome.contribution_at_risk_idr)],
    ["Kontribusi Dipulihkan", formatMoney(outcome.recovered_contribution_idr)],
    ["Persentase Pemulihan", formatPercent(outcome.recovery_pct)],
    [],
    ["Perbandingan Kontribusi per Skenario"],
    ["Skenario", "Status Solver", "Kontribusi Kotor", "Biaya Tambahan Pasokan", "Estimasi Kontribusi Bersih"],
    ...outcome.results.map((item) => [
      item.scenario_name,
      item.solver_status,
      formatMoney(item.kpis?.gross_contribution_idr ?? null),
      formatMoney(item.kpis?.incremental_premium_idr ?? null),
      formatMoney(item.kpis?.net_contribution_idr ?? null),
    ]),
    [],
    ["Selisih Antar Skenario"],
    ["Dari Skenario", "Ke Skenario", "Selisih", "Perubahan"],
    ...outcome.deltas.map((item) => [
      names.get(item.from_scenario_id) ?? item.from_scenario_id,
      names.get(item.to_scenario_id) ?? item.to_scenario_id,
      formatMoney(item.net_contribution_delta_idr),
      formatPercent(item.net_contribution_delta_pct),
    ]),
  ];

  return toCsv(rows);
}

/** Menyalin teks ke clipboard menggunakan Clipboard API dengan fallback `document.execCommand("copy")`. */
export async function copyText(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Lanjut ke fallback textarea jika izin Clipboard API ditolak.
    }
  }

  if (typeof document === "undefined" || !document.body) return false;
  const textarea = document.createElement("textarea");
  try {
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    return typeof document.execCommand === "function" ? document.execCommand("copy") : false;
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
}

/** Memicu unduhan berkas CSV UTF-8 di browser dan membersihkan object URL setelahnya. */
export function downloadCsv(filename: string, csvContent: string): void {
  if (typeof document === "undefined" || typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
    return;
  }
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL?.(url), 0);
  }
}
