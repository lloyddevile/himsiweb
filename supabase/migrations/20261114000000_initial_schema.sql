create table if not exists public.admin_users (
    user_id uuid primary key references auth.users (id) on delete cascade,
    created_at timestamptz not null default now()
);

alter table public.admin_users enable row level security;
revoke all on table public.admin_users from public, anon, authenticated;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1
        from public.admin_users
        where user_id = auth.uid()
    );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

create table if not exists public.members (
    id uuid primary key default gen_random_uuid(),
    name text not null check (char_length(btrim(name)) between 1 and 120),
    position text not null check (char_length(btrim(position)) between 1 and 120),
    division text not null default 'Pengurus Harian',
    duties text not null default '',
    period text not null default '',
    photo_path text,
    sort_order integer not null default 0,
    is_featured boolean not null default false,
    published boolean not null default false,
    archived_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.programs (
    id uuid primary key default gen_random_uuid(),
    title text not null check (char_length(btrim(title)) between 1 and 160),
    description text not null default '',
    period text not null default '',
    sort_order integer not null default 0,
    published boolean not null default false,
    archived_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.activities (
    id uuid primary key default gen_random_uuid(),
    title text not null check (char_length(btrim(title)) between 1 and 160),
    description text not null default '',
    category text not null default 'Kegiatan',
    event_date date,
    cover_path text,
    sort_order integer not null default 0,
    published boolean not null default false,
    archived_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.gallery_photos (
    id uuid primary key default gen_random_uuid(),
    activity_id uuid references public.activities (id) on delete set null,
    storage_path text,
    image_url text,
    alt_text text not null check (char_length(btrim(alt_text)) between 1 and 160),
    caption text not null default '',
    sort_order integer not null default 0,
    published boolean not null default false,
    archived_at timestamptz,
    created_at timestamptz not null default now(),
    constraint gallery_photo_source check (
        (storage_path is not null and image_url is null)
        or (storage_path is null and image_url is not null)
    )
);

create table if not exists public.contact_messages (
    id uuid primary key default gen_random_uuid(),
    name text not null check (char_length(btrim(name)) between 1 and 120),
    email text not null check (char_length(email) between 3 and 254),
    subject text not null check (char_length(btrim(subject)) between 1 and 160),
    message text not null check (char_length(btrim(message)) between 1 and 5000),
    consented_at timestamptz not null default now(),
    is_read boolean not null default false,
    archived_at timestamptz,
    created_at timestamptz not null default now()
);

create table if not exists public.contact_rate_limits (
    requester_hash text not null check (requester_hash ~ '^[0-9a-f]{64}$'),
    window_started_at timestamptz not null,
    submissions integer not null check (submissions > 0),
    primary key (requester_hash, window_started_at)
);

create index if not exists members_public_order_idx
    on public.members (sort_order, name)
    where published and archived_at is null;
create index if not exists programs_public_order_idx
    on public.programs (sort_order, title)
    where published and archived_at is null;
create index if not exists activities_public_order_idx
    on public.activities (event_date desc nulls last, sort_order)
    where published and archived_at is null;
create index if not exists gallery_public_order_idx
    on public.gallery_photos (sort_order, created_at desc)
    where published and archived_at is null;
create index if not exists contact_messages_created_at_idx
    on public.contact_messages (created_at desc);

alter table public.members enable row level security;
alter table public.programs enable row level security;
alter table public.activities enable row level security;
alter table public.gallery_photos enable row level security;
alter table public.contact_messages enable row level security;
alter table public.contact_rate_limits enable row level security;

grant select on public.members, public.programs, public.activities, public.gallery_photos
    to anon, authenticated;
grant select, insert, update, delete on public.members, public.programs, public.activities, public.gallery_photos
    to authenticated;
grant select, update on public.contact_messages to authenticated;
grant all on public.contact_messages to service_role;
grant all on public.contact_rate_limits to service_role;

create policy "Published members are public"
    on public.members for select to anon, authenticated
    using ((published and archived_at is null) or public.is_admin());
create policy "Admins manage members"
    on public.members for all to authenticated
    using (public.is_admin()) with check (public.is_admin());

create policy "Published programs are public"
    on public.programs for select to anon, authenticated
    using ((published and archived_at is null) or public.is_admin());
create policy "Admins manage programs"
    on public.programs for all to authenticated
    using (public.is_admin()) with check (public.is_admin());

create policy "Published activities are public"
    on public.activities for select to anon, authenticated
    using ((published and archived_at is null) or public.is_admin());
create policy "Admins manage activities"
    on public.activities for all to authenticated
    using (public.is_admin()) with check (public.is_admin());

create policy "Published gallery photos are public"
    on public.gallery_photos for select to anon, authenticated
    using (
        (
            published
            and archived_at is null
            and (
                activity_id is null
                or exists (
                    select 1 from public.activities
                    where id = gallery_photos.activity_id
                        and published and archived_at is null
                )
            )
        )
        or public.is_admin()
    );
create policy "Admins manage gallery photos"
    on public.gallery_photos for all to authenticated
    using (public.is_admin()) with check (public.is_admin());

create policy "Admins view contact messages"
    on public.contact_messages for select to authenticated
    using (public.is_admin());
create policy "Admins update contact messages"
    on public.contact_messages for update to authenticated
    using (public.is_admin()) with check (public.is_admin());

create or replace function public.submit_contact_message(
    p_name text,
    p_email text,
    p_subject text,
    p_message text,
    p_requester_hash text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
    current_window timestamptz := date_trunc('hour', now());
    submission_count integer;
begin
    if p_requester_hash !~ '^[0-9a-f]{64}$' then
        raise exception 'invalid requester hash' using errcode = '22023';
    end if;

    delete from public.contact_rate_limits
    where window_started_at < current_window - interval '24 hours';

    insert into public.contact_rate_limits (requester_hash, window_started_at, submissions)
    values (p_requester_hash, current_window, 1)
    on conflict (requester_hash, window_started_at)
    do update set submissions = public.contact_rate_limits.submissions + 1
    returning submissions into submission_count;

    if submission_count > 5 then
        raise exception 'rate limit exceeded' using errcode = 'P0001';
    end if;

    insert into public.contact_messages (name, email, subject, message)
    values (btrim(p_name), btrim(p_email), btrim(p_subject), btrim(p_message));
end;
$$;

revoke all on function public.submit_contact_message(text, text, text, text, text)
    from public, anon, authenticated;
grant execute on function public.submit_contact_message(text, text, text, text, text)
    to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'hmpssi-media',
    'hmpssi-media',
    false,
    10485760,
    array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy "Public can view published HMPS media"
    on storage.objects for select to public
    using (
        bucket_id = 'hmpssi-media'
        and (
            public.is_admin()
            or exists (
                select 1 from public.members
                where photo_path = storage.objects.name and published and archived_at is null
            )
            or exists (
                select 1 from public.activities
                where cover_path = storage.objects.name and published and archived_at is null
            )
            or exists (
                select 1 from public.gallery_photos
                where storage_path = storage.objects.name and published and archived_at is null
            )
        )
    );
create policy "Admins upload HMPS media"
    on storage.objects for insert to authenticated
    with check (bucket_id = 'hmpssi-media' and public.is_admin());
create policy "Admins update HMPS media"
    on storage.objects for update to authenticated
    using (bucket_id = 'hmpssi-media' and public.is_admin())
    with check (bucket_id = 'hmpssi-media' and public.is_admin());
create policy "Admins delete HMPS media"
    on storage.objects for delete to authenticated
    using (bucket_id = 'hmpssi-media' and public.is_admin());

insert into public.members
    (name, position, division, duties, period, sort_order, is_featured, published)
values
    ('IRPAN HAKIM', 'Ketua Umum', 'Pengurus Harian',
     'Koordinator utama operasional website; menetapkan visi dan misi pengembangan; mewakili HMPS SI di forum eksternal.',
     '2025/2026', 1, true, false),
    ('M. HADIS''SIBYAN', 'Sekretaris Umum', 'Pengurus Harian',
     'Pengganti ketua saat berhalangan; evaluasi kinerja divisi; koordinasi internal.',
     '2025/2026', 2, true, false),
    ('NURAFIVAH MALI''HATUN MA''WA AL MUHIB', 'Bendahara Umum', 'Pengurus Harian',
     'Pengelolaan anggaran website; laporan keuangan bulanan; perencanaan pengeluaran.',
     '2025/2026', 3, true, false),
    ('Rina Wijaya', 'Kepala Divisi Konten & Informasi', 'Konten & Informasi',
     'Perencanaan dan penulisan konten; optimasi SEO; pengelolaan kalender publikasi.',
     '2025/2026', 10, false, false),
    ('Andi Pratama', 'Penulis Konten', 'Konten & Informasi', '', '2025/2026', 11, false, false),
    ('Dewi Lestari', 'Penulis Konten', 'Konten & Informasi', '', '2025/2026', 12, false, false),
    ('Fajar Nugroho', 'Editor', 'Konten & Informasi', '', '2025/2026', 13, false, false),
    ('M. Fatiha Farhan', 'Kepala Divisi Internal', 'Internal',
     'Mengelola administrasi internal; mengoordinasi kegiatan anggota; menjaga komunikasi antaranggota.',
     '2025/2026', 20, false, false),
    ('Ahmad Rizki', 'Staf Internal', 'Internal', '', '2025/2026', 21, false, false),
    ('Siti Nurhaliza', 'Staf Internal', 'Internal', '', '2025/2026', 22, false, false),
    ('Eko Suryanto', 'Kepala Divisi Pengembangan & IT', 'Pengembangan & IT',
     'Pengembangan dan pemeliharaan website; keamanan sistem; integrasi fitur baru.',
     '2025/2026', 30, false, false),
    ('Gita Maharani', 'Frontend Developer', 'Pengembangan & IT', '', '2025/2026', 31, false, false),
    ('Hendra Kusuma', 'Backend Developer', 'Pengembangan & IT', '', '2025/2026', 32, false, false),
    ('Indah Permata', 'UI/UX Designer', 'Pengembangan & IT', '', '2025/2026', 33, false, false),
    ('Bagas Pratama', 'Kepala Divisi Humas & Eksternal', 'Humas & Eksternal',
     'Mengelola hubungan eksternal; publikasi kegiatan HMPS SI; kerja sama dengan pihak eksternal.',
     '2025/2026', 40, false, false),
    ('Rizki Amelia', 'Staf Humas', 'Humas & Eksternal', '', '2025/2026', 41, false, false),
    ('Fajar Santoso', 'Staf Humas', 'Humas & Eksternal', '', '2025/2026', 42, false, false),
    ('Dinda Putri', 'Staf Humas', 'Humas & Eksternal', '', '2025/2026', 43, false, false);

insert into public.activities
    (title, description, category, event_date, sort_order, published, archived_at)
values
    ('Seminar Nasional Teknologi Informasi',
     'Seminar nasional dengan pembicara dari industri teknologi membahas tren terkini dalam dunia IT.',
     'Seminar', '2023-11-15', 1, false, now()),
    ('Workshop Web Development',
     'Workshop pembelajaran pengembangan web modern untuk meningkatkan keterampilan mahasiswa.',
     'Workshop', '2023-11-22', 2, false, now()),
    ('Lomba Programming Tingkat Provinsi',
     'Kompetisi programming antar mahasiswa se-NTB untuk mengasah algoritma dan pemecahan masalah.',
     'Kompetisi', '2023-12-05', 3, false, now()),
    ('Bakti Sosial', 'Dokumentasi kegiatan sosial yang tercatat pada galeri lama.',
     'Sosial', '2023-10-01', 4, false, now()),
    ('Guest Lecture Industry', 'Dokumentasi kuliah tamu industri yang tercatat pada galeri lama.',
     'Seminar', '2023-09-01', 5, false, now()),
    ('Workshop Mobile Apps', 'Dokumentasi workshop aplikasi mobile yang tercatat pada galeri lama.',
     'Workshop', '2023-08-01', 6, false, now());

insert into public.gallery_photos
    (activity_id, image_url, alt_text, caption, sort_order, published, archived_at)
select activities.id,
       photos.image_url,
       photos.alt_text,
       photos.caption,
       photos.sort_order,
       false,
       now()
from (values
    ('Seminar Nasional Teknologi Informasi', 'https://images.unsplash.com/photo-1540573133985-87b6da6d54a9?auto=format&fit=crop&w=1200&q=80', 'Foto ilustrasi seminar', 'Seminar Nasional TI 2023 — arsip', 1),
    ('Workshop Web Development', 'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=1200&q=80', 'Foto ilustrasi workshop', 'Workshop Web Development — arsip', 2),
    ('Lomba Programming Tingkat Provinsi', 'https://images.unsplash.com/photo-1552664730-d307ca884978?auto=format&fit=crop&w=1200&q=80', 'Foto ilustrasi kompetisi', 'Lomba Programming — arsip', 3),
    ('Guest Lecture Industry', 'https://images.unsplash.com/photo-1553877522-43269d4ea984?auto=format&fit=crop&w=1200&q=80', 'Foto ilustrasi seminar', 'Guest Lecture Industry — arsip', 4),
    ('Workshop Mobile Apps', 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&w=1200&q=80', 'Foto ilustrasi workshop', 'Workshop Mobile Apps — arsip', 5),
    ('Bakti Sosial', 'https://images.unsplash.com/photo-1529400971008-f566de0e6dfc?auto=format&fit=crop&w=1200&q=80', 'Foto ilustrasi kegiatan sosial', 'Bakti Sosial — arsip', 6)
) as photos(activity_title, image_url, alt_text, caption, sort_order)
left join public.activities on activities.title = photos.activity_title;
