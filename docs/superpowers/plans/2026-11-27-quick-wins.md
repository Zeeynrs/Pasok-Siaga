---
tags:
  - plan
  - quick-wins
  - microchain
project: "[[MicroChain Hub]]"
status: approved
---

# MicroChain Quick Wins Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mengimplementasikan 4 fitur Quick Wins MicroChain (Template Starter kuliner, Salin Pesan Order WhatsApp & Ekspor CSV, Perbandingan Skenario Kustom, dan Aksi Cepat dari Jaringan Pasok) secara murni di lapisan domain & klien tanpa migrasi database.

**Architecture:** Keempat fitur dibangun di atas kontrak kanonik `WorkspaceData` (`lib/domain/types.ts`) dan `ComparisonResult` (`lib/types.ts`). Template starter didefinisikan sebagai data tervalidasi di `lib/domain/templates.ts`; formatter WhatsApp/CSV diisolasi di `lib/export.ts`; perhitungan ulang perbandingan kustom memakai helper bersama di `lib/view-models.ts`; dan aksi cepat jaringan pasok memakai mutasi murni di `lib/domain/mutations.ts` serta navigasi Next.js App Router.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, Zod, `lucide-react`, `sonner`, Vitest, Testing Library (`jsdom`).

**Spec:** [[docs/superpowers/specs/2026-11-27-quick-wins-design]]

Kembali ke [[MicroChain Hub]]

## Global Constraints
- Seluruh teks UI, label aksesibilitas, dan pesan notifikasi wajib berbahasa Indonesia menggunakan format `Rp`, satuan lokal, dan tanggal `lib/format.ts`.
- Tidak ada migrasi Supabase, perubahan skema Postgres/RLS, perubahan formulasi solver `highs`, maupun Route Handler API baru.
- Kontrak `validateWorkspaceData` tetap sumber kebenaran tunggal: setiap template dan mutasi wajib menyertakan 3 skenario inti (`baseline`, `outage`, `mitigation`) dan menjaga `business.id` pada mode `workspace`.
- Pada `Dashboard` kosong (`isEmpty === true`), panel *"Mulai dari nol"* tidak boleh merender data atau nama *"Dapur Sari"* secara langsung sebelum tombol **"Pilih Template Starter"** ditekan.
- Setiap perubahan UI wajib responsif pada desktop (`1440px`) dan mobile (`390px`) dengan gaya `app/globals.css`.

## Review Focus
1. **Template ID & validasi `workspace`:** Menerapkan template pada mode `workspace` harus mempertahankan `current.snapshot.business.id`, menyetel `demo_data: false` dan `scenarios[*].source: "user"`, serta melempar error terjelas bila `templateId` tidak ditemukan (uji di Task 1).
2. **Escaping CSV & pesan WA tanpa pembelian alternatif:** `simulationToCsv` / `comparisonToCsv` harus menyertakan UTF-8 BOM `\uFEFF` dan men-*quote* teks yang mengandung koma, tanda kutip, atau baris baru; `formatWhatsAppOrderMessage` pada skenario tanpa pembelian alternatif harus menyusun ringkasan rencana produksi & kontribusi bersih tanpa bagian pembelian kosong (uji di Task 2).
3. **Skenario peran tersembunyi & pengamanan filter terakhir di `Comparison`:** Saat `visibleIds` menyembunyikan salah satu skenario peran (`baselineId`, `outageId`, `mitigationId`), `recomputeComparisonView` tetap menghitung KPI pemulihan dari `outcome.results` dan tidak pernah membolehkan `results` terfilter menjadi kosong di UI (uji di Task 3).
4. **Batas `MAX_SCENARIOS` pada aksi cepat pemasok gagal:** Ketika jumlah skenario sudah mencapai `MAX_SCENARIOS` (`10`) dan belum ada skenario gangguan khusus pemasok tersebut, `prepareSupplierOutageScenario` harus memperbarui skenario `outage` (`fallbackUpdated: true`) tanpa melampaui batas `MAX_SCENARIOS` atau menghapus skenario inti (uji di Task 4).
5. **Konfirmasi timpa data & fokus query URL aman:** Menerapkan template di `DataEditor` saat workspace sudah berisi data wajib memunculkan `role="alertdialog"` sebelum menimpa; membuka `/data?focus=offers` di lingkungan tanpa `scrollIntoView` (seperti `jsdom`) tidak boleh melempar error runtime (uji di Task 1 & Task 4).

