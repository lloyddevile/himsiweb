create table if not exists public.admin_audit_logs (
    id uuid primary key default gen_random_uuid(),
    actor_user_id uuid references auth.users (id) on delete set null,
    actor_email text,
    action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
    entity_name text not null,
    record_id text,
    record_label text not null,
    changed_fields text[] not null default '{}'::text[],
    details text,
    created_at timestamptz not null default now()
);

create index if not exists admin_audit_logs_created_at_idx
    on public.admin_audit_logs (created_at desc);

alter table public.admin_audit_logs enable row level security;
revoke all on table public.admin_audit_logs from public, anon, authenticated;
grant select on public.admin_audit_logs to authenticated;

drop policy if exists "Admins can read audit logs" on public.admin_audit_logs;
create policy "Admins can read audit logs"
    on public.admin_audit_logs for select to authenticated
    using (public.is_admin());

create or replace function public.log_admin_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    actor_id uuid := auth.uid();
    old_row jsonb := '{}'::jsonb;
    new_row jsonb := '{}'::jsonb;
    changed_columns text[] := '{}'::text[];
    current_record_id text;
    current_record_label text;
    detail_text text;
begin
    if actor_id is null or not public.is_admin() then
        if tg_op = 'DELETE' then
            return old;
        end if;
        return new;
    end if;

    if tg_op in ('UPDATE', 'DELETE') then
        old_row := to_jsonb(old);
    end if;
    if tg_op in ('INSERT', 'UPDATE') then
        new_row := to_jsonb(new);
    end if;

    if tg_op = 'UPDATE' then
        if (old_row - 'updated_at') is not distinct from (new_row - 'updated_at') then
            return new;
        end if;

        select coalesce(array_agg(column_name order by column_name), '{}'::text[])
        into changed_columns
        from jsonb_object_keys(old_row) as old_columns(column_name)
        where old_row -> column_name is distinct from new_row -> column_name
            and column_name <> 'updated_at';
    end if;

    current_record_id := coalesce(
        new_row ->> 'id',
        old_row ->> 'id',
        new_row ->> 'setting_key',
        old_row ->> 'setting_key'
    );

    current_record_label := case tg_table_name
        when 'members' then coalesce(new_row ->> 'name', old_row ->> 'name', 'Anggota')
        when 'programs' then coalesce(new_row ->> 'title', old_row ->> 'title', 'Program kerja')
        when 'activities' then coalesce(new_row ->> 'title', old_row ->> 'title', 'Kegiatan')
        when 'gallery_photos' then coalesce(
            new_row ->> 'alt_text',
            old_row ->> 'alt_text',
            new_row ->> 'caption',
            old_row ->> 'caption',
            'Foto galeri'
        )
        when 'contact_messages' then coalesce(
            new_row ->> 'subject',
            old_row ->> 'subject',
            'Pesan masuk'
        )
        when 'site_settings' then 'Mode website'
        else tg_table_name
    end;

    if tg_table_name = 'site_settings' and tg_op = 'UPDATE' then
        detail_text := 'Mode: ' || (old_row ->> 'setting_value')
            || ' -> ' || (new_row ->> 'setting_value');
    elsif tg_op = 'UPDATE' then
        detail_text := 'Kolom berubah: ' || array_to_string(changed_columns, ', ');
    end if;

    insert into public.admin_audit_logs (
        actor_user_id,
        actor_email,
        action,
        entity_name,
        record_id,
        record_label,
        changed_fields,
        details
    )
    values (
        actor_id,
        nullif(auth.jwt() ->> 'email', ''),
        tg_op,
        tg_table_name,
        current_record_id,
        current_record_label,
        changed_columns,
        detail_text
    );

    if tg_op = 'DELETE' then
        return old;
    end if;
    return new;
end;
$$;

revoke all on function public.log_admin_activity() from public, anon, authenticated;

drop trigger if exists audit_members_changes on public.members;
create trigger audit_members_changes
    after insert or update or delete on public.members
    for each row execute function public.log_admin_activity();
drop trigger if exists audit_programs_changes on public.programs;
create trigger audit_programs_changes
    after insert or update or delete on public.programs
    for each row execute function public.log_admin_activity();
drop trigger if exists audit_activities_changes on public.activities;
create trigger audit_activities_changes
    after insert or update or delete on public.activities
    for each row execute function public.log_admin_activity();
drop trigger if exists audit_gallery_photos_changes on public.gallery_photos;
create trigger audit_gallery_photos_changes
    after insert or update or delete on public.gallery_photos
    for each row execute function public.log_admin_activity();
drop trigger if exists audit_contact_messages_changes on public.contact_messages;
create trigger audit_contact_messages_changes
    after insert or update or delete on public.contact_messages
    for each row execute function public.log_admin_activity();
drop trigger if exists audit_site_settings_changes on public.site_settings;
create trigger audit_site_settings_changes
    after insert or update or delete on public.site_settings
    for each row execute function public.log_admin_activity();
