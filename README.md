# HMPS SI – Website Organization Portal

Website organisasi HMPS Sistem Informasi yang dirancang sebagai portal publik dan dashboard admin yang aman, responsif, dan mudah dikelola. Aplikasi ini menggabungkan halaman statis yang cepat, data dinamis dari Supabase, serta backend serverless di Vercel untuk menangani fitur-fitur sensitif seperti autentikasi admin dan form kontak.

## Overview

Proyek ini menyediakan:

- Halaman publik untuk menampilkan profil organisasi, anggota, program kerja, kegiatan, dan galeri.
- Dashboard admin yang hanya dapat diakses oleh pengguna yang diizinkan.
- Pengelolaan data berbasis Supabase dengan aturan keamanan Row Level Security (RLS).
- Penyimpanan media foto di Supabase Storage dengan kontrol akses yang aman.
- Endpoint API di Vercel untuk menangani form kontak tanpa mengekspos service role key ke frontend.

## Fitur Utama

- Halaman publik menampilkan anggota, program kerja, kegiatan, dan foto galeri yang diambil dari Supabase.
- Beranda hanya menampilkan Ketua Umum, Sekretaris Umum, dan Bendahara Umum.
- Halaman Anggota menampilkan seluruh anggota yang telah dipublikasikan.
- Admin dapat membuat, memperbarui, mempublikasikan, menyembunyikan, mengarsipkan, memulihkan, dan menghapus data secara permanen.
- Galeri foto diunggah ke Supabase Storage; saat foto dihapus, file media juga dihapus dari storage setelah konfirmasi.
- Form kontak disimpan di database Supabase dan hanya dapat dibaca oleh admin.
- Login admin menggunakan Supabase Auth email/password dengan pendaftaran publik dimatikan.
- Keamanan data dijaga dengan RLS, validasi input, serta kontrol akses berbasis UUID admin yang diizinkan.
- Halaman pedoman organisasi dapat diakses publik, sementara pengelolaan konten tetap dibatasi admin.

## Tech Stack

- Frontend: HTML, CSS, JavaScript
- Backend: Vercel Functions / Serverless API
- Database & auth: Supabase
- Storage: Supabase Storage
- Deployment: Vercel

## Struktur Proyek

```text
.
├── api/                 # Endpoint Vercel API
├── js/                  # JavaScript untuk halaman frontend
├── page/                # Halaman utama dan admin
├── server/              # Logic backend / server-side handler
├── style/               # File stylesheet
├── supabase/
│   └── migrations/      # SQL migration database
├── tests/               # Automated tests
├── README.md
├── vercel.json
└── .env.example         # Template environment variables
```

## Persiapan Supabase

1. Buat proyek baru di Supabase.
2. Buka area SQL Editor dan jalankan migrasi berikut secara berurutan:
   - [`supabase/migrations/20261114000000_initial_schema.sql`](./supabase/migrations/20261114000000_initial_schema.sql)
   - [`supabase/migrations/20261114010000_site_mode.sql`](./supabase/migrations/20261114010000_site_mode.sql)
   - [`supabase/migrations/20261114020000_admin_audit_log.sql`](./supabase/migrations/20261114020000_admin_audit_log.sql)
   - [`supabase/migrations/20261114030000_media_upload_limit.sql`](./supabase/migrations/20261114030000_media_upload_limit.sql)
   - [`supabase/migrations/20261114040000_admin_delete_contact_messages.sql`](./supabase/migrations/20261114040000_admin_delete_contact_messages.sql)
3. Di **Authentication → Settings**, nonaktifkan pendaftaran publik dan hanya mengizinkan akses melalui undangan admin.
4. Undang admin melalui Supabase Auth.
5. Salin UUID admin dari **Authentication → Users** dan daftarkan ke tabel `public.admin_users`:

```sql
insert into public.admin_users (user_id)
values ('UUID-USER-ADMIN');
```

6. Atur URL situs dan redirect URL undangan di pengaturan Supabase Auth agar mengarah ke domain Vercel, misalnya:

```text
https://domain-anda.vercel.app/page/admin.html
```

7. Setelah admin dapat login, tinjau data awal. Data lama dari halaman sebelumnya kemungkinan belum dipublikasikan; kegiatan lama juga bisa berada dalam status arsip. Foto lama yang berasal dari Unsplash hanya bersifat ilustrasi dan bukan dokumentasi resmi.
8. Perbarui data, unggah media asli, dan publikasikan konten hanya setelah data relevan selesai diperiksa.

## Persiapan Vercel

Impor repository ke Vercel lalu tambahkan environment variables berikut pada **Project Settings → Environment Variables**:

| Nama | Nilai | Tingkat Keamanan |
|---|---|---|
| `SUPABASE_URL` | URL project Supabase | Publik |
| `SUPABASE_ANON_KEY` | Publishable/anon key Supabase | Dapat dilihat di frontend; RLS wajib aktif |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key Supabase | Rahasia server-side; tidak boleh dipasang di frontend atau repository |

Catatan penting:

- `SUPABASE_SERVICE_ROLE_KEY` hanya digunakan oleh endpoint form kontak di Vercel.
- Akses dashboard admin tidak bergantung pada `user_metadata`; validasi dilakukan melalui tabel `public.admin_users`.
- RLS harus tetap aktif untuk setiap tabel.

## Struktur Halaman dan Routing

Path utama yang digunakan dalam deployment:

- `/page` → halaman beranda
- `/page/beranda.html` → homepage
- `/page/pedoman.html` → halaman pedoman organisasi
- `/page/pengurus.html` → daftar pengurus
- `/page/admin.html` → dashboard admin

Halaman publik dan admin berada pada folder `page/`, stylesheet di `style/`, dan script browser di `js/`.

Logika backend berada di `server/`, sedangkan adapter di `api/` menjaga kompatibilitas endpoint Vercel Functions. File PHP lama dan arsip data tidak digunakan dalam deployment ini.

## Menjalankan Secara Lokal

1. Salin file `.env.example` menjadi `.env.local`.
2. Isi ketiga variabel Supabase yang diperlukan.
3. Jalankan perintah berikut di root proyek:

```bash
vercel dev
```

4. Buka URL lokal yang ditampilkan oleh Vercel CLI.
5. Hindari membuka halaman secara langsung melalui `file://`, karena konfigurasi serta request API memerlukan server runtime.

## Dashboard Admin

Akses dashboard melalui `/page/admin.html` dengan akun admin yang sudah diundang dan terdaftar di `public.admin_users`.

Fungsi yang tersedia:

- **Anggota:** mengelola divisi, jabatan, foto, urutan tampilan, status featured, serta publikasi.
- **Program Kerja & Kegiatan:** mengelola konten dan status publikasi.
- **Galeri:** mengunggah hingga 10 foto per proses (format JPEG/PNG/WebP dengan maksimum 10 MB per file), menghubungkan foto dengan kegiatan, dan mempublikasikannya.
- **Pesan Masuk:** membaca pesan, menandai status dibaca/belum dibaca, arsipkan, pulihkan, atau hapus permanen.
- **Mode Website:** memilih status `Public` atau `Maintenance`.
- **Log Aktivitas:** melihat riwayat perubahan terbaru termasuk admin, objek, waktu, dan kolom yang diubah.

Data yang diarsipkan masih dapat dipulihkan. Penghapusan permanen memerlukan konfirmasi dan tidak dapat dibatalkan. Pembuatan admin baru, undangan admin, serta perubahan kebijakan RLS dilakukan melalui Supabase, bukan dari sisi frontend publik.

## Keamanan dan Operasional

- RLS harus tetap aktif pada seluruh tabel agar data tidak dapat diakses secara sembarangan.
- `anon` key bersifat publik dan tidak boleh dijadikan satu-satunya lapisan keamanan.
- Jangan pernah menambahkan `service_role` key ke halaman HTML, JavaScript frontend, atau commit repository.
- Form kontak dibatasi hingga 5 kiriman per alamat email per jam.
- Alamat IP tidak disimpan; pembatasan dilakukan menggunakan HMAC yang dibuat di fungsi Vercel.
- Database, admin dashboard, dan storage perlu disiapkan sebelum deployment ke lingkungan produksi.
- Bucket foto bersifat privat; URL yang ditandatangani hanya dapat dibuat untuk foto yang sudah dipublikasikan atau diakses oleh admin.

## Contributors

- [Irfan-dev-glic](https://github.com/Irfan-dev-glic)
- [Jirr1924](https://github.com/Jirr1924)

## Lisensi

Proyek ini dilisensikan di bawah [MIT License](./LICENSE).

Hak cipta sepenuhnya dimiliki oleh HMPS Sistem Informasi, 2026.
Semua hak cipta dilindungi undang-undang.

Dengan lisensi MIT, Anda diizinkan untuk menggunakan, menyalin, memodifikasi, menggabungkan, menerbitkan, mendistribusikan, mensublisensikan, dan/atau menjual salinan perangkat lunak ini, dengan ketentuan bahwa pemberitahuan hak cipta dan pernyataan lisensi ini harus selalu disertakan pada semua salinan atau sebagian besar material yang signifikan dari perangkat lunak ini.