---

### Task 1: Template Starter Sektor Kuliner (`lib/domain/templates.ts`, `Dashboard`, `DataEditor`)

**Files:**
- Create: `lib/domain/templates.ts`
- Create: `features/dashboard/template-picker.tsx`
- Modify: `features/dashboard/dashboard.tsx:1-45`
- Modify: `features/data-editor/data-editor.tsx:1-65`
- Create: `tests/domain/templates.test.ts`
- Create: `tests/ui/quick-wins.test.tsx`

**Interfaces:**
- Produces in `lib/domain/templates.ts`:
  - `export interface StarterTemplate { id: string; name: string; sector: string; tagline: string; highlight: string; data: WorkspaceData }`
  - `export const STARTER_TEMPLATES: readonly StarterTemplate[]` (berisi `dapur_sari`, `kedai_kopi`, `dimsum_beku`, `martabak_kue`)
  - `export function applyStarterTemplate(current: WorkspaceData, templateId: string, mode: "demo" | "workspace"): WorkspaceData`
- Produces in `features/dashboard/template-picker.tsx`:
  - `export function TemplatePicker({ onSelect, title }: { onSelect: (template: StarterTemplate) => void; title?: string })`

- [ ] **Step 1: Write the failing tests for `STARTER_TEMPLATES` and `applyStarterTemplate`**

```typescript
// tests/domain/templates.test.ts
import { describe, expect, it } from "vitest";
import { EMPTY_WORKSPACE_FIXTURE } from "@/lib/domain/fixture";
import { STARTER_TEMPLATES, applyStarterTemplate } from "@/lib/domain/templates";
import { validateWorkspaceData } from "@/lib/domain/validation";
import { compareScenarios } from "@/lib/solver/compare";

describe("STARTER_TEMPLATES", () => {
  it("provides 4 valid culinary templates that solve cleanly with positive recovery", async () => {
    expect(STARTER_TEMPLATES.map((t) => t.id)).toEqual([
      "dapur_sari",
      "kedai_kopi",
      "dimsum_beku",
      "martabak_kue",
    ]);
    for (const tpl of STARTER_TEMPLATES) {
      const valid = validateWorkspaceData(tpl.data);
      const { comparison } = await compareScenarios(valid.snapshot, valid.scenarios);
      expect(comparison.loss_idr).toBeGreaterThan(0);
      expect(comparison.recovered_idr).toBeGreaterThan(0);
    }
  });

  it("preserves workspace business id and sets user source in workspace mode", () => {
    const next = applyStarterTemplate(EMPTY_WORKSPACE_FIXTURE, "kedai_kopi", "workspace");
    expect(next.snapshot.business.id).toBe("usaha");
    expect(next.snapshot.demo_data).toBe(false);
    expect(next.scenarios.every((s) => s.source === "user")).toBe(true);
    expect(next.snapshot.suppliers.length).toBeGreaterThanOrEqual(2);
  });

  it("throws an explicit error for an unknown template id", () => {
    expect(() => applyStarterTemplate(EMPTY_WORKSPACE_FIXTURE, "tidak_ada", "workspace")).toThrow(/Template/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/domain/templates.test.ts`
Expected: FAIL because `@/lib/domain/templates` does not exist yet.

- [ ] **Step 3: Implement `lib/domain/templates.ts`**

