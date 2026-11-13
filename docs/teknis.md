# Dokumentasi Teknis

Dokumentasi arsitektur, penyimpanan data, perhitungan, mesin PDF, dan panduan pengembangan **Invoice Maker**.

---

## 1. Arsitektur Client-Side

Seluruh aplikasi berjalan di browser. Tidak ada backend, akun, atau database server; Cloudflare Workers hanya menyajikan file statis.

```
                 ┌──────────────────────────────────────────┐
                 │     UI (React 18 + React Router)         │
                 │  pages/ · components/                    │
                 └────┬──────────────────┬──────────────┬───┘
                      │                  │              │
        ┌─────────────▼──────┐  ┌────────▼────────┐  ┌──▼───────────────────┐
        │   Data (Dexie)     │  │   Mesin PDF     │  │  Pratinjau & thumb   │
        │ IndexedDB, live    │  │ @react-pdf,     │  │  PDF.js → canvas,    │
        │ query, backup JSON │  │ 14 layout       │  │  cache localStorage  │
        └────────────────────┘  └─────────────────┘  └──────────────────────┘
                                         │
                        ┌────────────────▼────────────────┐
                        │  Service Worker (Workbox / PWA) │
                        │  precache app, font & worker    │
                        └─────────────────────────────────┘
```

---

## 2. Peta Modul & Struktur Kode

| Modul | Lokasi | Fungsi |
|---|---|---|
| **Entry & Shell** | `src/main.tsx`, `src/App.tsx`, `src/components/layout.tsx` | Routing, sidebar desktop, tab bar mobile, tema, registrasi service worker. |
| **Halaman** | `src/pages/` | Daftar invoice/penawaran, editor, detail & pembayaran, **penagihan**, **invoice berulang**, klien, katalog, laporan, template, editor template, pengaturan. |
| **Data** | `src/db.ts` | Skema Dexie, buat/hapus/duplikat/revisi invoice & penawaran, penomoran per jenis dokumen, status turunan, riwayat penagihan, penjadwal invoice berulang. |
| **Tipe** | `src/types.ts` | Bentuk data invoice, penawaran, klien, produk, pengaturan, template, dan jadwal berulang. |
| **Template** | `src/templates.ts` | Daftar layout, font, palet, preset bawaan, dan `normalizeTemplate`. |
| **Mesin PDF** | `src/pdf/` | `context.ts` (konteks render), `parts.tsx` (komponen bersama), `layouts.tsx` & `layouts2.tsx` (14 layout), `document.tsx` (invoice & kwitansi), `fonts.ts`. |
| **Utilitas** | `src/lib/` | Uang & pajak, terbilang, penomoran, label dokumen, backup, file/share, data contoh, **analitik**, **penagihan**, **jadwal berulang**, dan **pesan/WhatsApp**. |
| **Komponen** | `src/components/` | Komponen UI, **chart SVG**, pratinjau PDF, thumbnail template, sketsa layout, **pad tanda tangan**, **kartu instal PWA**, **error boundary**. |

---

## 3. Data & Penyimpanan

Data disimpan di IndexedDB lewat Dexie (`invoice-maker`).

| Tabel | Kunci & indeks | Isi |
|---|---|---|
| `invoices` | `id, number, status, issueDate, dueDate, clientId, templateId, updatedAt` | Invoice lengkap dengan snapshot klien, item, pajak, dan pembayaran. |
| `clients` | `id, name, updatedAt` | Daftar klien. |
| `products` | `id, name, updatedAt` | Katalog produk & jasa. |
| `templates` | `id, name, updatedAt` | Template buatan pengguna (template bawaan ada di kode). |
| `settings` | `id` | Satu baris `app`: profil usaha, rekening, QRIS, default, penomoran invoice/kwitansi/penawaran. |
| `recurrences` | `id, nextRun, active, updatedAt` | Jadwal invoice berulang beserta snapshot template dokumen. |

