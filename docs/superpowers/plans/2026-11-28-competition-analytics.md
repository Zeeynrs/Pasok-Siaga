---
tags:
  - plan
  - analytics
  - competition
  - microchain
project: "[[MicroChain Hub]]"
status: approved
---

# MicroChain Competition Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Membangun 3 fitur analitik unggulan lomba MicroChain: Auto Stress-Test & Grafik Titik Impas (*Breakeven*), Overlay Hasil Optimasi langsung di Peta Jaringan Pasok, dan Skor Ketahanan Pasokan (0–100) di Dashboard.

**Architecture:** `lib/solver/stress-test.ts` menjalankan rangkaian `solveScenario` secara deterministik di server Next.js melalui endpoint `POST /api/simulate/stress-test` (dipicu *on-demand* dari panel baru di `/comparison`). Overlay Jaringan Pasok dan Skor Ketahanan Pasokan memanfaatkan cache `compareAll` pada `WorkspaceProvider` melalui fungsi murni di `lib/view-models.ts` (`analyzeNetwork(..., simulation)` dan `computeResilienceScore`).

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, HiGHS WASM (`highs`), Recharts 3, `@xyflow/react` 12, Zod, Vitest, Testing Library (`jsdom`).

**Spec:** [[docs/superpowers/specs/2026-11-28-competition-analytics-design]]

Kembali ke [[MicroChain Hub]]

## Global Constraints
- Seluruh teks UI, label aksesibilitas, pesan galat API, dan toast wajib berbahasa Indonesia memakai pemformatan `lib/format.ts`.
- Tidak ada migrasi Postgres/Supabase, perubahan RPC/RLS, maupun perubahan formulasi matematis `solveScenario` di `lib/solver/milp-solver.ts`.
- Endpoint `/api/simulate/stress-test` wajib memakai `readJson`, `validateWorkspaceData`, dan `handleError` agar paritas error handling (400/413/500 Bahasa Indonesia) konsisten dengan `/api/simulate/compare`.
- `analyzeNetwork(snapshot, scenario)` tanpa parameter ke-3 `simulation` (atau ketika `simulation.kpis === null`) harus mengembalikan struktur identik seperti sebelumnya agar seluruh test eksisting tetap utuh.
- `Dashboard` saat workspace kosong (`isEmpty === true`) tidak boleh memanggil `runComparison()` maupun menampilkan kartu Skor Ketahanan Pasokan atau teks `"Dapur Sari"`.
- `Comparison` tidak boleh menjalankan `/api/simulate/stress-test` secara otomatis saat mount (harus dipicu tombol **"Jalankan Stress-Test Otomatis"**) agar muatan awal cepat dan test eksisting tetap stabil.
- Seluruh tampilan baru wajib responsif pada desktop (`1440px`) dan mobile (`390px`) lewat kelas CSS di `app/globals.css`.

## Review Focus
1. **Titik impas saat penawaran gratis pun tidak menguntungkan atau tanpa pengiriman aktif:** Jika penawaran alternatif tidak dibeli bahkan pada premi `0` (atau tidak ada pengiriman aktif / penawaran eligible), `runStressTest` harus mengembalikan `max_viable_premium_idr: null` / `critical_delay_days: null` tanpa *infinite loop* atau error solver (uji di Task 1).
2. **Validasi ID skenario opsional & payload tak valid di `/api/simulate/stress-test`:** Payload rusak, stok negatif, atau `delayScenarioId` yang tidak ada harus ditangani aman (400 untuk payload tidak valid; fallback deterministik atau 400 sesuai kontrak) tanpa membocorkan stack trace (uji di Task 1).
3. **Pembagian nol & komponen fallback pada `computeResilienceScore`:** Saat `comparison` belum tersedia, `baseline_net_idr <= 0`, atau `bom` kosong, `computeResilienceScore` tidak boleh menghasilkan `NaN`/`Infinity` dan wajib mengembalikan `score` di rentang `0..100` (uji di Task 2).
4. **Status basi (*stale*) pada `StressTestPanel` & pembatalan request:** Jika data/skenario berubah setelah stress-test dijalankan, hasil stress-test lama wajib ditandai basi dengan banner peringatan; saat unmount atau klik ulang, request lama di-abort bersih (uji di Task 3).
5. **Satu kali fetch `compareAll` & isolasi workspace kosong di `Dashboard` dan `SupplyNetwork`:** `Dashboard` dan `SupplyNetwork` wajib memakai ref guard `attempted` per `signature` agar error API tidak memicu loop request tanpa henti, dan melewati `runComparison()` sepenuhnya saat `isEmpty === true` (uji di Task 4).

