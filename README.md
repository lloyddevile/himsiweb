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

* **Portal Publik** — Informasi profil himpunan, struktur pengurus, program kerja, berita kegiatan, pedoman organisasi, serta galeri dokumentasi.
* **Dashboard Admin** — Panel pengelolaan konten dinamis, pesan masuk, publikasi, arsip, hingga pengaturan mode tampilan website.
* **Keamanan & Autentikasi** — Login terproteksi menggunakan *Supabase Auth* dengan hak akses berbasis tabel `public.admin_users`.
* **Dokumentasi per Kegiatan** — Folder media terpisah untuk setiap kegiatan, dengan tag tanggal dan dukungan gambar, PDF, video, serta dokumen Office (maksimal 10 MB per file).
* **Agenda Mendatang** — Daftar kegiatan terdekat berdasarkan tanggal yang dipublikasikan.
* **Form Kontak Terintegrasi** — Dilengkapi validasi input serta pembatasan pengiriman (*rate limiting*) yang tersimpan langsung ke database.

---

## 📁 Struktur Proyek

```text
.
├── api/            # Endpoint Vercel Functions
├── js/             # JavaScript untuk halaman frontend
├── page/           # Halaman publik dan dashboard admin
├── server/         # Logika backend / server-side handler
├── style/          # File stylesheet CSS
├── supabase/
│   └── migrations/ # Skrip SQL migrasi database
├── tests/          # Pengujian otomatis (automated tests)
├── .env.example    # Template environment variables
├── vercel.json     # Konfigurasi routing & deployment Vercel
└── README.md       # Dokumentasi proyek
```

---

## 🗺️ Struktur Halaman

| Halaman | Path URL | Deskripsi |
| :--- | :--- | :--- |
| **Beranda** | `/page` | Halaman utama portal informasi HMPS SI |
| **Pedoman** | `/page/pedoman.html` | Dokumen dan pedoman administrasi organisasi |
| **Pengurus** | `/page/pengurus.html` | Struktur kepengurusan aktif |
| **Dashboard Admin** | `/page/admin.html` | Panel kontrol dan manajemen konten |

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

   | Variabel | Keterangan |
   | :--- | :--- |
   | `SUPABASE_URL` | URL endpoint proyek Supabase |
   | `SUPABASE_ANON_KEY` | Public Anon Key (pastikan RLS aktif) |
   | `SUPABASE_SERVICE_ROLE_KEY` | Secret key server-side untuk endpoint admin dan kontak |
   | `ADMIN_ACCOUNT_CREATOR_EMAIL` | Email admin utama yang diizinkan membuat akun admin |

3. **Jalankan server pengembangan lokal:**
   ```bash
   vercel dev
   ```
   > **Catatan:** Akses aplikasi melalui URL lokal yang diberikan oleh Vercel CLI (hindari membuka file HTML secara langsung via `file://`).

---

## 📦 Panduan Deployment

### 1. Konfigurasi Database Supabase
Buka **SQL Editor** di dashboard Supabase dan jalankan skrip migrasi secara berurutan:

<details>
<summary><b>Klik untuk melihat urutan file migrasi SQL (9 file)</b></summary>
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

</details>

**Pengaturan Autentikasi & Admin:**
* Nonaktifkan registrasi publik pada menu **Authentication → Settings**.
* Undang admin utama melalui *Supabase Auth*, lalu daftarkan UUID-nya:
  ```sql
  insert into public.admin_users (user_id)
  values ('UUID-USER-ADMIN');
  ```
* Tambahkan `ADMIN_ACCOUNT_CREATOR_EMAIL` pada Vercel dan isi `muhammadfatiha83@gmail.com`. Hanya akun terautentikasi dengan email ini yang dapat membuat akun admin baru dari dashboard.
* Sesuaikan **Site URL** dan **Redirect URLs** ke domain produksi (contoh: `https://nama-project.vercel.app/page/admin.html`).

### 2. Deploy ke Vercel
1. Impor repository GitHub ini ke dashboard Vercel dan biarkan **Root Directory** pada pengaturan default (`/`).
2. Masukkan keempat *Environment Variables* di atas pada menu pengaturan proyek Vercel.
3. Lakukan proses deploy setelah seluruh migrasi database selesai dijalankan.

> ⚠️ **Keamanan:** Jangan pernah mengekspos `SUPABASE_SERVICE_ROLE_KEY` ke dalam kode frontend (HTML/JS) maupun menyimpannya ke repository Git.

### Akun Admin

Admin utama yang sudah terdaftar dapat membuat akun lain dari dashboard dengan username dan kata sandi (minimal 12 karakter). Pendaftaran publik tetap nonaktif. Akun baru login menggunakan username; sistem memetakannya ke identitas internal Supabase sehingga alamat email tidak diminta. Admin utama yang sudah ada tetap dapat menggunakan emailnya. Pastikan variabel `SUPABASE_SERVICE_ROLE_KEY` dan `ADMIN_ACCOUNT_CREATOR_EMAIL` terpasang di environment Vercel yang sesuai.

---

## 🛠️ Catatan & Pengujian

* **Keamanan RLS:** Pastikan *Row Level Security* aktif pada seluruh tabel agar `SUPABASE_ANON_KEY` tetap aman digunakan di sisi klien.
* **Data Awal:** Foto ilustrasi bawaan dari Unsplash harap diganti dengan dokumentasi resmi organisasi sebelum publikasi.
* Dokumentasi yang diunggah ke folder kegiatan mengikuti status publikasi file dan kegiatan terkait. File hanya dapat diakses melalui URL bertanda tangan.
* **Menjalankan Pengujian:**
  ```bash
  node --test tests/*.test.cjs
  ```

---

## 👥 Kontributor

* [@Irfan-dev-glic](https://github.com/Irfan-dev-glic)
* [@Jirr1924](https://github.com/Jirr1924)

---

## 📄 Lisensi

Proyek ini dilisensikan di bawah [MIT License](./LICENSE).  
Copyright © 2026 **HMPS Sistem Informasi**.