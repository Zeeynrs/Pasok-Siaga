---
tags:
  - spec
  - analytics
  - competition
  - microchain
project: "[[MicroChain Hub]]"
status: approved
---

# Dokumen Desain: Analitik Lomba MicroChain (Stress-Test, Overlay Graf, & Skor Ketahanan)

Kembali ke [[MicroChain Hub]] | Lihat [[docs/superpowers/specs/2026-11-25-microchain-design|Desain Utama]] | Lihat [[docs/superpowers/specs/2026-11-27-quick-wins-design|Desain Quick Wins]]

## 1. Intent & Latar Belakang
Untuk kebutuhan demo panggung dan penjurian lomba, MicroChain perlu menonjolkan keunggulan utamanya—optimasi rantai pasok berbasis MILP deterministik—secara visual dalam hitungan detik:
1. Juri perlu melihat bahwa solver `highs` bukan sekadar kalkulator sekali hitung, melainkan mampu menjalankan **Auto Stress-Test** (uji keterlambatan bertahap dan pencarian **titik impas / breakeven premi** pemasok cadangan).
2. Di halaman **Jaringan Pasok** (`/network`), alur `Pemasok → Bahan → Produk` perlu menampilkan **overlay hasil optimasi** langsung pada node dan garis (unit terencana, % stok terpakai & *bottleneck*, serta jalur cadangan yang aktif dibeli).
3. Di **Ringkasan Usaha** (`/dashboard`), pemilik usaha & juri perlu melihat satu metrik pembuka: **Skor Ketahanan Pasokan (0–100)** beserta rincian kondisi Normal, Gangguan, dan Mitigasi.

## 2. Tujuan, Non-Tujuan, & Anti-Tujuan