Buat 4 template kuliner (`dapur_sari` memakai `DAPUR_SARI_FALLBACK_FIXTURE` dengan judul kartu `"Toko Roti & Kue (Dapur Sari)"`, `kedai_kopi`, `dimsum_beku`, `martabak_kue`) dan `applyStarterTemplate(current, templateId, mode)` yang mengkloning data template, mempertahankan `current.snapshot.business.id`, mengatur `demo_data: mode === "demo"` dan `source: mode === "demo" ? "demo" : "user"`, lalu mengembalikan hasil `validateWorkspaceData(...)`.

- [ ] **Step 4: Run domain template test to verify it passes**

Run: `npx vitest run tests/domain/templates.test.ts`
Expected: PASS.

- [ ] **Step 5: Write failing UI tests for Dashboard template toggle & DataEditor overwrite confirmation**

Tambahkan di `tests/ui/quick-wins.test.tsx` test yang memverifikasi:
1. Pada `workspace` kosong di `Dashboard`, tombol **"Pilih Template Starter"** tersedia, `"Dapur Sari"` belum muncul sebelum tombol ditekan, lalu setelah menekan **"Pilih Template Starter"** dan memilih **"Kedai Kopi Susu"**, `Dashboard` langsung menampilkan bahan & produk kedai kopi dan tombol **Simpan ke Workspace** aktif.
2. Pada `DataEditor` yang sudah memiliki data (mode `demo`), memilih template memunculkan `role="alertdialog"` konfirmasi sebelum menimpa data, dan menekan konfirmasi **"Ya, Terapkan Template"** mengganti data serta memperbarui form input.

- [ ] **Step 6: Run UI test to verify it fails**

Run: `npx vitest run tests/ui/quick-wins.test.tsx`
Expected: FAIL because `TemplatePicker` and template buttons are not wired yet.

- [ ] **Step 7: Create `features/dashboard/template-picker.tsx` and update `features/dashboard/dashboard.tsx` & `features/data-editor/data-editor.tsx`**

- `TemplatePicker` merender grid kartu `STARTER_TEMPLATES` dengan tombol **"Pakai Template"** (`aria-label={`Pakai template ${tpl.name}`}`).
- `Dashboard` (`isEmpty === true`): tambahkan tombol **"Pilih Template Starter"** di `.start-panel` yang men-toggle state `showTemplates` untuk merender `<TemplatePicker />`. Saat template dipilih, panggil `setData(applyStarterTemplate(data, tpl.id, mode))`, tutup picker, dan panggil `notify.success(...)`.
- `DataEditor`: dukung `?panel=templates` (bungkus pembaca `useSearchParams()` dalam `<Suspense fallback={null}>` agar prerender `next build` aman), tambahkan panel/aksi **"Template Starter"** yang menampilkan `<TemplatePicker />`. Jika `!isEmpty` (`suppliers/materials/products > 0`), simpan `pendingTemplate` di state dan minta konfirmasi via `role="alertdialog"` (**"Batal"** / **"Ya, Terapkan Template"**); setelah diterapkan, naikkan `resetVersion` dan panggil `notify.success(...)`.

- [ ] **Step 8: Run template & existing workspace tests to verify everything passes**

Run: `npx vitest run tests/domain/templates.test.ts tests/ui/quick-wins.test.tsx tests/ui/workspace.test.tsx`
Expected: PASS (termasuk test regresi `Workspace kosong untuk pengguna baru`).

- [ ] **Step 9: Commit**

```bash
git add lib/domain/templates.ts features/dashboard/template-picker.tsx features/dashboard/dashboard.tsx features/data-editor/data-editor.tsx tests/domain/templates.test.ts tests/ui/quick-wins.test.tsx
git commit -m "feat: add culinary starter templates for empty and existing workspaces"
```

---

### Task 2: Salin Pesan Order WhatsApp & Ekspor CSV (`lib/export.ts`, `SimulationResults`, `Comparison`)

**Files:**
- Create: `lib/export.ts`
- Modify: `features/simulation/results.tsx:1-71`
- Modify: `features/simulation/comparison.tsx:50-73`
- Create: `tests/lib/export.test.ts`
- Modify: `tests/ui/quick-wins.test.tsx`

