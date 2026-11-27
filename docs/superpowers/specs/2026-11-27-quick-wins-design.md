---
tags:
  - spec
  - quick-wins
  - microchain
project: "[[MicroChain Hub]]"
status: approved
---

# Dokumen Desain: MicroChain Quick Wins (4 Fitur Peningkatan UX & Nilai UMKM)

Kembali ke [[MicroChain Hub]] | Lihat [[docs/superpowers/specs/2026-11-25-microchain-design|Desain Sistem Utama]]

## 1. Intent & Latar Belakang
MicroChain saat ini sudah memiliki pondasi solver MILP deterministik (`highs` WASM), graf jaringan pasok `Pemasok → Bahan → Produk`, deteksi hasil basi berbasis SHA-256, mode demo tamu, serta workspace persisten dengan Supabase RLS. Namun, dalam alur penggunaan nyata oleh pemilik UMKM makanan, masih terdapat empat hambatan praktis:
1. Pengguna login baru mendapat workspace kosong dan harus mengetik seluruh pemasok, bahan, produk, resep, pengiriman, dan penawaran secara manual dari nol.
2. Hasil simulasi (rencana produksi dan pembelian alternatif) baru tampil di layar dan belum bisa disalin sebagai pesan order ke pemasok atau diunduh sebagai catatan.
3. Halaman Perbandingan sudah menghitung skenario kustom (hingga 10 skenario), tetapi ringkasan KPI pemulihan masih terkunci pada ID `baseline`, `outage`, dan `mitigation`.
4. Halaman Jaringan Pasok bersifat pasif (*read-only*): setelah melihat node pemasok atau bahan sumber tunggal, pengguna harus berpindah tab dan mencari pengaturannya secara manual di Simulator atau Data Usaha.

Paket **Quick Wins** ini menutup keempat celah tersebut tanpa mengubah skema Postgres/Supabase maupun formulasi matematis solver MILP.

## 2. Tujuan, Non-Tujuan, & Anti-Tujuan

### Tujuan
- Mempercepat *time-to-value* pengguna baru melalui **4 template starter kuliner** siap pakai yang lolos validasi domain.
- Memungkinkan hasil simulasi langsung dipakai operasional lewat **salin pesan order WhatsApp** dan **unduh CSV** (simulasi & perbandingan).
- Membuka fleksibilitas **perbandingan antar skenario kustom** (memilih pembanding Normal/Gangguan/Mitigasi dan menyaring skenario di grafik & tabel).
- Menghubungkan temuan risiko di **Jaringan Pasok** langsung ke **Simulator** dan **Data Usaha** lewat tombol aksi cepat di panel detail node.

### Non-Tujuan
- Tidak ada migrasi database Supabase, perubahan tabel/RPC/RLS, maupun Route Handler API baru.
- Tidak ada pengiriman pesan WhatsApp otomatis via WhatsApp Business API (cukup salin teks ke clipboard dan tautan `wa.me/?text=...`).
- Tidak ada generator PDF binary server-side (ekspor memakai CSV kompatibel Excel dan teks ringkasan/WA).
- Tidak ada perubahan formulasi matematis solver MILP (`lib/solver/milp-solver.ts`).

### Anti-Tujuan
- Tidak menimpa data workspace yang sudah diisi pengguna dengan template tanpa konfirmasi eksplisit.
- Tidak merusak kontrak `saveUserWorkspace` (`slug` usaha, `demo_data`, `source`, atau keberadaan 3 skenario inti `baseline`, `outage`, `mitigation`).
- Tidak menampilkan hasil simulasi lama seolah masih valid setelah skenario dimodifikasi dari aksi cepat Jaringan Pasok.

## 3. Batasan Teknis
- Stack: Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4 / `app/globals.css`, Vitest + Testing Library.
- Seluruh teks UI, label aksesibilitas, dan pesan notifikasi menggunakan Bahasa Indonesia dengan pemformatan `Rp`, satuan (`g/ml/pcs` atau `kg/l/buah`), dan tanggal lokal (`lib/format.ts`).
- Kontrak `WorkspaceData` (`lib/domain/types.ts`) dan `validateWorkspaceData` (`lib/domain/validation.ts`) tetap menjadi sumber kebenaran tunggal.
- Mode `workspace` menyimpan perubahan ke Supabase hanya saat pengguna menekan **Simpan ke Workspace** (`PUT /api/workspace`), sedangkan mode `demo` otomatis tersimpan di `sessionStorage`.

## 4. Pendekatan yang Dipertimbangkan