- **Snapshot klien**: Invoice menyimpan salinan data klien, jadi mengubah atau menghapus klien tidak mengubah invoice lama.
- **Status turunan**: Yang disimpan hanya `draft | sent | void`. Status *dibayar sebagian*, *lunas*, *lewat tempo*, serta status penawaran *diterima*, *ditolak*, dan *kedaluwarsa* dihitung dari pembayaran, keputusan klien, dan tanggal (`deriveStatus`).
- **Autosave aman**: Editor menyimpan setelah 400 ms, lalu menyimpan sisa perubahan saat halaman ditutup, disembunyikan, atau ditinggal. Pembayaran, status, riwayat penagihan, dan status penawaran selalu diambil dari database saat menyimpan (`saveEditedInvoice`), sehingga editor tidak menimpa perubahan yang terjadi di tab lain.
- **Migrasi Dexie**: Versi 3 hanya menambah tabel `recurrences`; tidak ada transformasi data lama. Field baru pada invoice dan pengaturan bersifat opsional dan aman untuk data lama.
- **Kompatibilitas data lama**: Pengaturan dan template digabung dengan nilai default terbaru saat dibaca, jadi opsi baru tidak merusak data lama.
- **Backup**: Ekspor semua tabel ke satu file JSON. Mode *gabung* memilih versi record yang terakhir diubah dan mengambil nilai counter penomoran terbesar; perangkat yang profilnya masih kosong ikut mengambil profil usaha dari backup. Mode *ganti* menimpa seluruh data.

---

## 4. Perhitungan Uang & Pajak

Urutan perhitungan di `src/lib/money.ts` (`computeTotals`):

1. **Subtotal** = jumlah nilai bersih tiap item (qty × harga − diskon item).
2. **Diskon total** (persen atau nominal) dikurangkan dari subtotal.
3. **PPN**: mode *ditambahkan* menghitung pajak dari nilai setelah diskon; mode *sudah termasuk* memecah nilai itu menjadi DPP + PPN.
4. **PPh** dipotong dari DPP (dasar sebelum PPN), bukan dari total yang sudah termasuk PPN.
5. **Penyesuaian** (+/−) seperti ongkir atau potongan DP ditambahkan.
6. **Total tagihan**, lalu **sisa** = total − jumlah pembayaran.

- Pembulatan mengikuti desimal tampilan mata uang; IDR selalu tanpa sen.
- `parseNumber` menebak pemisah desimal dari teks, jadi angka hasil tempel dari Excel atau mutasi bank (`1,500,000` maupun `1.500.000,50`) terbaca benar.
- `terbilang` mendukung Bahasa Indonesia dan Inggris sampai triliun, termasuk sen untuk mata uang berdesimal.

---

## 5. Penomoran

- Pola memakai token `{YYYY}`, `{YY}`, `{MM}`, `{ROMAN}`, `{DD}`, `{SEQ:n}`, dan `{CLIENT}` (kode dari nama klien).
- Counter disimpan per periode (`yearly`, `monthly`, atau `never`) di pengaturan dan diambil di dalam transaksi Dexie, sehingga tidak ada nomor ganda.
- Menghapus invoice terbaru mengembalikan nomornya, supaya draft yang batal tidak meninggalkan celah.
- Saat tanggal invoice dipindah ke periode lain, nomor otomatis diambil dari periode baru (`renumberForDate`).
- Revisi memakai nomor asal dengan akhiran `-R1`, `-R2`, dan invoice lama ditandai batal.
- Kwitansi punya pola penomoran sendiri.
- Penawaran punya pola sendiri (default `QUO/{YYYY}/{MM}/{SEQ:3}`) dengan counter terpisah. Pembuatan, perubahan tanggal (`renumberForDate`), dan penghapusan memilih aturan berdasarkan field `kind` dokumen.

---

## 6. Alur Dokumen: Penawaran, Penagihan & Berulang

### Penawaran (quote)
- Penawaran memakai record `Invoice` yang sama dengan `kind: 'quote'`, jadi mesin total, template, PDF, dan backup langsung bekerja tanpa duplikasi.
- Status tersimpan tetap `draft | sent | void`; `quoteState` (`open | accepted | rejected`) dan tanggal kedaluwarsa (`dueDate`) menghasilkan status turunan `accepted | rejected | expired`.
- PDF penawaran memakai judul dari label `quoteTitle`, label tanggal `validUntil`, serta menyembunyikan blok rekening/QRIS dan cap LUNAS/BATAL.
- **Konversi**: `convertQuoteToInvoice` menyalin isi penawaran menjadi invoice bernomor `INV/...`, menandai penawaran `accepted`, dan menyimpan `convertedTo` untuk tautan dua arah.
- Penawaran tidak pernah masuk ke angka pendapatan, piutang, aging, atau rekap pajak.

### Pusat penagihan
- `src/lib/followup.ts` mengelompokkan invoice menjadi `overdue`, `due_soon` (≤ 3 hari), `stale` (tidak ditagih > 7 hari), dan `draft` siap kirim.
- Riwayat penagihan disimpan di invoice (`lastRemindedAt`, `remindCount`, `snoozeUntil`) dan dipertahankan oleh `saveEditedInvoice`.
- Aksi WhatsApp memakai template pesan pengingat yang sama dengan halaman invoice, lalu mencatat waktu penagihan.