**Interfaces:**
- Produces in `lib/export.ts`:
  - `export function formatWhatsAppOrderMessage(result: SimulationResult, snapshot: WorkspaceSnapshot): string`
  - `export function buildWhatsAppShareUrl(message: string): string`
  - `export function simulationToCsv(result: SimulationResult, snapshot: WorkspaceSnapshot): string`
  - `export function comparisonToCsv(outcome: ComparisonResult): string`
  - `export async function copyText(text: string): Promise<boolean>`
  - `export function downloadCsv(filename: string, csvContent: string): void`

- [ ] **Step 1: Write the failing unit tests for `lib/export.ts`**

```typescript
// tests/lib/export.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/export.test.ts`
Expected: FAIL because `@/lib/export` does not exist.

- [ ] **Step 3: Implement `lib/export.ts`**

Implementasikan helper murni pembuat pesan WA, URL `wa.me`, CSV RFC-4180 ber-BOM `\uFEFF`, `copyText` (memakai `navigator.clipboard?.writeText` dengan fallback `document.execCommand("copy")` aman), dan `downloadCsv` (membuat `Blob` `text/csv;charset=utf-8` + `URL.createObjectURL` dengan revoke aman).

- [ ] **Step 4: Run `tests/lib/export.test.ts` to verify it passes**

Run: `npx vitest run tests/lib/export.test.ts`
Expected: PASS.

- [ ] **Step 5: Write failing UI tests for export buttons in `SimulationResults` and `Comparison`**

Tambahkan di `tests/ui/quick-wins.test.tsx`:
- Di `Simulator`, setelah menjalankan skenario `Mitigasi: Pemasok Alternatif Aktif`, tombol **"Salin Pesan Order (WA)"**, tautan **"Buka WhatsApp"**, dan tombol **"Unduh CSV"** tampil; klik salin memanggil clipboard dengan teks berisi `"Pemasok B"` dan memicu `notify.success`.
- Di `Simulator` skenario `Normal`, label tombol adalah **"Salin Ringkasan"** dan tautan **"Buka WhatsApp"** tidak muncul.
- Di `Comparison`, tombol **"Unduh CSV"** tersedia dan memicu unduhan CSV.

- [ ] **Step 6: Run UI test to verify it fails**

Run: `npx vitest run tests/ui/quick-wins.test.tsx`
Expected: FAIL because export controls are not rendered in `SimulationResults` or `Comparison`.

- [ ] **Step 7: Wire export actions into `features/simulation/results.tsx` and `features/simulation/comparison.tsx`**

- Di `SimulationResults`: tambahkan `"use client"` (dibutuhkan untuk handler klik clipboard/download), tombol **"Salin Pesan Order (WA)"** / **"Salin Ringkasan"**, tautan `<a href={buildWhatsAppShareUrl(waMessage)} target="_blank" rel="noopener noreferrer">` **"Buka WhatsApp"** saat `result.purchases.length > 0`, dan tombol **"Unduh CSV"** saat `kpis !== null`.
- Di `Comparison` (header halaman atau panel perbandingan saat `fresh`): tambahkan tombol **"Unduh CSV"** yang mengekspor hasil `displayedOutcome` (di Task 3 nanti terhubung ke hasil kustomisasi aktif; sementara pakai `comparison.view`).

- [ ] **Step 8: Run tests to verify they pass**

