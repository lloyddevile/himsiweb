alter table public.activities
    add column if not exists registration_terms text not null default '',
    add column if not exists registration_is_free boolean not null default true,
    add column if not exists registration_fee integer not null default 0,
    add column if not exists registration_payment_deadline timestamptz;

create table if not exists public.activity_registration_private_settings (
    activity_id uuid primary key references public.activities (id) on delete cascade,
    whatsapp_group_link text check (
        whatsapp_group_link is null
        or whatsapp_group_link ~ '^https://chat\.whatsapp\.com/[A-Za-z0-9_-]+$'
    ),
    updated_at timestamptz not null default now()
);

alter table public.activity_registration_private_settings enable row level security;
revoke all on table public.activity_registration_private_settings from public, anon, authenticated;
grant select, insert, update, delete on public.activity_registration_private_settings to authenticated;
grant all on public.activity_registration_private_settings to service_role;

drop policy if exists "Admins manage activity registration private settings"
    on public.activity_registration_private_settings;
create policy "Admins manage activity registration private settings"
    on public.activity_registration_private_settings for all to authenticated
    using (public.is_admin())
    with check (public.is_admin());

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conrelid = 'public.activities'::regclass
            and conname = 'activities_registration_fee_check'
    ) then
        alter table public.activities
            add constraint activities_registration_fee_check
            check (registration_fee between 0 and 1000000000);
    end if;
end;
$$;

alter table public.activity_registrations
    alter column student_id drop not null,
    alter column email drop not null,
    add column if not exists program text not null default 'Sistem Informasi',
    add column if not exists semester smallint not null default 1,
    add column if not exists registration_token text,
    add column if not exists payment_amount integer not null default 0,
    add column if not exists payment_method text not null default 'free',
    add column if not exists terms_accepted_at timestamptz not null default now();

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conrelid = 'public.activity_registrations'::regclass
            and conname = 'activity_registrations_program_check'
    ) then
        alter table public.activity_registrations
            add constraint activity_registrations_program_check
            check (char_length(btrim(program)) between 1 and 120);
    end if;

    if not exists (
        select 1
        from pg_constraint
        where conrelid = 'public.activity_registrations'::regclass
            and conname = 'activity_registrations_semester_check'
    ) then
        alter table public.activity_registrations
            add constraint activity_registrations_semester_check
            check (semester between 1 and 14);
    end if;
end;
$$;

create unique index if not exists activity_registrations_registration_token_idx
    on public.activity_registrations (registration_token)
    where registration_token is not null;

create table if not exists public.activity_registration_payments (
    id uuid primary key default gen_random_uuid(),
    order_id text not null unique check (order_id ~ '^HMPS-[0-9a-f-]{36}$'),
    activity_id uuid not null references public.activities (id) on delete cascade,
    name text not null check (char_length(btrim(name)) between 1 and 120),
    program text not null check (char_length(btrim(program)) between 1 and 120),
    semester smallint not null check (semester between 1 and 14),
    whatsapp text not null check (char_length(btrim(whatsapp)) between 8 and 24),
    amount integer not null check (amount between 1 and 1000000000),
    status text not null default 'pending'
        check (status in ('pending', 'settled', 'expired', 'failed', 'cancelled', 'review')),
    checkout_url text,
    payment_type text,
    transaction_id text,
    consented_at timestamptz not null default now(),
    expires_at timestamptz not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    settled_at timestamptz
);

create unique index if not exists activity_registration_payments_pending_whatsapp_idx
    on public.activity_registration_payments (activity_id, regexp_replace(whatsapp, '[^0-9]', '', 'g'))
    where status = 'pending';
create index if not exists activity_registration_payments_expiry_idx
    on public.activity_registration_payments (expires_at)
    where status = 'pending';

alter table public.activity_registration_payments enable row level security;
revoke all on table public.activity_registration_payments from public, anon, authenticated;
grant all on table public.activity_registration_payments to service_role;