### Invoice berulang
- Tabel `recurrences` menyimpan jadwal (`weekly | monthly | quarterly | yearly` + interval), tanggal mulai/berakhir, jatuh tempo, dan **snapshot** isi dokumen.
- `advance` memakai aritmetika UTC dengan jangkar tanggal asli, sehingga jadwal tanggal 31 menghasilkan 28/29 Februari lalu kembali ke 31 Maret.
- `runDueRecurrences` dipanggil saat aplikasi dibuka dan saat kembali dari background (maksimal sekali per menit). Setiap periode yang terlewat dibuat sebagai **draft**, bukan invoice terkirim, dengan nomor tetap mengikuti aturan penomoran.
- PWA tidak memiliki penjadwal latar belakang; copy UI menyatakan hal ini secara eksplisit. Guard module-level mencegah pembuatan ganda dari dua tab atau StrictMode.

---

## 7. Mesin PDF & Template

- PDF dibuat di browser dengan `@react-pdf/renderer` dan ditampilkan memakai PDF.js.
- `buildCtx` (`src/pdf/context.ts`) menyiapkan semua yang dibutuhkan layout: total, label (termasuk label kustom), format uang & tanggal, skala huruf, margin, sudut, dan ukuran kertas.
- Komponen bersama di `parts.tsx` (kepala usaha, blok klien, tabel item, total, pembayaran, tanda tangan, watermark) dipakai oleh semua layout, jadi opsi template berlaku seragam.
- **Gaya tabel** dari editor (garis, belang, kotak penuh, kepala berwarna, minimal) menggantikan gaya bawaan layout.
- **Ukuran kertas** A4, Letter, Legal, A5, dan F4 (215 × 330 mm, didefinisikan manual karena tidak ada di react-pdf).
- **Cap LUNAS/BATAL** diletakkan di ruang kosong di samping total dan tidak menambah tinggi halaman, sehingga invoice lunas tidak meluber ke halaman kedua.
- **Font**: Semua font dibundel lewat Fontsource dan didaftarkan ke react-pdf. Font standar PDF bawaan react-pdf (Helvetica, Times) gagal dimuat di bundel ini (`unitsPerEm` error), jadi pilihan Helvetica dan Times diarahkan ke Arimo dan Tinos yang metriknya identik.
- `normalizeTemplate` melengkapi template lama dengan opsi baru sebelum dirender.

---

## 8. Cache & PWA

- Service worker dibuat dengan `vite-plugin-pwa` mode `generateSW` dan `autoUpdate`. Shell aplikasi, font, dan worker PDF.js di-precache (batas 8 MB per file).
- Versi baru langsung aktif dan halaman dimuat ulang otomatis. Aplikasi juga mengecek pembaruan setiap jam dan setiap kali dibuka kembali dari background, supaya PWA yang terbuka berhari-hari tetap mendapat versi terbaru.
- **Thumbnail template** di-render sekali lalu disimpan di localStorage. Kuncinya memakai `virtual:render-version`, yaitu hash isi seluruh kode yang memengaruhi tampilan PDF (`src/pdf`, `src/lib`, `src/templates.ts`, `src/types.ts`, dan `package-lock.json`). Setiap perubahan pada file itu otomatis membuat hash baru dan membuang thumbnail lama, tanpa perlu menaikkan versi manual. Saat development, mengubah file tersebut memicu reload penuh.

---

## 9. Build & Deploy

### Kebutuhan lingkungan
- Node.js 22 atau lebih baru
- NPM

### Perintah

```bash
npm install
npm run dev        # dev server http://localhost:5173
npm run typecheck  # cek tipe TypeScript
npm run build      # type-check lalu build ke dist/
npm run preview    # pratinjau hasil build
npm run deploy     # build + deploy ke Cloudflare Workers
npm run icons      # buat ulang ikon PWA dari favicon.svg (butuh ImageMagick)
```

### Cloudflare Workers

```bash
npx wrangler login
npm run deploy
```

- `wrangler.jsonc` menyajikan `dist/` sebagai static assets dengan fallback SPA dan mengikat custom domain `invoice.solusikoding.com`.

---

## 10. Lisensi Font

Semua font dibundel dari [Fontsource](https://fontsource.org) dan memakai **SIL Open Font License 1.1**.

| Font | Jenis |
|---|---|
| Plus Jakarta Sans, Inter, IBM Plex Sans, Space Grotesk, Poppins, Montserrat, Outfit | Sans |
| Arimo (pengganti Helvetica) | Sans |
| Lora, Playfair Display, Fraunces, DM Serif Display | Serif |
| Tinos (pengganti Times) | Serif |
| JetBrains Mono, Space Mono | Monospace |