Run: `npx vitest run tests/lib/export.test.ts tests/ui/quick-wins.test.tsx tests/ui/workspace.test.tsx`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add lib/export.ts features/simulation/results.tsx features/simulation/comparison.tsx tests/lib/export.test.ts tests/ui/quick-wins.test.tsx
git commit -m "feat: add WhatsApp order copy and CSV export for simulation results"
```

---

### Task 3: Perbandingan Antar Skenario Kustom (`lib/view-models.ts`, `Comparison`)

**Files:**
- Modify: `lib/view-models.ts:232-281`
- Modify: `features/simulation/comparison.tsx:16-73`
- Modify: `tests/lib/view-models.test.ts`
- Modify: `tests/ui/quick-wins.test.tsx`

**Interfaces:**
- Produces in `lib/view-models.ts`:
  - `export interface ComparisonRoles { baselineId: string; outageId: string; mitigationId: string }`
  - `export function recomputeComparisonView(outcome: ComparisonResult, roles: ComparisonRoles, visibleIds?: string[]): ComparisonResult`
- Consumes in `features/simulation/comparison.tsx`:
  - `recomputeComparisonView` from `@/lib/view-models`
  - `comparisonToCsv`, `downloadCsv` from `@/lib/export`

- [ ] **Step 1: Write the failing tests for `recomputeComparisonView` in `tests/lib/view-models.test.ts`**

Tambahkan `describe("recomputeComparisonView", ...)` di `tests/lib/view-models.test.ts`:
1. Saat peran default (`baseline`, `outage`, `mitigation`) dan `visibleIds` tidak diisi / berisi semua ID, output identik dengan `toComparisonView`.
2. Saat menambahkan skenario kustom ke-4 (mis. `mitigasi_2` dengan kontribusi lebih tinggi) dan memilihnya sebagai `mitigationId`, `recovered_contribution_idr` dan `recovery_pct` dihitung ulang memakai skenario kustom tersebut.
3. Saat `visibleIds` menyembunyikan `outage` (hanya `["baseline", "mitigasi_2"]`), KPI pemulihan tetap dihitung dari `outcome.results` berdasarkan `roles`, sementara `results` hanya berisi 2 skenario dan `deltas` berisi 1 selisih berurutan (`baseline -> mitigasi_2`).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/view-models.test.ts`
Expected: FAIL because `recomputeComparisonView` is not exported.

- [ ] **Step 3: Implement `recomputeComparisonView` (sharing KPI/delta helper with `toComparisonView`) in `lib/view-models.ts`**

Ekstrak fungsi pembantu lokal `summarizeComparison(allViews, visibleViews, roles)` sehingga `toComparisonView` dan `recomputeComparisonView` memakai logika perhitungan KPI pemulihan, `deltas` berurutan atas `visibleViews`, dan `warnings` yang sama persis tanpa duplikasi.

- [ ] **Step 4: Run `tests/lib/view-models.test.ts` to verify it passes**

Run: `npx vitest run tests/lib/view-models.test.ts`
Expected: PASS.

- [ ] **Step 5: Write failing UI tests for role selectors & scenario visibility filter in `Comparison`**

Tambahkan di `tests/ui/quick-wins.test.tsx`:
- Membuat skenario kustom di `Simulator` (mis. aktifkan penawaran + ubah parameter atau biarkan sebagai salinan), lalu masuk ke `Comparison`:
  - Tersedia kontrol **"Atur Pembanding"** dengan 3 dropdown (**Acuan Normal**, **Skenario Gangguan**, **Skenario Mitigasi**) dan checkbox filter per skenario.
  - Mengubah **Skenario Mitigasi** ke skenario kustom langsung memperbarui KPI tanpa memanggil ulang `/api/simulate/compare`.
  - Menonaktifkan checkbox skenario di filter menghapusnya dari tabel/grafik, dan checkbox terakhir yang aktif berstatus `disabled` agar tampilan tidak pernah kosong.
  - Menekan **"Unduh CSV"** mengekspor tampilan terfilter.

- [ ] **Step 6: Run UI test to verify it fails**

Run: `npx vitest run tests/ui/quick-wins.test.tsx`
Expected: FAIL because role selectors & scenario filters are not rendered in `Comparison`.

- [ ] **Step 7: Implement custom scenario controls in `features/simulation/comparison.tsx`**