---

### Task 1: Server Stress-Test & Breakeven Solver + API Route

**Files:**
- Create: `lib/solver/stress-test.ts`
- Create: `app/api/simulate/stress-test/route.ts`
- Modify: `lib/api.ts:1-56`
- Create: `tests/solver/stress-test.test.ts`
- Modify: `tests/api/routes.test.ts:80-105`

**Interfaces:**
- Produces in `lib/solver/stress-test.ts`:
  - `export interface DelayStressPoint { delay_days: number; net_contribution_idr: number | null; status: ScenarioResult["status"]; unmet_units: number }`
  - `export interface PremiumSamplePoint { premium_idr: number; net_contribution_idr: number | null; packs_bought: number; status: ScenarioResult["status"] }`
  - `export interface OfferBreakeven { offer_id: string; supplier_name: string; material_name: string; current_premium_idr: number; max_viable_premium_idr: number | null; headroom_idr: number | null; points: PremiumSamplePoint[] }`
  - `export interface StressTestResult { delay_scenario_id: string; offer_scenario_id: string; baseline_net_idr: number | null; critical_delay_days: number | null; delay_curve: DelayStressPoint[]; no_offer_net_idr: number | null; offer_breakevens: OfferBreakeven[] }`
  - `export async function runStressTest(snapshot: WorkspaceSnapshot, scenarios: ScenarioConfig[], options?: { delayScenarioId?: string; offerScenarioId?: string }): Promise<StressTestResult>`
- Produces in `lib/api.ts`:
  - `export async function runStressTestPreview(data: WorkspaceData, options?: { delayScenarioId?: string; offerScenarioId?: string }, signal?: AbortSignal): Promise<StressTestResult>`

- [ ] **Step 1: Write the failing unit tests for `runStressTest` in `tests/solver/stress-test.test.ts`**

Uji:
1. Untuk fixture Dapur Sari, `delay_curve` berisi 6 titik (`delay_days` `0..5`), `baseline_net_idr` = `450_000`, `critical_delay_days` = `2` (karena `arrival_date` `2026-11-23` + `1` hari = `2026-11-24 <= cutoff`, sedangkan `+2` hari = `2026-11-25 > cutoff` sehingga kontribusi turun ke `210_000`!).
2. Untuk `offer_breakevens` Dapur Sari (`supplier_b_flour_offer`), `no_offer_net_idr` = `210_000`, `current_premium_idr` = `1_000`, `max_viable_premium_idr` = `11_999` (karena 1 pak 1.000 g menghasilkan 4 Roti = Rp 12.000 kotor, jadi premi `11_999` memberi net > `210_000` sedangkan `12_000` tidak lagi menguntungkan), `headroom_idr` = `10_999`, dan `points` terurut menaik dengan titik awal `packs_bought > 0` hingga titik `packs_bought === 0`.
3. Saat tidak ada penawaran layak atau stok sudah cukup sehingga penawaran tidak dibeli bahkan pada premi `0`, `max_viable_premium_idr` = `null` dan `headroom_idr` = `null` (tanpa loop tak terbatas).
4. Saat tidak ada pengiriman aktif (`committed_deliveries = []`), `critical_delay_days` = `null` dan semua titik `delay_curve` tetap aman.

- [ ] **Step 2: Run unit test to verify it fails**

Run: `npx vitest run tests/solver/stress-test.test.ts`
Expected: FAIL because `@/lib/solver/stress-test` does not exist.

- [ ] **Step 3: Implement `lib/solver/stress-test.ts`**

Implementasikan `runStressTest`:
- Pilih `delayBase` (`options?.delayScenarioId` -> `"baseline"` -> `scenarios[0]`), ambil pengiriman aktif (`counted === true`) dari `resolveScenarioInputs(snapshot, delayBase)`, lalu uji `delay_days` tambahan `0..5`.
- Pilih `offerBase` (`options?.offerScenarioId` -> `"mitigation"` -> skenario pertama dengan `enabled_offer_ids.length > 0` -> `scenarios[0]`), hitung `no_offer_net_idr` dengan `enabled_offer_ids: []`, lalu untuk setiap penawaran `eligible`:
  - Hitung `withoutThisOfferNet` (dengan `enabled_offer_ids` tanpa `o.id`).
  - Cari batas atas `hi` mulai `Math.max(o.incremental_premium_idr_per_pack * 2, 10_000)` (gandakan sampai `packs_bought === 0 || net <= withoutThisOfferNet`, maksimal `10_000_000`).
  - Binary search integer di `[0, hi]` untuk mencari `max_viable_premium_idr` terbesar dengan `packs_bought > 0 && net > withoutThisOfferNet` (dan jika pada `0` pun tidak memenuhi, `max_viable_premium_idr = null`).
  - Bangun 6 titik sampel unik terurut dari `0` hingga `hi` (menyertakan `current_premium_idr` dan `max_viable_premium_idr` bila valid).