drop function if exists public.submit_activity_registration(uuid, text, text, text, text, text);
create function public.submit_activity_registration(
    p_activity_id uuid,
    p_name text,
    p_program text,
    p_semester text,
    p_whatsapp text,
    p_requester_hash text,
    p_order_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_activity public.activities%rowtype;
    v_existing_payment public.activity_registration_payments%rowtype;
    v_window_started_at timestamptz := date_trunc('hour', statement_timestamp());
    v_submissions integer;
    v_registration_count bigint;
    v_pending_payment_count bigint;
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
        or p_program is null or char_length(btrim(p_program)) not between 1 and 120
        or p_semester is null or p_semester !~ '^([1-9]|1[0-4])$'
        or p_whatsapp is null or char_length(btrim(p_whatsapp)) not between 8 and 24
        or p_whatsapp !~ '^\+62[0-9 -]{8,16}$'
        or char_length(regexp_replace(p_whatsapp, '[^0-9]', '', 'g')) not between 10 and 15
        or p_order_id is null or p_order_id !~ '^HMPS-[0-9a-f-]{36}$'
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
        or char_length(btrim(v_activity.registration_terms)) = 0
    then
        return jsonb_build_object('ok', false, 'error', 'registration_closed');
    end if;

    if exists (
        select 1
        from public.activity_registrations
        where activity_id = p_activity_id
            and (
                regexp_replace(whatsapp, '[^0-9]', '', 'g')
                    = regexp_replace(p_whatsapp, '[^0-9]', '', 'g')
            )
    ) then
        return jsonb_build_object('ok', false, 'error', 'already_registered');
    end if;

    update public.activity_registration_payments
    set status = 'expired',
        updated_at = statement_timestamp()
    where activity_id = p_activity_id
        and status = 'pending'
        and expires_at <= statement_timestamp();

    if not v_activity.registration_is_free then
        if v_activity.registration_fee < 1
            or v_activity.registration_payment_deadline is null
            or v_activity.registration_payment_deadline <= statement_timestamp()
        then
            return jsonb_build_object('ok', false, 'error', 'registration_closed');
        end if;

        select *
        into v_existing_payment
        from public.activity_registration_payments
        where activity_id = p_activity_id
            and status = 'pending'
            and expires_at > statement_timestamp()
            and (
                regexp_replace(whatsapp, '[^0-9]', '', 'g')
                    = regexp_replace(p_whatsapp, '[^0-9]', '', 'g')
            )
        for update;

        if found then
            if v_existing_payment.checkout_url is null then
                return jsonb_build_object('ok', false, 'error', 'payment_in_progress');
            end if;

            return jsonb_build_object(
                'ok', true,
                'requires_payment', true,
                'reused', true,
                'order_id', v_existing_payment.order_id,
                'checkout_url', v_existing_payment.checkout_url
            );
        end if;

        select count(*)
        into v_registration_count
        from public.activity_registrations
        where activity_id = p_activity_id;

        select count(*)
        into v_pending_payment_count
        from public.activity_registration_payments
        where activity_id = p_activity_id
            and status = 'pending'
            and expires_at > statement_timestamp();

        if v_activity.registration_capacity is not null
            and v_registration_count + v_pending_payment_count >= v_activity.registration_capacity
        then
            return jsonb_build_object('ok', false, 'error', 'activity_full');
        end if;

        insert into public.activity_registration_payments (
            order_id,
            activity_id,
            name,
            program,
            semester,
            whatsapp,
            amount,
            expires_at
        )
        values (
            p_order_id,
            p_activity_id,
            btrim(p_name),
            btrim(p_program),
            p_semester::smallint,
            btrim(p_whatsapp),
            v_activity.registration_fee,
            v_activity.registration_payment_deadline
        );

        return jsonb_build_object(
            'ok', true,
            'requires_payment', true,
            'reused', false,
            'order_id', p_order_id,
            'amount', v_activity.registration_fee,
            'activity_id', p_activity_id,
            'activity_title', v_activity.title,
            'payment_deadline', v_activity.registration_payment_deadline,
            'name', btrim(p_name),
            'whatsapp', btrim(p_whatsapp)
        );
    end if;

    if exists (
        select 1
        from public.activity_registration_payments
        where activity_id = p_activity_id
            and status = 'pending'
            and expires_at > statement_timestamp()
            and regexp_replace(whatsapp, '[^0-9]', '', 'g')
                = regexp_replace(p_whatsapp, '[^0-9]', '', 'g')
    ) then
        return jsonb_build_object('ok', false, 'error', 'payment_in_progress');
    end if;

    select count(*)
    into v_registration_count
    from public.activity_registrations
    where activity_id = p_activity_id;

    select count(*)
    into v_pending_payment_count
    from public.activity_registration_payments
    where activity_id = p_activity_id
        and status = 'pending'
        and expires_at > statement_timestamp();

    if v_activity.registration_capacity is not null
        and v_registration_count + v_pending_payment_count >= v_activity.registration_capacity
    then
        return jsonb_build_object('ok', false, 'error', 'activity_full');
    end if;

    insert into public.activity_registrations (
        activity_id,
        name,
        program,
        semester,
        whatsapp,
        registration_token,
        payment_amount,
        payment_method,
        terms_accepted_at
    )
    values (
        p_activity_id,
        btrim(p_name),
        btrim(p_program),
        p_semester::smallint,
        btrim(p_whatsapp),
        p_order_id,
        0,
        'free',
        statement_timestamp()
    )
    returning id into v_registration_id;

    return jsonb_build_object('ok', true, 'registration_id', v_registration_id);
end;
$$;

revoke all on function public.submit_activity_registration(uuid, text, text, text, text, text, text)
    from public, anon, authenticated;
grant execute on function public.submit_activity_registration(uuid, text, text, text, text, text, text)
    to service_role;

create or replace function public.set_activity_registration_checkout(
    p_order_id text,
    p_checkout_url text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_updated integer;
begin
    update public.activity_registration_payments
    set checkout_url = p_checkout_url,
        updated_at = statement_timestamp()
    where order_id = p_order_id
        and status = 'pending'
        and expires_at > statement_timestamp();

    get diagnostics v_updated = row_count;
    return jsonb_build_object('ok', v_updated = 1);
end;
$$;

revoke all on function public.set_activity_registration_checkout(text, text)
    from public, anon, authenticated;
grant execute on function public.set_activity_registration_checkout(text, text)
    to service_role;

create or replace function public.apply_activity_registration_payment(
    p_order_id text,
    p_transaction_status text,
    p_gross_amount numeric,
    p_payment_type text,
    p_transaction_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_payment public.activity_registration_payments%rowtype;
    v_activity public.activities%rowtype;
    v_activity_id uuid;
    v_registration_count bigint;
    v_pending_payment_count bigint;
    v_registration_id uuid;
begin
    if p_order_id is null
        or p_transaction_status not in ('settled', 'pending', 'expired', 'failed', 'cancelled')
    then
        return jsonb_build_object('ok', false, 'error', 'invalid_payment');
    end if;

    select activity_id
    into v_activity_id
    from public.activity_registration_payments
    where order_id = p_order_id;

    if not found then
        return jsonb_build_object('ok', false, 'error', 'unknown_order');
    end if;

    select *
    into v_activity
    from public.activities
    where id = v_activity_id
    for update;

    if not found then
        return jsonb_build_object('ok', false, 'error', 'unknown_order');
    end if;

    select *
    into v_payment
    from public.activity_registration_payments
    where order_id = p_order_id
    for update;

    if not found then
        return jsonb_build_object('ok', false, 'error', 'unknown_order');
    end if;

    if v_payment.status = 'settled' then
        return jsonb_build_object('ok', true, 'already_applied', true);
    end if;

    if p_transaction_status <> 'settled' then
        update public.activity_registration_payments
        set status = p_transaction_status,
            payment_type = coalesce(p_payment_type, payment_type),
            transaction_id = coalesce(p_transaction_id, transaction_id),
            updated_at = statement_timestamp()
        where id = v_payment.id;
        return jsonb_build_object('ok', true, 'registered', false);
    end if;

    if p_gross_amount is null
        or p_gross_amount <> v_payment.amount
        or p_payment_type is null
        or p_transaction_id is null
    then
        update public.activity_registration_payments
        set status = 'review',
            updated_at = statement_timestamp()
        where id = v_payment.id;
        return jsonb_build_object('ok', false, 'error', 'payment_mismatch');
    end if;

    if exists (
        select 1
        from public.activity_registrations
        where activity_id = v_payment.activity_id
            and regexp_replace(whatsapp, '[^0-9]', '', 'g')
                = regexp_replace(v_payment.whatsapp, '[^0-9]', '', 'g')
    ) then
        update public.activity_registration_payments
        set status = 'review',
            payment_type = p_payment_type,
            transaction_id = p_transaction_id,
            updated_at = statement_timestamp()
        where id = v_payment.id;
        return jsonb_build_object('ok', false, 'error', 'duplicate_payment');
    end if;

    select count(*)
    into v_registration_count
    from public.activity_registrations
    where activity_id = v_payment.activity_id;

    select count(*)
    into v_pending_payment_count
    from public.activity_registration_payments
    where activity_id = v_payment.activity_id
        and status = 'pending'
        and expires_at > statement_timestamp()
        and id <> v_payment.id;

    if v_activity.registration_capacity is not null
        and v_registration_count + v_pending_payment_count >= v_activity.registration_capacity
    then
        update public.activity_registration_payments
        set status = 'review',
            payment_type = p_payment_type,
            transaction_id = p_transaction_id,
            updated_at = statement_timestamp()
        where id = v_payment.id;
        return jsonb_build_object('ok', false, 'error', 'capacity_conflict');
    end if;

    insert into public.activity_registrations (
        activity_id,
        name,
        program,
        semester,
        whatsapp,
        registration_token,
        payment_amount,
        payment_method,
        terms_accepted_at
    )
    values (
        v_payment.activity_id,
        v_payment.name,
        v_payment.program,
        v_payment.semester,
        v_payment.whatsapp,
        v_payment.order_id,
        v_payment.amount,
        p_payment_type,
        v_payment.consented_at
    )
    returning id into v_registration_id;

    update public.activity_registration_payments
    set status = 'settled',
        payment_type = p_payment_type,
        transaction_id = p_transaction_id,
        settled_at = statement_timestamp(),
        updated_at = statement_timestamp()
    where id = v_payment.id;

    return jsonb_build_object('ok', true, 'registered', true, 'registration_id', v_registration_id);
exception
    when unique_violation then
        update public.activity_registration_payments
        set status = 'review',
            payment_type = p_payment_type,
            transaction_id = p_transaction_id,
            updated_at = statement_timestamp()
        where order_id = p_order_id;
        return jsonb_build_object('ok', false, 'error', 'duplicate_payment');
end;
$$;

revoke all on function public.apply_activity_registration_payment(text, text, numeric, text, text)
    from public, anon, authenticated;
grant execute on function public.apply_activity_registration_payment(text, text, numeric, text, text)
    to service_role;

create or replace function public.get_activity_registration_confirmation(p_order_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_payment public.activity_registration_payments%rowtype;
    v_group_link text;
begin
    if p_order_id is null or p_order_id !~ '^HMPS-[0-9a-f-]{36}$' then
        return jsonb_build_object('ok', false, 'error', 'unknown_order');
    end if;

    select *
    into v_payment
    from public.activity_registration_payments
    where order_id = p_order_id;

    if not found then
        return jsonb_build_object('ok', false, 'error', 'unknown_order');
    end if;

    if v_payment.status <> 'settled' then
        return jsonb_build_object('ok', true, 'status', v_payment.status);
    end if;

    if not exists (
        select 1
        from public.activity_registrations
        where registration_token = p_order_id
    ) then
        return jsonb_build_object('ok', true, 'status', 'cancelled');
    end if;

    select whatsapp_group_link
    into v_group_link
    from public.activity_registration_private_settings
    where activity_id = v_payment.activity_id;

    return jsonb_build_object(
        'ok', true,
        'status', 'registered',
        'whatsapp_group_link', v_group_link
    );
end;
$$;

revoke all on function public.get_activity_registration_confirmation(text)
    from public, anon, authenticated;
grant execute on function public.get_activity_registration_confirmation(text)
    to service_role;