- Simpan state lokal `roles` (default `{ baselineId: "baseline", outageId: "outage", mitigationId: "mitigation" }`) dan `hiddenIds` (`Set<string>` atau array ID yang disembunyikan, sehingga skenario baru yang ditambahkan pengguna otomatis terlihat!).
- Sanitasi ID terpilih dengan fallback aman ke ID yang masih ada di `outcome.results`.
- Hitung `displayed = useMemo(() => recomputeComparisonView(comparison.view, effectiveRoles, visibleIds), ...)`.
- Render panel kontrol **"Atur Pembanding"** (`<select>` untuk 3 peran + checkbox filter per skenario di `comparison.view.results` dengan `disabled={isLastVisible}` saat hanya 1 skenario aktif), serta hubungkan tombol **"Unduh CSV"** ke `displayed`.

- [ ] **Step 8: Run tests to verify they pass**

Run: `npx vitest run tests/lib/view-models.test.ts tests/ui/quick-wins.test.tsx tests/ui/workspace.test.tsx`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add lib/view-models.ts features/simulation/comparison.tsx tests/lib/view-models.test.ts tests/ui/quick-wins.test.tsx
git commit -m "feat: allow selecting custom scenarios and filters in comparison view"
```

---

### Task 4: Aksi Cepat dari Jaringan Pasok (`lib/domain/mutations.ts`, `SupplyNetwork`, `StructureEditor`)

**Files:**
- Modify: `lib/domain/mutations.ts:170-194`
- Modify: `features/network/supply-network.tsx:29-103`
- Modify: `features/data-editor/structure-editor.tsx:34-56,190-235`
- Modify: `tests/domain/mutations.test.ts`
- Modify: `tests/ui/quick-wins.test.tsx`

**Interfaces:**
- Produces in `lib/domain/mutations.ts`:
  - `export interface OutageScenarioPrep { data: WorkspaceData; scenarioId: string; created: boolean; fallbackUpdated: boolean }`
  - `export function prepareSupplierOutageScenario(data: WorkspaceData, supplierId: string): OutageScenarioPrep`

- [ ] **Step 1: Write the failing tests for `prepareSupplierOutageScenario` in `tests/domain/mutations.test.ts`**

Tambahkan test di `tests/domain/mutations.test.ts`:
1. Jika belum ada skenario gangguan khusus pemasok tersebut dan jumlah skenario `< MAX_SCENARIOS`, membuat skenario baru berbasis `baseline` dengan `disabled_supplier_ids: [supplierId]`, `enabled_offer_ids: []`, `name: "Uji Gagal: Pemasok B"`.
2. Jika skenario gangguan untuk pemasok tersebut sudah ada (`disabled_supplier_ids` sama persis `[supplierId]` dan `enabled_offer_ids` kosong, bukan `baseline`), mengembalikan ID skenario yang sudah ada (`created: false`).
3. Jika jumlah skenario sudah `MAX_SCENARIOS` (`10`) dan belum ada skenario cocok, memperbarui skenario `outage` (`fallbackUpdated: true`, `scenarioId: "outage"`, `disabled_supplier_ids: [supplierId]`) tanpa melampaui `MAX_SCENARIOS`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/domain/mutations.test.ts`
Expected: FAIL because `prepareSupplierOutageScenario` does not exist.

- [ ] **Step 3: Implement `prepareSupplierOutageScenario` in `lib/domain/mutations.ts`**

Implementasikan pencarian skenario non-baseline yang cocok, pembuatan skenario baru bila `< MAX_SCENARIOS`, dan fallback pembaruan skenario `outage` saat batas tercapai; hasil akhir tetap valid untuk `validateWorkspaceData`.

- [ ] **Step 4: Run `tests/domain/mutations.test.ts` to verify it passes**

Run: `npx vitest run tests/domain/mutations.test.ts`
Expected: PASS.

- [ ] **Step 5: Write failing UI tests for `SupplyNetwork` quick actions & `StructureEditor` focus**

