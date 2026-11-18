<div align="center">

# 🌐 Website Resmi HMPS Sistem Informasi

**STMIK SZ NW Anjani**

Portal informasi organisasi dan sistem manajemen konten terpadu berbasis web untuk Himpunan Mahasiswa Program Studi Sistem Informasi.

![HTML5](https://img.shields.io/badge/HTML5-E34F26?style=for-the-badge&logo=html5&logoColor=white)
![CSS3](https://img.shields.io/badge/CSS3-1572B6?style=for-the-badge&logo=css3&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)
![Vercel](https://img.shields.io/badge/Vercel-000000?style=for-the-badge&logo=vercel&logoColor=white)
![Supabase](https://img.shields.io/badge/Supabase-3ECF8E?style=for-the-badge&logo=supabase&logoColor=white)

</div>

---

## ✨ Fitur Utama

- **Portal Publik** — Informasi profil himpunan, struktur pengurus, program kerja, berita kegiatan, banner kegiatan, pedoman organisasi, serta galeri dokumentasi.
- **Dashboard Admin** — Panel pengelolaan konten dinamis, pesan masuk, publikasi, arsip, hingga pengaturan mode tampilan website.
- **Keamanan & Autentikasi** — Login terproteksi menggunakan _Supabase Auth_ dengan hak akses berbasis tabel `public.admin_users`.
- **Dokumentasi per Kegiatan** — Folder media terpisah untuk setiap kegiatan, dengan tag tanggal dan dukungan gambar, PDF, video, serta dokumen Office (maksimal 10 MB per file).
- **Agenda Mendatang** — Daftar kegiatan terdekat berdasarkan tanggal yang dipublikasikan.
- **Pendaftaran Kegiatan** — Pendaftaran gratis dan pembayaran QRIS via Zapay, dengan verifikasi transaksi server-side.
- **Undangan Grup Peserta** — Link grup WhatsApp, Telegram, atau Discord hanya ditampilkan setelah pembayaran sukses dan tidak terekspos pada halaman publik sebelum peserta terdaftar.
- **Form Kontak Terintegrasi** — Dilengkapi validasi input serta pembatasan pengiriman (_rate limiting_) yang tersimpan langsung ke database.

---

## 📁 Struktur Proyek

```text
.
├── api/            # Entry point tipis untuk Vercel Functions
├── assets/         # Aset statis situs
├── js/             # JavaScript halaman frontend
├── page/           # Halaman publik dan dashboard admin
├── server/         # Handler backend dan helper HTTP/Supabase bersama
├── style/          # Stylesheet CSS
├── supabase/
│   └── migrations/ # Migrasi database
├── tests/          # Pengujian otomatis
├── .editorconfig   # Konvensi indentasi dan line ending
├── .env.example    # Template environment variables
├── vercel.json     # Konfigurasi routing dan deployment
└── README.md       # Dokumentasi proyek
```

Handler Vercel di `api/` meneruskan request ke implementasi di `server/`.
Helper HTTP dan pemanggilan RPC bersama berada di `server/http-utils.js` dan
`server/supabase-rpc.js`. Validasi link grup yang dipakai dashboard dan halaman
publik berada di `js/activity-registration-utils.js`; server tetap memvalidasi
ulang input sebelum memprosesnya.

---

## 🗺️ Struktur Halaman

| Halaman             | Path URL              | Deskripsi                                   |
| :------------------ | :-------------------- | :------------------------------------------ |
| **Beranda**         | `/page`               | Halaman utama portal informasi HMPS SI      |
| **Pedoman**         | `/page/pedoman.html`  | Dokumen dan pedoman administrasi organisasi |
| **Pengurus**        | `/page/pengurus.html` | Struktur kepengurusan aktif                 |
| **Dashboard Admin** | `/page/admin.html`    | Panel kontrol dan manajemen konten          |

---

## 🚀 Panduan Menjalankan Secara Lokal

### Prasyarat

Pastikan perangkat Anda sudah terpasang **Node.js**, **npm**, **Vercel CLI**, serta memiliki proyek aktif di **Supabase**.

### Langkah Instalasi

1. **Salin file konfigurasi environment:**

    ```bash
    cp .env.example .env.local
    ```

2. **Lengkapi variabel pada `.env.local`:**

    | Variabel                      | Keterangan                                                                               |
    | :---------------------------- | :--------------------------------------------------------------------------------------- |
    | `SUPABASE_URL`                | URL endpoint proyek Supabase                                                             |
    | `SUPABASE_ANON_KEY`           | Public Anon Key (pastikan RLS aktif)                                                     |
    | `SUPABASE_SERVICE_ROLE_KEY`   | Secret key server-side untuk endpoint admin dan kontak                                   |
    | `ADMIN_ACCOUNT_CREATOR_EMAIL` | Email admin utama yang diizinkan membuat akun admin                                      |
    | `ZAPAY_API_KEY`               | API key Zapay: awalan `zps_` untuk sandbox atau `zp_` untuk transaksi live (server-side) |
    | `MUSTIKAPAY_API_KEY`          | Key legacy, hanya diperlukan untuk transaksi MustikaPay lama yang masih pending          |

3. **Jalankan server pengembangan lokal:**
    ```bash
    vercel dev
    ```
    > **Catatan:** Akses aplikasi melalui URL lokal yang diberikan oleh Vercel CLI (hindari membuka file HTML secara langsung via `file://`).

### Format Kode

Gunakan aturan bersama di `.editorconfig` dan `.prettierrc.json`. Untuk merapikan JavaScript, CSS, HTML, JSON, dan Markdown:

```bash
npx --yes prettier --write "**/*.{js,cjs,css,html,json,md}"
```

Migrasi SQL mengikuti indentasi dan line ending yang sama.

---

## 📦 Panduan Deployment

### 1. Konfigurasi Database Supabase

Buka **SQL Editor** di dashboard Supabase dan jalankan skrip migrasi secara berurutan:

<details>
<summary><b>Klik untuk melihat urutan file migrasi SQL (17 file)</b></summary>
<br>

1. [`20261114000000_initial_schema.sql`](./supabase/migrations/20261114000000_initial_schema.sql)
2. [`20261114010000_site_mode.sql`](./supabase/migrations/20261114010000_site_mode.sql)
3. [`20261114020000_admin_audit_log.sql`](./supabase/migrations/20261114020000_admin_audit_log.sql)
4. [`20261114030000_media_upload_limit.sql`](./supabase/migrations/20261114030000_media_upload_limit.sql)
5. [`20261114040000_admin_delete_contact_messages.sql`](./supabase/migrations/20261114040000_admin_delete_contact_messages.sql)
6. [`20261115000000_site_maintenance_note.sql`](./supabase/migrations/20261115000000_site_maintenance_note.sql)
7. [`20261115010000_activity_media.sql`](./supabase/migrations/20261115010000_activity_media.sql)
8. [`20261115020000_member_position_rules.sql`](./supabase/migrations/20261115020000_member_position_rules.sql)
9. [`20261115030000_member_organization_groups.sql`](./supabase/migrations/20261115030000_member_organization_groups.sql)
10. [`20261116000000_activity_registrations.sql`](./supabase/migrations/20261116000000_activity_registrations.sql)
11. [`20261116010000_activity_registration_payments.sql`](./supabase/migrations/20261116010000_activity_registration_payments.sql)
12. [`20261116020000_activity_registration_mustikapay.sql`](./supabase/migrations/20261116020000_activity_registration_mustikapay.sql)
13. [`20261116030000_activity_registration_group_invites.sql`](./supabase/migrations/20261116030000_activity_registration_group_invites.sql)
14. [`20261116040000_activity_registration_group_invite_constraint.sql`](./supabase/migrations/20261116040000_activity_registration_group_invite_constraint.sql)
15. [`20261116050000_activity_registration_mustikapay_minimum.sql`](./supabase/migrations/20261116050000_activity_registration_mustikapay_minimum.sql)
16. [`20261116060000_current_members_2026.sql`](./supabase/migrations/20261116060000_current_members_2026.sql)
17. [`20261117000000_registration_timezone.sql`](./supabase/migrations/20261117000000_registration_timezone.sql)

</details>

**Pengaturan Autentikasi & Admin:**

- Nonaktifkan registrasi publik pada menu **Authentication → Settings**.
- Undang admin utama melalui _Supabase Auth_, lalu daftarkan UUID-nya:
    ```sql
    insert into public.admin_users (user_id)
    values ('UUID-USER-ADMIN');
    ```
- Tambahkan `ADMIN_ACCOUNT_CREATOR_EMAIL` pada Vercel dan isi `muhammadfatiha83@gmail.com`. Hanya akun terautentikasi dengan email ini yang dapat membuat akun admin baru dari dashboard.
- Atur mode pembayaran pada **Dashboard Admin → Kegiatan → Konfigurasi pembayaran**. Mode Live menggunakan `ZAPAY_API_KEY` berawalan `zp_` dari Environment Variables Vercel; key tidak disimpan atau ditampilkan di dashboard. Mode Sandbox tidak menghubungi Zapay dan tidak membuat QR sungguhan. Admin dapat menyelesaikan transaksi Sandbox lewat aksi simulasi pada daftar pendaftar; halaman peserta akan menampilkan popup konfirmasi yang sama. Mode tiap transaksi disimpan saat transaksi dibuat, jadi perubahan mode hanya berlaku untuk transaksi baru.
- Mode Sandbox dashboard adalah simulasi internal dan tidak memakai API key Zapay. Untuk menerima pembayaran nyata, pilih Live dan pastikan key `zp_` sudah dikonfigurasi di Vercel. Atur pembebanan biaya (`buyer` atau `seller`) di pengaturan project Zapay.
- Atur webhook project Zapay ke `https://<domain-produksi>/api/zapay-webhook`. Endpoint memverifikasi HMAC dan timestamp sebelum menerapkan status; pengecekan `statustransaksi` tetap digunakan sebagai cadangan. Jangan menandai pembayaran lunas dari redirect atau tampilan popup.
- `MUSTIKAPAY_API_KEY` hanya dipakai sementara untuk memeriksa transaksi MustikaPay lama yang mungkin masih pending.
- Sesuaikan **Site URL** dan **Redirect URLs** ke domain produksi (contoh: `https://nama-project.vercel.app/page/admin.html`).

### 2. Deploy ke Vercel

1. Impor repository GitHub ini ke dashboard Vercel dan biarkan **Root Directory** pada pengaturan default (`/`).
2. Masukkan seluruh _Environment Variables_ yang dibutuhkan pada menu pengaturan proyek Vercel.
3. Jalankan seluruh migrasi database, termasuk [migrasi mode pembayaran Sandbox](./supabase/migrations/20261118000000_payment_gateway_sandbox_mode.sql), sebelum deploy atau mengaktifkan konfigurasi pembayaran.

> ⚠️ **Keamanan:** Jangan pernah mengekspos `SUPABASE_SERVICE_ROLE_KEY` ke dalam kode frontend (HTML/JS) maupun menyimpannya ke repository Git.

### Akun Admin

Admin utama yang sudah terdaftar dapat membuat akun lain dari dashboard dengan username dan kata sandi (minimal 6 karakter). Pendaftaran publik tetap nonaktif. Akun baru login menggunakan username; sistem memetakannya ke identitas internal Supabase sehingga alamat email tidak diminta. Admin utama yang sudah ada tetap dapat menggunakan emailnya. Pastikan variabel `SUPABASE_SERVICE_ROLE_KEY` dan `ADMIN_ACCOUNT_CREATOR_EMAIL` terpasang di environment Vercel yang sesuai.

---

## 🛠️ Catatan & Pengujian

- **Keamanan RLS:** Pastikan _Row Level Security_ aktif pada seluruh tabel agar `SUPABASE_ANON_KEY` tetap aman digunakan di sisi klien.
- **Data Awal:** Foto ilustrasi bawaan dari Unsplash harap diganti dengan dokumentasi resmi organisasi sebelum publikasi.
- Dokumentasi yang diunggah ke folder kegiatan mengikuti status publikasi file dan kegiatan terkait. File hanya dapat diakses melalui URL bertanda tangan.
- **Menjalankan Pengujian:**
    ```bash
    node --test tests/*.test.cjs
    ```

---

## 👥 Kontributor

- [@Irfan-dev-glic](https://github.com/Irfan-dev-glic)
- [@Jirr1924](https://github.com/Jirr1924)

---

## 📄 Lisensi

Proyek ini dilisensikan di bawah [MIT License](./LICENSE).  
Copyright © 2026 **HMPS Sistem Informasi**.
