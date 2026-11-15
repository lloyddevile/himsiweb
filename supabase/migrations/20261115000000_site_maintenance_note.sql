alter table public.site_settings
    add column if not exists maintenance_note text not null default ''
    check (char_length(maintenance_note) <= 500);

grant update (maintenance_note) on public.site_settings to authenticated;
