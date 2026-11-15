create table if not exists public.activity_media (
    id uuid primary key default gen_random_uuid(),
    activity_id uuid not null references public.activities (id) on delete cascade,
    storage_path text not null unique,
    file_name text not null check (
        char_length(btrim(file_name)) between 1 and 255
        and position('/' in file_name) = 0
        and position(chr(92) in file_name) = 0
    ),
    content_type text not null check (content_type in (
        'image/jpeg',
        'image/png',
        'image/webp',
        'application/pdf',
        'video/mp4',
        'video/webm',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    )),
    documented_on date not null default current_date,
    caption text not null default '' check (char_length(caption) <= 500),
    published boolean not null default false,
    archived_at timestamptz,
    created_at timestamptz not null default now()
);

create index if not exists activity_media_activity_date_idx
    on public.activity_media (activity_id, documented_on desc, created_at desc)
    where archived_at is null;

alter table public.activity_media enable row level security;
revoke all on table public.activity_media from public, anon, authenticated;
grant select on public.activity_media to anon, authenticated;
grant select, insert, update, delete on public.activity_media to authenticated;

drop policy if exists "Published activity media are public" on public.activity_media;
create policy "Published activity media are public"
    on public.activity_media for select to anon, authenticated
    using (
        (
            published
            and archived_at is null
            and exists (
                select 1 from public.activities
                where id = activity_media.activity_id
                    and published and archived_at is null
            )
        )
        or public.is_admin()
    );

drop policy if exists "Admins manage activity media" on public.activity_media;
create policy "Admins manage activity media"
    on public.activity_media for all to authenticated
    using (public.is_admin()) with check (public.is_admin());

drop trigger if exists audit_activity_media_changes on public.activity_media;
create trigger audit_activity_media_changes
    after insert or update or delete on public.activity_media
    for each row execute function public.log_admin_activity();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'hmpssi-media',
    'hmpssi-media',
    false,
    10485760,
    array[
        'image/jpeg',
        'image/png',
        'image/webp',
        'application/pdf',
        'video/mp4',
        'video/webm',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    ]
)
on conflict (id) do update
set file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Public can view published HMPS media" on storage.objects;
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
            or exists (
                select 1
                from public.activity_media
                join public.activities on activities.id = activity_media.activity_id
                where activity_media.storage_path = storage.objects.name
                    and activity_media.published
                    and activity_media.archived_at is null
                    and activities.published
                    and activities.archived_at is null
            )
        )
    );
