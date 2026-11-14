create table if not exists public.site_settings (
    setting_key text primary key check (setting_key = 'website_mode'),
    setting_value text not null check (setting_value in ('public', 'maintenance')),
    updated_at timestamptz not null default now()
);

alter table public.site_settings enable row level security;
revoke all on table public.site_settings from public, anon, authenticated;
grant select on public.site_settings to anon, authenticated;
grant update (setting_value, updated_at) on public.site_settings to authenticated;

drop policy if exists "Public can read website mode" on public.site_settings;
create policy "Public can read website mode"
    on public.site_settings for select to anon, authenticated
    using (setting_key = 'website_mode');

drop policy if exists "Admins update website mode" on public.site_settings;
create policy "Admins update website mode"
    on public.site_settings for update to authenticated
    using (public.is_admin())
    with check (public.is_admin());

insert into public.site_settings (setting_key, setting_value)
values ('website_mode', 'public')
on conflict (setting_key) do nothing;