- [ ] **Step 4: Run `tests/solver/stress-test.test.ts` to verify it passes**

Run: `npx vitest run tests/solver/stress-test.test.ts`
Expected: PASS.

- [ ] **Step 5: Write failing API route tests and implement `app/api/simulate/stress-test/route.ts` + `lib/api.ts`**

Tambahkan `describe("POST /api/simulate/stress-test", ...)` di `tests/api/routes.test.ts`:
- Mengembalikan `200` dengan `stress_test` (`max_viable_premium_idr === 11_999`, `critical_delay_days === 2`) dan `inputs_signature`.
- Mengembalikan `400` berbahasa Indonesia untuk JSON rusak, payload tidak lengkap, atau stok negatif.
- Mengembalikan `413` untuk body melebihi batas ukuran.
Implementasikan `app/api/simulate/stress-test/route.ts` (memakai `readJson`, `validateWorkspaceData`, `runStressTest`, `computeInputsSignature`, `handleError`) dan tambahkan `runStressTestPreview` di `lib/api.ts`.

- [ ] **Step 6: Run solver & route tests to verify they pass**

Run: `npx vitest run tests/solver/stress-test.test.ts tests/api/routes.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/solver/stress-test.ts app/api/simulate/stress-test/route.ts lib/api.ts tests/solver/stress-test.test.ts tests/api/routes.test.ts
git commit -m "feat: add server stress-test and breakeven solver endpoint"
```

---

### Task 2: Overlay View Model & Skor Ketahanan Pasokan (`lib/types.ts`, `lib/view-models.ts`)

**Files:**
- Modify: `lib/types.ts:50-80`
- Modify: `lib/view-models.ts:55-155,260-360`
- Modify: `tests/lib/view-models.test.ts`

**Interfaces:**
- Produces in `lib/types.ts`:
  - `export interface NetworkOverlay { badge: string; metric: string; tone: "good" | "warning" | "bad" | "neutral" }`
  - `NetworkNode.overlay?: NetworkOverlay`
  - `NetworkEdge.overlayLabel?: string; NetworkEdge.used?: boolean`
  - `export interface ResilienceScore { score: number; grade: "Tangguh" | "Cukup Siap" | "Rentan"; tone: "good" | "warning" | "bad"; structural_pct: number; outage_retention_pct: number | null; mitigation_score_pct: number | null; summary: string }`
- Produces in `lib/view-models.ts`:
  - `export function analyzeNetwork(snapshot: WorkspaceSnapshot, scenario: ScenarioConfig, simulation?: SimulationResult | null): NetworkResult`
  - `export function computeResilienceScore(snapshot: WorkspaceSnapshot, network: NetworkResult, comparison?: ComparisonResult | null): ResilienceScore`

- [ ] **Step 1: Write failing tests in `tests/lib/view-models.test.ts`**