### Pendekatan A — Client-First Tanpa Migrasi Database *(Dipilih)*
Memanfaatkan `WorkspaceData`, mutasi domain murni (`lib/domain/mutations.ts`), serta endpoint `PUT /api/workspace` dan `POST /api/simulate/compare` yang sudah ada:
- **Template Starter** disimpan sebagai konstanta `WorkspaceData` tervalidasi di `lib/domain/templates.ts`.
- **WhatsApp & CSV** dibangun sebagai formatter murni di `lib/export.ts` dan dijalankan di browser.
- **Perbandingan Kustom** memanfaatkan daftar seluruh hasil skenario yang sudah dikembalikan oleh `POST /api/simulate/compare`, lalu menghitung ulang ringkasan KPI pemulihan di klien sesuai skenario peran & filter yang dipilih pengguna.
- **Aksi Cepat Jaringan** memakai mutasi domain murni untuk menyiapkan skenario gangguan lalu menavigasi lewat `router.push(...)`.
- *Trade-off:* Cepat, minim risiko regresi, nol perubahan backend/DB. Kekurangannya: daftar template terikat di kode rilis dan pesan WA berbentuk teks siap tempel / `wa.me`.

### Pendekatan B — Berbasis Database & Endpoint Server Baru *(Ditolak)*
Menyimpan template ke tabel Postgres `demo_templates` dengan migrasi SQL baru, membuat endpoint `/api/templates`, serta memindahkan logika ekspor/pemilihan perbandingan ke server.
- *Trade-off:* Template bisa dikelola tanpa deploy ulang, namun menambah beban migrasi Postgres, pembaruan RLS/seed, dan memperbesar ruang lingkup untuk perubahan yang dapat diselesaikan bersih di lapisan domain + klien.

## 5. Desain Rinci per Fitur

### Fitur 1: Template Starter Sektor Kuliner
- **Modul domain baru:** `lib/domain/templates.ts`
  - Menyediakan tipe `StarterTemplate`: `{ id: string; name: string; sector: string; tagline: string; highlight: string; data: WorkspaceData }`.
  - Menyediakan 4 template kuliner selaras dengan contoh pada landing page, seluruhnya memiliki 3 skenario inti (`baseline`, `outage`, `mitigation`), angka realistis, dan lolos `validateWorkspaceData`:
    1. `dapur_sari` — **Dapur Sari** (*Toko roti & kue*, menggunakan data referensi `DAPUR_SARI_FALLBACK_FIXTURE`).
    2. `kedai_kopi` — **Kedai Kopi Susu** (*Minuman & kopi rumahan* — bahan: Biji kopi, Susu segar, Sirup gula aren; produk: Es Kopi Susu Aren, Americano; pengiriman utama susu segar vs cadangan susu UHT).
    3. `dimsum_beku` — **Dapur Dimsum & Beku** (*Camilan & makanan beku* — bahan: Daging ayam, Udang kupas, Kulit pangsit; produk: Dimsum Ayam, Dimsum Udang; pasokan udang kupas sumber tunggal + pemasok cadangan).
    4. `martabak_kue` — **Martabak & Kue** (*Jajanan & pesanan akhir pekan* — bahan: Tepung terigu, Mentega, Coklat & keju; produk: Martabak Coklat Keju, Martabak Klasik; keterbatasan mentega + pembelian cadangan).
  - Menyediakan fungsi murni `applyStarterTemplate(current: WorkspaceData, templateId: string, mode: "demo" | "workspace"): WorkspaceData`:
    - Mengkloning `template.data`.
    - Mempertahankan `business.id` dari `current.snapshot.business.id` agar kompatibel dengan kontrak workspace Supabase.
    - Menyetel `snapshot.demo_data = (mode === "demo")` dan `source = mode === "demo" ? "demo" : "user"` pada seluruh skenario.
    - Memvalidasi hasil dengan `validateWorkspaceData` sebelum dikembalikan.
