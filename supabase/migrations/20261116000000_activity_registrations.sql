alter table public.activities
    add column if not exists registration_enabled boolean not null default false,
    add column if not exists registration_capacity integer;

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conrelid = 'public.activities'::regclass
            and conname = 'activities_registration_capacity_check'
    ) then
        alter table public.activities
            add constraint activities_registration_capacity_check
            check (registration_capacity is null or registration_capacity between 1 and 100000);
    end if;
end;
$$;

create table if not exists public.activity_registrations (
    id uuid primary key default gen_random_uuid(),
    activity_id uuid not null references public.activities (id) on delete cascade,
    name text not null check (char_length(btrim(name)) between 1 and 120),
    student_id text not null check (char_length(btrim(student_id)) between 2 and 40),
    email text not null check (char_length(btrim(email)) between 3 and 254),
    whatsapp text not null check (char_length(btrim(whatsapp)) between 8 and 24),
    consented_at timestamptz not null default now(),
    created_at timestamptz not null default now()
);

create unique index if not exists activity_registrations_unique_student_idx
    on public.activity_registrations (activity_id, lower(btrim(student_id)));
create unique index if not exists activity_registrations_unique_email_idx
    on public.activity_registrations (activity_id, lower(btrim(email)));
create index if not exists activity_registrations_activity_created_idx
    on public.activity_registrations (activity_id, created_at desc);

alter table public.activity_registrations enable row level security;
revoke all on table public.activity_registrations from public, anon, authenticated;
grant select, delete on table public.activity_registrations to authenticated;

drop policy if exists "Admins can view activity registrations" on public.activity_registrations;
create policy "Admins can view activity registrations"
    on public.activity_registrations for select to authenticated
    using (public.is_admin());

drop policy if exists "Admins can delete activity registrations" on public.activity_registrations;
create policy "Admins can delete activity registrations"
    on public.activity_registrations for delete to authenticated
    using (public.is_admin());

create table if not exists public.activity_registration_rate_limits (
    requester_hash text not null check (requester_hash ~ '^[0-9a-f]{64}$'),
    window_started_at timestamptz not null,
    submissions integer not null check (submissions > 0),
    primary key (requester_hash, window_started_at)
);

alter table public.activity_registration_rate_limits enable row level security;
revoke all on table public.activity_registration_rate_limits from public, anon, authenticated;
grant all on table public.activity_registration_rate_limits to service_role;

create or replace function public.submit_activity_registration(
    p_activity_id uuid,
    p_name text,
    p_student_id text,
    p_email text,
    p_whatsapp text,
    p_requester_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_activity public.activities%rowtype;
    v_window_started_at timestamptz := date_trunc('hour', statement_timestamp());
    v_submissions integer;
    v_registration_count bigint;
    v_registration_id uuid;
begin
    if p_requester_hash is null or p_requester_hash !~ '^[0-9a-f]{64}$' then
        return jsonb_build_object('ok', false, 'error', 'invalid_registration');
    end if;

    delete from public.activity_registration_rate_limits
    where window_started_at < v_window_started_at - interval '24 hours';

    insert into public.activity_registration_rate_limits as current_limit (
        requester_hash,
        window_started_at,
        submissions
    )
    values (p_requester_hash, v_window_started_at, 1)
    on conflict (requester_hash, window_started_at)
    do update set submissions = current_limit.submissions + 1
    returning submissions into v_submissions;

    if v_submissions > 5 then
        return jsonb_build_object('ok', false, 'error', 'rate_limited');
    end if;

    if p_activity_id is null
        or p_name is null or char_length(btrim(p_name)) not between 1 and 120
        or p_student_id is null or char_length(btrim(p_student_id)) not between 2 and 40
        or p_email is null or char_length(btrim(p_email)) not between 3 and 254
        or btrim(p_email) !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
        or p_whatsapp is null or char_length(btrim(p_whatsapp)) not between 8 and 24
        or char_length(regexp_replace(p_whatsapp, '[^0-9]', '', 'g')) not between 8 and 15
    then
        return jsonb_build_object('ok', false, 'error', 'invalid_registration');
    end if;

    select *
    into v_activity
    from public.activities
    where id = p_activity_id
    for update;

    if not found
        or not v_activity.published
        or v_activity.archived_at is not null
        or not v_activity.registration_enabled
        or v_activity.event_date is null
        or v_activity.event_date < current_date
    then
        return jsonb_build_object('ok', false, 'error', 'registration_closed');
    end if;

    if exists (
        select 1
        from public.activity_registrations
        where activity_id = p_activity_id
            and (
                lower(btrim(student_id)) = lower(btrim(p_student_id))
                or lower(btrim(email)) = lower(btrim(p_email))
            )
    ) then
        return jsonb_build_object('ok', false, 'error', 'already_registered');
    end if;

    select count(*)
    into v_registration_count
    from public.activity_registrations
    where activity_id = p_activity_id;

    if v_activity.registration_capacity is not null
        and v_registration_count >= v_activity.registration_capacity
    then
        return jsonb_build_object('ok', false, 'error', 'activity_full');
    end if;

    insert into public.activity_registrations (
        activity_id,
        name,
        student_id,
        email,
        whatsapp
    )
    values (
        p_activity_id,
        btrim(p_name),
        btrim(p_student_id),
        lower(btrim(p_email)),
        btrim(p_whatsapp)
    )
    returning id into v_registration_id;

    return jsonb_build_object('ok', true, 'registration_id', v_registration_id);
end;
$$;

revoke all on function public.submit_activity_registration(uuid, text, text, text, text, text)
    from public, anon, authenticated;
grant execute on function public.submit_activity_registration(uuid, text, text, text, text, text)
    to service_role;