Tambahkan pengujian untuk:
1. `analyzeNetwork(snapshot, mitigation, mitigationSim)` mengisi `overlay` pada produk (`"68/100 unit"`, `"Sebagian"`), bahan tepung (`"100% terpakai"`, `"Pembatas"`, `tone: "bad"`), pemasok B (`"Dipakai 12 pak"`), dan edge alternatif (`used: true`, `overlayLabel: "12 pak"`).
2. `analyzeNetwork(snapshot, baseline)` (tanpa argumen ke-3) atau dengan `simulation.kpis === null` tidak menambahkan `overlay`/`used` (identik perilaku sebelumnya).
3. `computeResilienceScore(snapshot, network, comparison)` pada Dapur Sari mengembalikan skor berbobot deterministik (`0..100`), `outage_retention_pct === 47` (`210/450`), `mitigation_score_pct === 76` (`342/450`), dan grade yang sesuai.
4. `computeResilienceScore` saat `comparison` null atau `baseline_net_idr === 0` atau `bom` kosong tidak menghasilkan `NaN`/`Infinity` dan tetap di rentang `0..100`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/view-models.test.ts`
Expected: FAIL because `computeResilienceScore` and `analyzeNetwork` overlay parameter are not implemented.

- [ ] **Step 3: Update `lib/types.ts` and implement overlay + `computeResilienceScore` in `lib/view-models.ts`**

Implementasikan ekstensi tipe di `lib/types.ts` serta perluasan `analyzeNetwork` dan fungsi murni `computeResilienceScore` di `lib/view-models.ts` sesuai formula pada desain §5.

- [ ] **Step 4: Run `tests/lib/view-models.test.ts` to verify it passes**

Run: `npx vitest run tests/lib/view-models.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/types.ts lib/view-models.ts tests/lib/view-models.test.ts
git commit -m "feat: add simulation overlay fields and supply resilience score view models"
```

---

### Task 3: UI Stress-Test & Titik Impas di Halaman Perbandingan

**Files:**
- Create: `features/simulation/stress-test-chart.tsx`
- Create: `features/simulation/stress-test-panel.tsx`
- Modify: `features/simulation/comparison.tsx:180-220`
- Create: `tests/ui/competition-analytics.test.tsx`

**Interfaces:**
- Consumes: `runStressTestPreview` (`@/lib/api`), `StressTestResult` (`@/lib/solver/stress-test`)
- Produces in `features/simulation/stress-test-chart.tsx`:
  - `export function StressDelayChart({ data }: { data: { label: string; contribution: number | null }[] })`
  - `export function StressPremiumChart({ data }: { data: { premiumLabel: string; contribution: number | null; packs: number }[] })`
- Produces in `features/simulation/stress-test-panel.tsx`:
  - `export function StressTestPanel({ data, signature }: { data: WorkspaceData; signature: string })`

- [ ] **Step 1: Write failing UI tests in `tests/ui/competition-analytics.test.tsx` for `StressTestPanel` inside `Comparison`**

Siapkan harness pengujian mirip `tests/ui/workspace.test.tsx` (dengan `/api/simulate/stress-test` memanggil `runStressTest` asli, dan mock `stress-test-chart` / `comparison-chart` / `network-canvas`). Uji:
1. Membuka `Comparison` tidak memanggil `/api/simulate/stress-test` secara otomatis.
2. Mengklik **"Jalankan Stress-Test Otomatis"** memanggil `/api/simulate/stress-test` 1 kali dan menampilkan ringkasan uji keterlambatan (`+2 hari`) serta batas premi maksimal Pemasok B (`Rp 11.999`).
3. Mengubah data di `DataEditor` lalu kembali ke `Comparison` (atau memodifikasi signature) menandai hasil stress-test sebelumnya sebagai basi bila sudah dijalankan, atau memicu reset aman.

- [ ] **Step 2: Run UI test to verify it fails**

Run: `npx vitest run tests/ui/competition-analytics.test.tsx`
Expected: FAIL because `StressTestPanel` does not exist yet.

- [ ] **Step 3: Implement `stress-test-chart.tsx`, `stress-test-panel.tsx`, and mount in `comparison.tsx`**

- `stress-test-chart.tsx`: dua komponen Recharts `LineChart` responsif (`isAnimationActive={false}`, format Rupiah di `Tooltip` dan `YAxis`).
- `stress-test-panel.tsx`: memuat kedua chart via `dynamic(..., { ssr: false })`, mengelola `AbortController` saat request atau unmount, deteksi status basi berbasis `signature`, tombol **"Jalankan Stress-Test Otomatis"** / **"Hitung Ulang Stress-Test"**, serta ringkasan metrik keterlambatan dan titik impas per penawaran (atau pesan informatif bila belum ada pengiriman aktif/penawaran alternatif).
- `comparison.tsx`: tampilkan `<StressTestPanel data={data} signature={signature} />` di bawah `ComparisonDetails` saat hasil perbandingan segar (`fresh`).

- [ ] **Step 4: Run UI tests (`competition-analytics` + `workspace` + `quick-wins`) to verify they pass**

Run: `npx vitest run tests/ui/competition-analytics.test.tsx tests/ui/workspace.test.tsx tests/ui/quick-wins.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add features/simulation/stress-test-chart.tsx features/simulation/stress-test-panel.tsx features/simulation/comparison.tsx tests/ui/competition-analytics.test.tsx
git commit -m "feat: add on-demand stress-test and breakeven charts to comparison view"
```

---

### Task 4: Overlay Jaringan Pasok & Skor Ketahanan di Dashboard

**Files:**
- Modify: `features/network/network-canvas.tsx:1-75`
- Modify: `features/network/supply-network.tsx:1-165`
- Modify: `features/dashboard/dashboard.tsx:1-95`
- Modify: `tests/ui/competition-analytics.test.tsx`

**Interfaces:**
- Consumes: `analyzeNetwork`, `computeResilienceScore` (`@/lib/view-models`), `useWorkspace` (`runComparison`, `comparison`, `comparing`)

- [ ] **Step 1: Write failing UI tests in `tests/ui/competition-analytics.test.tsx` for Dashboard resilience score and SupplyNetwork overlay**

Tambahkan uji di `tests/ui/competition-analytics.test.tsx`:
1. `Dashboard` mode `demo` memuat `compareAll` sekali dan menampilkan kartu **Skor Ketahanan Pasokan** beserta angka skor (`0–100`), badge grade, serta rincian diversifikasi, ketahanan gangguan, dan daya pulih mitigasi.
2. `Dashboard` mode `workspace` kosong (`isEmpty === true`) **tidak** memanggil `/api/simulate/compare`, **tidak** menampilkan Skor Ketahanan Pasokan, dan tetap menjaga `"Mulai dari nol"` bersih dari `"Dapur Sari"`.
3. `SupplyNetwork` mode `demo` menampilkan toggle **"Tampilkan Dampak Simulasi"**, saat skenario `mitigation` dipilih menampilkan badge overlay di daftar node (`"68/100 unit"`, `"100% terpakai"`, `"Dipakai 12 pak"`), dan saat toggle dimatikan menyembunyikan badge overlay.

- [ ] **Step 2: Run UI test to verify it fails**

Run: `npx vitest run tests/ui/competition-analytics.test.tsx`
Expected: FAIL because Dashboard resilience score and SupplyNetwork overlay toggle are not implemented yet.

- [ ] **Step 3: Implement overlay in `network-canvas.tsx` & `supply-network.tsx`, and resilience score in `dashboard.tsx`**

- `network-canvas.tsx`: render `item.overlay` pill di `SupplyNode`, tambah kelas `.flow-bottleneck` saat `item.kind === "material" && item.overlay?.tone === "bad"`, dan tebalkan garis `item.used` (`strokeWidth: 2.6`, tanpa putus-putus, dengan `label: item.overlayLabel`).
- `supply-network.tsx`: gunakan `attempted` ref per `signature` untuk memicu `runComparison()` ketika `!isEmpty && !fresh && !comparing`; tambahkan toggle **"Tampilkan Dampak Simulasi"** (`showOverlay`, default `true`); teruskan `activeSimulation` ke `analyzeNetwork` saat `showOverlay` aktif; tampilkan `node.overlay` di `NodeList` dan `NetworkDetail`.
- `dashboard.tsx`: gunakan `attempted` ref per `signature` untuk memicu `runComparison()` ketika `!isEmpty && !fresh && !comparing`; hitung `computeResilienceScore(snapshot, network, fresh ? comparison.view : null)` dan tampilkan panel **Skor Ketahanan Pasokan** hanya saat `!isEmpty`.

- [ ] **Step 4: Run all UI and domain tests to verify they pass**

Run: `npx vitest run tests/ui/competition-analytics.test.tsx tests/ui/workspace.test.tsx tests/ui/quick-wins.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add features/network/network-canvas.tsx features/network/supply-network.tsx features/dashboard/dashboard.tsx tests/ui/competition-analytics.test.tsx
git commit -m "feat: add optimization overlay on supply network and resilience score on dashboard"
```

---

### Task 5: Gaya Responsif (`app/globals.css`) & Verifikasi Penuh

**Files:**
- Modify: `app/globals.css` (tambahkan gaya komponen baru + aturan `@media (max-width: 680px)`)

- [ ] **Step 1: Tambahkan CSS responsif untuk panel Skor Ketahanan, overlay node graf/daftar, dan panel/grafik Stress-Test**

Pastikan seluruh elemen baru di `Dashboard`, `SupplyNetwork` (`NetworkCanvas` + `NodeList`), dan `StressTestPanel` menggunakan token CSS MicroChain (`--surface`, `--canvas`, `--rule`, `--mint`, `--deep`, `--green`, `--warning`, `--bad`) serta menumpuk rapi 1 kolom tanpa overflow horizontal pada `@media (max-width: 680px)` (`390px`).

- [ ] **Step 2: Jalankan verifikasi penuh (`test`, `typecheck`, `lint`, `build`)**

Run: `npm test && npm run typecheck && npm run lint && npm run build`
Expected: Seluruh suite Vitest lulus tanpa error/skip, `tsc --noEmit` keluar `0`, `eslint` bersih, dan `next build` berhasil membangun seluruh rute termasuk `/api/simulate/stress-test`.

- [ ] **Step 3: Commit**

```bash
git add app/globals.css
git commit -m "style: add responsive styles for resilience score, network overlay, and stress-test panels"
```