- **Integrasi UI:**
  - Di [`Dashboard`](file:///C:/Users/adity/orca/MicroChain/features/dashboard/dashboard.tsx): ketika `isEmpty === true`, panel *"Mulai dari nol"* tetap tampil ringkas tanpa langsung menampilkan kartu data contoh di layar awal (menjaga kontrak regresi workspace kosong). Tambahkan tombol **"Pilih Template Starter"** di sebelah **"Isi Data Usaha"** yang membuka daftar 4 template secara *on-demand* (atau menuju `/data?panel=templates`). Mengklik **"Pakai Template"** langsung memanggil `setData(applyStarterTemplate(data, tpl.id, mode))` dan menampilkan toast sukses (di mode `workspace`, pengingat bahwa perubahan perlu disimpan lewat *Simpan ke Workspace*).
  - Di [`DataEditor`](file:///C:/Users/adity/orca/MicroChain/features/data-editor/data-editor.tsx): tambahkan panel/bagian **"Template Starter"** (otomatis terbuka bila `?panel=templates` aktif). Jika workspace kosong, klik langsung menerapkan; jika workspace sudah memiliki data (`suppliers/materials/products > 0`), tampilkan panel konfirmasi (`role="alertdialog"`, pola sama dengan konfirmasi reset) agar data pengguna tidak tertimpa tanpa sengaja, lalu reset form key (`resetVersion`) setelah diterapkan.

### Fitur 2: Salin Pesan Order WhatsApp & Ekspor CSV
- **Modul utilitas baru:** `lib/export.ts`
  - `formatWhatsAppOrderMessage(result: SimulationResult, snapshot: WorkspaceSnapshot): string`
    - Menyusun pesan Bahasa Indonesia yang rapi dan siap ditempel ke WhatsApp: nama usaha, tanggal batas (`formatDate`), daftar pembelian alternatif (`result.purchases` yang `packs > 0`, dikelompokkan per pemasok dengan nama bahan, jumlah pak, total kuantitas dalam `formatQuantity`, serta estimasi biaya tambahan), dan ringkasan target produksi.
    - Bila tidak ada pembelian alternatif (`result.purchases.length === 0`), menyusun ringkasan rencana produksi, sisa bahan, dan estimasi kontribusi bersih agar tombol tetap berguna di skenario Normal maupun Gangguan.
  - `buildWhatsAppShareUrl(message: string): string` → `https://wa.me/?text=${encodeURIComponent(message)}`.
  - `simulationToCsv(result: SimulationResult, snapshot: WorkspaceSnapshot): string` → menghasilkan CSV ber-BOM UTF-8 (`\uFEFF`) dengan escaping RFC-4180 berisi bagian Ringkasan KPI, Rencana Produksi, Penggunaan Bahan, dan Pembelian Alternatif.
  - `comparisonToCsv(outcome: ComparisonResult): string` → menghasilkan CSV ber-BOM UTF-8 berisi Ringkasan Pemulihan, Perbandingan Kontribusi per Skenario, dan Selisih Antar Skenario.
- **Integrasi UI:**
  - Di [`SimulationResults`](file:///C:/Users/adity/orca/MicroChain/features/simulation/results.tsx): pada header hasil (saat `kpis !== null`), tambahkan baris tombol aksi ringkas:
    - **"Salin Pesan Order (WA)"** (label menjadi **"Salin Ringkasan"** jika `purchases.length === 0`) — menyalin ke `navigator.clipboard.writeText` lalu memanggil `notify.success(...)`; bila clipboard gagal/tidak tersedia, tampilkan `notify.error(...)`.
    - **"Buka WhatsApp"** (tautan `<a target="_blank" rel="noopener noreferrer">`, tampil saat `purchases.length > 0`).
    - **"Unduh CSV"** — memicu unduhan Blob `.csv` bernama `simulasi-${scenario_id}.csv`.
  - Di [`Comparison`](file:///C:/Users/adity/orca/MicroChain/features/simulation/comparison.tsx): tambahkan tombol **"Unduh CSV"** pada header halaman atau panel perbandingan untuk mengunduh `perbandingan-skenario.csv` berdasarkan tampilan perbandingan aktif (hasil `recomputeComparisonView` yang sedang dilihat pengguna).

### Fitur 3: Perbandingan Antar Skenario Kustom
- **Fungsi kalkulasi di `lib/view-models.ts`:**
  - Pertahankan tanda tangan default `toComparisonView(results, scenarios, snapshot)` agar 100% kompatibel dengan route API dan seluruh test eksisting.
  - Tambahkan fungsi pembantu murni `recomputeComparisonView(outcome: ComparisonResult, roles: { baselineId: string; outageId: string; mitigationId: string }, visibleIds?: string[]): ComparisonResult`:
    - Menyaring `results` berdasarkan `visibleIds` (bila diberikan dan minimal 1 cocok; jika tidak, semua tampil).
    - *(Keputusan desain)* Menghitung ulang `contribution_at_risk_idr`, `recovered_contribution_idr`, `recovery_pct`, dan peringatan negatif selalu dari keseluruhan `outcome.results` menggunakan `roles.baselineId`, `roles.outageId`, dan `roles.mitigationId` dengan rumus identik `toComparisonView`, sehingga menyembunyikan salah satu skenario dari grafik/tabel tidak membuat kartu KPI pemulihan ikut kosong.
    - *(Keputusan desain)* Menghitung `deltas` secara **berurutan** antar skenario yang sedang tampil (`views[i] -> views[i + 1]`), konsisten dengan `toComparisonView` dan subjudul *"Selisih terhadap skenario awal pada setiap pasangan"*, sehingga saat kondisi default (`baseline`, `outage`, `mitigation` tampil semua) output `recomputeComparisonView` 100% identik dengan `outcome` asli dari server.
- **Integrasi UI di [`Comparison`](file:///C:/Users/adity/orca/MicroChain/features/simulation/comparison.tsx):**
  - Saat ada hasil segar (`fresh`), tampilkan bar kontrol ringan **"Atur Pembanding"**:
    - 3 `<select>` untuk memilih peran: **Acuan Normal**, **Skenario Gangguan**, **Skenario Mitigasi** (opsi berasal dari seluruh `outcome.results`).
    - Daftar chip/checkbox untuk memilih skenario mana saja yang ditampilkan pada grafik batang dan tabel (minimal 1 skenario tetap aktif; tombol disable atau jaga agar skenario terakhir tidak bisa dimatikan).
  - Pilihan peran & filter ini bersifat state UI lokal di `Comparison` (di-reset aman bila ID yang dipilih sudah dihapus dari workspace).

### Fitur 4: Aksi Cepat dari Jaringan Pasok (`/network`)
- **Mutasi domain baru di `lib/domain/mutations.ts`:**
  - `prepareSupplierOutageScenario(data: WorkspaceData, supplierId: string): { data: WorkspaceData; scenarioId: string; created: boolean; fallbackUpdated: boolean }`:
    - Mencari apakah sudah ada skenario yang hanya menonaktifkan `supplierId` (dan bukan `baseline`, mis. ID `uji_gagal_<supplierId>` atau skenario dengan `disabled_supplier_ids` persis `[supplierId]` dan `enabled_offer_ids.length === 0`).
    - Jika belum ada dan `data.scenarios.length < MAX_SCENARIOS`: membuat skenario baru berbasis `baseline` dengan `id = slugify(\`uji_gagal_${supplierId}\`, ...)`, `name = "Uji Gagal: ${supplierName}"`, `disabled_supplier_ids: [supplierId]`, `enabled_offer_ids: []`, `source: data.snapshot.demo_data ? "demo" : "user"`.
    - Jika `data.scenarios.length >= MAX_SCENARIOS`: memperbarui skenario `outage` (menyetel `disabled_supplier_ids: [supplierId]`, `enabled_offer_ids: []`) dengan `fallbackUpdated: true` agar aksi tetap berhasil tanpa melampaui batas `MAX_SCENARIOS`.
- **Integrasi UI di [`SupplyNetwork`](file:///C:/Users/adity/orca/MicroChain/features/network/supply-network.tsx) & [`StructureEditor`](file:///C:/Users/adity/orca/MicroChain/features/data-editor/structure-editor.tsx):**
  - Di `NetworkDetail`, ketika node dipilih:
    - **Pemasok (`kind === "supplier"`):** tombol **"Uji jika pemasok ini gagal"** → memanggil `prepareSupplierOutageScenario`, `setData(next)`, `selectScenario(scenarioId)`, `notify.info(...)`, lalu `router.push(href("/simulator"))`. (Jika pemasok sudah dinonaktifkan global di Data Usaha, tetap arahkan ke Simulator atau beri penjelasan singkat).
    - **Bahan (`kind === "material"`):** tombol **"Tambah pemasok cadangan"** → mengarahkan ke `href("/data?focus=offers")` (atau menambahkan query param `focus=offers`), serta tombol **"Buka Simulator"** → `href("/simulator")`.
    - **Produk (`kind === "product"`):** tombol **"Simulasikan produksi"** → `href("/simulator")`.
  - Di [`StructureEditor`](file:///C:/Users/adity/orca/MicroChain/features/data-editor/structure-editor.tsx): baca `useSearchParams().get("focus") === "offers"` untuk membuka panel akordeon **Penawaran alternatif** secara default dan men-scroll halus ke panel tersebut (aman pada SSR/test karena memakai `useEffect` + guard `scrollIntoView?.()`).

## 6. Yang Diserahkan ke Pembangun
- Penataan visual kartu template starter, baris tombol ekspor, kontrol pembanding skenario, dan tombol aksi di `NetworkDetail` agar mengikuti kelas CSS & token warna/tipografi di `app/globals.css` dan responsif pada viewport desktop (`1440px`) maupun mobile (`390px`).
- Strategi fallback clipboard dan helper download file di browser yang ramah unit test `jsdom` (Vitest).
- Cakupan unit test TDD untuk:
  - `lib/domain/templates.ts` (semua 4 template lolos `validateWorkspaceData`, `solveScenario`, dan `applyStarterTemplate`).
  - `lib/export.ts` (format WA dengan/tanpa pembelian alternatif, CSV BOM & escaping).
  - `recomputeComparisonView` dan interaksi filter/role picker di `Comparison`.
  - `prepareSupplierOutageScenario` (termasuk batas `MAX_SCENARIOS`) dan aksi cepat di `SupplyNetwork`.