Tambahkan di `tests/ui/quick-wins.test.tsx`:
1. Di `SupplyNetwork`, klik node pemasok **"Pemasok B"** menampilkan tombol **"Uji jika pemasok ini gagal"**; mengkliknya membuat/memilih skenario gangguan untuk `supplier_b`, memanggil `router.push("/simulator")`.
2. Klik node bahan **"Tepung terigu"** menampilkan **"Tambah pemasok cadangan"** dan **"Buka Simulator"**; klik **"Tambah pemasok cadangan"** memanggil `router.push("/data?focus=offers")`.
3. Klik node produk **"Roti"** menampilkan **"Simulasikan produksi"** -> `router.push("/simulator")`.
4. Ketika `useSearchParams()` mengembalikan `focus=offers`, panel **Penawaran alternatif** di `StructureEditor` terbuka (walau di viewport mobile default tertutup) tanpa error bila `scrollIntoView` tidak tersedia.

- [ ] **Step 6: Run UI test to verify it fails**

Run: `npx vitest run tests/ui/quick-wins.test.tsx`
Expected: FAIL because quick action buttons and `focus=offers` handling do not exist yet.

- [ ] **Step 7: Update `features/network/supply-network.tsx` and `features/data-editor/structure-editor.tsx`**

- Di `SupplyNetwork`: gunakan `useRouter()` dan `useWorkspace()` (`data`, `setData`, `selectScenario`, `href`). Teruskan callback aksi ke `NetworkDetail` untuk merender tombol kontekstual sesuai `node.kind` (`supplier`, `material`, `product`).
- Di `StructureEditor`: baca `?focus=offers` (bungkus pembaca `useSearchParams()` dalam `<Suspense fallback={null}>` agar prerender `next build` aman), teruskan kondisi terbuka ke panel **Penawaran alternatif** (`open` terkendali saat `focusOffers` aktif), dan jalankan `useEffect` opsional `offersRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" })` saat `focusOffers` true.

- [ ] **Step 8: Run tests to verify they pass**

Run: `npx vitest run tests/domain/mutations.test.ts tests/ui/quick-wins.test.tsx tests/ui/workspace.test.tsx`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add lib/domain/mutations.ts features/network/supply-network.tsx features/data-editor/structure-editor.tsx tests/domain/mutations.test.ts tests/ui/quick-wins.test.tsx
git commit -m "feat: add quick actions from supply network detail to simulator and data editor"
```

---

### Task 5: Gaya Responsif (`app/globals.css`) & Verifikasi Penuh

**Files:**
- Modify: `app/globals.css` (bagian akhir gaya workspace & media query mobile)

- [ ] **Step 1: Tambahkan CSS untuk komponen baru di `app/globals.css`**

Tambahkan kelas bergaya selaras palet MicroChain (`--surface`, `--canvas`, `--rule`, `--mint`, `--deep`, `--green`) dengan media query `max-width: 680px`:
- `.template-grid` (grid 2 kolom di desktop, 1 kolom di mobile), `.template-card` (kartu template dengan sektor, ringkasan singkat, tombol aksi).
- `.results-actions` (baris tombol salin WA, tautan WA, unduh CSV pada hasil simulasi; full-width stack rapi di mobile).
- `.comparison-controls`, `.comparison-roles`, `.comparison-filter-chips`, `.filter-chip` (kontrol pemilih peran & chip skenario yang rapi di desktop maupun layar `390px`).
- `.detail-actions` (tombol aksi cepat di bawah hubungan node pada `NetworkDetail`).

- [ ] **Step 2: Jalankan verifikasi penuh (`test`, `typecheck`, `lint`, `build`)**

Run: `npm test && npm run typecheck && npm run lint && npm run build`
Expected: Seluruh suite Vitest lulus tanpa skip/failure, `tsc --noEmit` keluar `0`, `eslint` bersih tanpa error, dan `next build` berhasil.

- [ ] **Step 3: Commit**

```bash
git add app/globals.css
git commit -m "style: add responsive styles for quick-wins templates, exports, comparison controls, and network actions"
```