### Tujuan
- Menambahkan analisis sensitivitas deterministik (`lib/solver/stress-test.ts` + `POST /api/simulate/stress-test`) untuk kurva keterlambatan (`+0..+5` hari) dan titik impas premi per pak pemasok cadangan.
- Menampilkan **Overlay Hasil Simulasi** di [`SupplyNetwork`](file:///C:/Users/adity/orca/MicroChain/features/network/supply-network.tsx) dan [`NetworkCanvas`](file:///C:/Users/adity/orca/MicroChain/features/network/network-canvas.tsx) berbasis hasil `compareAll` yang sudah di-cache `WorkspaceProvider`.
- Menampilkan kartu **Skor Ketahanan Pasokan (0–100)** di [`Dashboard`](file:///C:/Users/adity/orca/MicroChain/features/dashboard/dashboard.tsx) menggunakan formula berbobot yang transparan dan deterministik.

### Non-Tujuan
- Tidak mengubah skema Postgres/Supabase, RPC, maupun RLS.
- Tidak mengubah formulasi matematis dasar `solveScenario` di `lib/solver/milp-solver.ts`.
- Tidak menggunakan LLM/API eksternal (100% deterministik dan aman untuk demo offline/panggung).

### Anti-Tujuan
- Tidak menjalankan endpoint `stress-test` secara otomatis setiap kali membuka `/comparison` atau setiap ketikan (dijalankan *on-demand* via tombol dan ditandai basi bila input berubah) agar tidak mengganggu performa maupun test perbandingan eksisting.
- Tidak mengotori workspace kosong (`isEmpty === true`) di `Dashboard` dengan skor palsu atau permintaan `/api/simulate/compare`.
- Tidak mengubah perilaku default `analyzeNetwork(snapshot, scenario)` ketika parameter hasil simulasi tidak diberikan.

## 3. Batasan Teknis
- Stack: Next.js 16 (App Router), React 19, TypeScript, Recharts 3, `@xyflow/react` 12, `highs` WASM, Zod, Vitest + Testing Library.
- Seluruh teks UI, label aksesibilitas, dan pesan galat berbahasa Indonesia memakai `lib/format.ts`.
- Endpoint `/api/simulate/stress-test` tetap berada di Next.js Route Handler, divalidasi lewat `validateWorkspaceData`, dan mengikuti `handleError` / `readJson` di `lib/api/http.ts`.
- Komponen grafik (`StressTestChart` / `ComparisonChart`) dimuat dinamis (`ssr: false`) atau aman di lingkungan `jsdom` test serta responsif pada desktop (`1440px`) dan mobile (`390px`).

## 4. Pendekatan yang Dipertimbangkan

### Pendekatan A — Endpoint `POST /api/simulate/stress-test` + Cache `compareAll` Bersama *(Dipilih)*
- Satu endpoint server `POST /api/simulate/stress-test` menjalankan rangkaian `solveScenario` di server Next.js dalam 1 HTTP round-trip untuk menyusun kurva keterlambatan dan mencari titik impas premi secara presisi (*binary search* integer).
- Overlay Jaringan Pasok dan Skor Ketahanan memanfaatkan `comparison` dari `WorkspaceProvider` (`POST /api/simulate/compare`) yang di-cache berdasarkan `inputs_signature`, tanpa menambah round-trip ekstra.
- *Trade-off:* Menambah 1 Route Handler API baru, namun cepat (~50–150ms per stress-test), bebas *rate-limit*/race-condition banyak request paralel, dan deterministik penuh.

### Pendekatan B — Loop Request dari Klien ke `/api/simulate` *(Ditolak)*
- Klien mengirim 10–20 request `POST /api/simulate` untuk setiap variasi delay dan premi.
- *Trade-off:* Tidak menambah endpoint baru, namun lambat di Vercel serverless dan tidak efisien untuk pencarian titik impas presisi.

## 5. Desain Rinci per Fitur

### Fitur 1: Auto Stress-Test & Grafik Titik Impas (*Breakeven*)
- **Tipe & Modul Solver (`lib/solver/stress-test.ts`):**
  - `DelayStressPoint`: `{ delay_days: number; net_contribution_idr: number | null; status: ScenarioResult["status"]; unmet_units: number }`
  - `PremiumSamplePoint`: `{ premium_idr: number; net_contribution_idr: number | null; packs_bought: number; status: ScenarioResult["status"] }`
  - `OfferBreakeven`: `{ offer_id: string; supplier_name: string; material_name: string; current_premium_idr: number; max_viable_premium_idr: number | null; headroom_idr: number | null; points: PremiumSamplePoint[] }`
  - `StressTestResult`: `{ delay_scenario_id: string; offer_scenario_id: string; baseline_net_idr: number | null; critical_delay_days: number | null; delay_curve: DelayStressPoint[]; no_offer_net_idr: number | null; offer_breakevens: OfferBreakeven[] }`
  - `runStressTest(snapshot: WorkspaceSnapshot, scenarios: ScenarioConfig[], options?: { delayScenarioId?: string; offerScenarioId?: string }): Promise<StressTestResult>`:
    1. **Kurva Keterlambatan (`delay_curve`):**
       - Ambil `delayBase` = skenario `options?.delayScenarioId ?? "baseline"` (fallback `scenarios[0]`).
       - Identifikasi pengiriman terjadwal yang masih dihitung di `delayBase` (`counted === true` dari `resolveScenarioInputs`).
       - Untuk `d` dari `0` sampai `5`: buat salinan `delayBase` yang menambahkan `d` hari keterlambatan (`delay_days`) pada setiap pengiriman aktif tersebut (di atas delay eksisting), lalu panggil `solveScenario`.
       - `critical_delay_days`: nilai `d` terkecil (`>= 1`) di mana `net_contribution_idr < baseline_net_idr` (atau `status !== "Optimal"`), atau `null` bila semua hari tetap sama.
    2. **Titik Impas Premi (`offer_breakevens`):**
       - Ambil `offerBase` = skenario `options?.offerScenarioId ?? "mitigation"` (fallback ke skenario pertama yang memiliki `enabled_offer_ids.length > 0`, atau `scenarios[0]`).
       - Hitung `noOfferResult = await solveScenario(snapshot, { ...offerBase, enabled_offer_ids: [] })` → `no_offer_net_idr`.
       - Ambil daftar penawaran `eligible` di `offerBase` via `resolveScenarioInputs(snapshot, offerBase)`.
       - Untuk tiap penawaran `o`:
         - Definisikan helper lokal `evalAt(premium: number)` yang menyalin `snapshot` dengan `o.incremental_premium_idr_per_pack = premium` dan `offerBase` hanya mengaktifkan `o.id` (atau mempertahankan penawaran lain bila ada; keputusan pembangun: menguji `offerBase` dengan `o` pada premi tersebut dan membandingkan terhadap `offerBase` tanpa `o`, yaitu `withoutThisOfferNet`).
         - Gunakan batas atas eksplorasi yang cukup aman: mulai dari `hi = Math.max(o.incremental_premium_idr_per_pack * 2, 10_000)` dan gandakan hingga `evalAt(hi)` menghasilkan `packs_bought === 0` atau `net <= withoutThisOfferNet` (maks `10_000_000`, batas validasi domain `offerSchema`).
         - Jalankan *binary search* integer di `[0, hi]` (maks ~24 iterasi) untuk menemukan nilai `max_viable_premium_idr` terbesar di mana `packs_bought > 0 && net_contribution_idr > withoutThisOfferNet` (atau `null` bila bahkan pada premi `0` pun tidak dibeli/tidak menguntungkan).
         - Susun 6 titik sampel merata dari `0` hingga `hi` (menyertakan `o.incremental_premium_idr_per_pack` dan `max_viable_premium_idr` bila dalam rentang, diurutkan naik & unik) untuk kurva grafik.
- **Route Handler (`app/api/simulate/stress-test/route.ts`):**
  - `POST`: validasi `snapshot` dan `scenarios` via `validateWorkspaceData`, validasi opsional `delayScenarioId` / `offerScenarioId` (string), panggil `runStressTest(...)`, kembalikan `{ stress_test, inputs_signature }`.
- **Client API & UI (`lib/api.ts`, `features/simulation/stress-test-panel.tsx`, `features/simulation/comparison.tsx`):**
  - `runStressTestPreview(data, options?, signal?)` di `lib/api.ts`.
  - Panel **"Stress-Test & Titik Impas"** di bawah perbandingan pada [`Comparison`](file:///C:/Users/adity/orca/MicroChain/features/simulation/comparison.tsx):
    - Tombol **"Jalankan Stress-Test Otomatis"** (`on-demand`).
    - Bila `signature` berubah setelah stress-test dijalankan, tampilkan status basi serupa simulator dan tombol hitung ulang.
    - Menampilkan 2 bagian:
      1. Grafik kurva keterlambatan (`+0` s.d. `+5` hari) + ringkasan daya tahan keterlambatan.
      2. Kartu metrik titik impas per penawaran (Premi saat ini, Batas premi maksimal agar tetap untung, Selisih aman) + grafik kurva sensitivitas premi.

### Fitur 2: Overlay Hasil Optimasi Langsung di Jaringan Pasok (`/network`)
- **Perluasan View Model (`lib/types.ts` & `lib/view-models.ts`):**
  - Tambah tipe opsional pada `NetworkNode`:
    `overlay?: { badge: string; metric: string; tone: "good" | "warning" | "bad" | "neutral" }`
  - Tambah field opsional pada `NetworkEdge`:
    `overlayLabel?: string; used?: boolean`
  - Perbarui `analyzeNetwork(snapshot: WorkspaceSnapshot, scenario: ScenarioConfig, simulation?: SimulationResult | null): NetworkResult`:
    - Jika `simulation` null/undefined atau `simulation.kpis === null`, tidak mengisi `overlay` / `used` (perilaku 100% identik sebelumnya).
    - Jika `simulation` valid:
      - **Product:** `metric = "${formatInt(line.units)}/${formatInt(line.demand_units)} unit"`, `badge = line.unmet_units === 0 ? "Terpenuhi" : line.units > 0 ? "Sebagian" : "Terhenti"`, `tone = line.unmet_units === 0 ? "good" : line.units > 0 ? "warning" : "bad"`.
      - **Material:** `pct = usage.available_units > 0 ? Math.round((usage.used_units / usage.available_units) * 100) : 0`, `metric = "${pct}% terpakai"`, `badge = usage.is_bottleneck ? "Pembatas" : "Cukup"`, `tone = usage.is_bottleneck ? "bad" : pct >= 85 ? "warning" : "good"`.
      - **Supplier:** total pak dibeli di `simulation.purchases` untuk `supplier_id`; bila `> 0`, `badge = "Dipakai ${formatInt(packs)} pak"`, `metric = formatMoney(totalPremium)`, `tone = "good"`.
      - **Edge `alternative`:** jika `offer_id` dipakai dengan `packs > 0`, set `used = true` dan `overlayLabel = "${formatInt(packs)} pak"`.
- **Integrasi UI (`features/network/supply-network.tsx` & `features/network/network-canvas.tsx`):**
  - Di `SupplyNetwork`:
    - Ketika `!isEmpty && !fresh && !comparing`, panggil `runComparison()` (sekali per signature) agar `SimulationResult` untuk `scenario.id` tersedia di cache `WorkspaceProvider`.
    - Tambahkan tombol/checkbox toggle **"Tampilkan Dampak Simulasi"** (aktif default saat `simulation` tersedia) di header panel jaringan.
    - Teruskan `network.nodes` dan `network.edges` ke `NetworkCanvas`, `NodeList`, dan `NetworkDetail` agar informasi overlay terlihat di desktop maupun mobile (`390px`).
  - Di `NetworkCanvas`:
    - `SupplyNode`: render `<span className="flow-overlay-pill ...">` bila `item.overlay` ada, serta kelas `.flow-bottleneck` bila `item.overlay?.tone === "bad"` dan `item.kind === "material"`.
    - `flowEdges`: garis `item.used` diberi `strokeWidth: 2.6`, solid (`strokeDasharray: undefined`), dan `label: item.overlayLabel` di React Flow.

### Fitur 3: Skor Ketahanan Pasokan (0–100) di `Dashboard`
- **Fungsi Murni (`lib/view-models.ts` & `lib/types.ts`):**
  - Tambah tipe `ResilienceScore`:
    `{ score: number; grade: "Tangguh" | "Cukup Siap" | "Rentan"; tone: "good" | "warning" | "bad"; structural_pct: number; outage_retention_pct: number | null; mitigation_score_pct: number | null; summary: string }`
  - `computeResilienceScore(snapshot: WorkspaceSnapshot, network: NetworkResult, comparison?: ComparisonResult | null): ResilienceScore`:
    - **Komponen Struktural (`structural_pct`):**
      - Identifikasi bahan yang dipakai oleh produk (`bom`) atau memiliki pemasok. Jika 0 bahan, `structural_pct = 100`.
      - Suatu bahan dianggap memiliki sumber terdiversifikasi bila di `snapshot` ia punya `>= 2` pemasok berbeda (gabungan `committed_deliveries` + `alternative_offers` dari pemasok aktif), atau tidak bergantung pada pengiriman tunggal (`!single_source`).
      - `structural_pct = Math.round((diversifiedCount / evaluatedMaterials.length) * 100)`.
    - **Komponen Finansial (bila `comparison` tersedia & `baseline > 0`):**
      - `outage_retention_pct = clamp(0, 100, Math.round((outage / baseline) * 100))`
      - `mitigation_score_pct = clamp(0, 100, Math.round((mitigation / baseline) * 100))`
      - `score = clamp(0, 100, Math.round(0.30 * structural_pct + 0.30 * outage_retention_pct + 0.40 * mitigation_score_pct))`
    - **Fallback bila `comparison` belum tersedia / `baseline <= 0`:**
      - `score = structural_pct`, `outage_retention_pct = null`, `mitigation_score_pct = null`.
    - **Klasifikasi:** `score >= 75` → `"Tangguh"` (`"good"`); `score >= 45` → `"Cukup Siap"` (`"warning"`); `< 45` → `"Rentan"` (`"bad"`).
- **Integrasi UI (`features/dashboard/dashboard.tsx`):**
  - Ketika `!isEmpty && !fresh && !comparing`, panggil `runComparison()` (menggunakan `attempted` ref per `signature` agar tidak mengulang saat error).
  - Saat `!isEmpty`, tampilkan kartu **Skor Ketahanan Pasokan** di atas/dalam ringkasan: angka `score/100`, tag grade (`Tangguh` / `Cukup Siap` / `Rentan`), 3 indikator rincian (*Diversifikasi pasokan*, *Ketahanan saat gangguan*, *Daya pulih mitigasi*), dan tautan ke Perbandingan / Stress-Test.
  - Saat `isEmpty`, kartu Skor Ketahanan tidak ditampilkan sehingga panel *"Mulai dari nol"* tetap bersih.

## 6. Yang Diserahkan ke Pembangun
- Penamaan & penempatan subkomponen chart stress-test agar aman dari SSR (`dynamic(..., { ssr: false })`) dan dapat di-mock bersih di `tests/ui/` seperti `ComparisonChart`.
- Styling CSS responsif (`app/globals.css`) untuk kartu Skor Ketahanan, pill overlay di node React Flow + daftar mobile, serta panel & chart Stress-Test pada viewport `1440px` dan `390px`.
- Unit test & UI test TDD lengkap untuk `lib/solver/stress-test.ts`, `POST /api/simulate/stress-test`, `computeResilienceScore`, `analyzeNetwork(..., simulation)`, dan interaksi UI di `Dashboard`, `SupplyNetwork`, dan `Comparison`.
