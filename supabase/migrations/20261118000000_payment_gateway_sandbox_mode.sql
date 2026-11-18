create table if not exists public.payment_gateway_settings (
    singleton boolean primary key default true check (singleton),
    mode text not null default 'live' check (mode in ('live', 'sandbox')),
    updated_at timestamptz not null default now()
);

insert into public.payment_gateway_settings (singleton, mode)
values (true, 'live')
on conflict (singleton) do nothing;

alter table public.activity_registration_payments
    add column if not exists payment_mode text not null default 'live';

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conrelid = 'public.activity_registration_payments'::regclass
            and conname = 'activity_registration_payments_payment_mode_check'
    ) then
        alter table public.activity_registration_payments
            add constraint activity_registration_payments_payment_mode_check
            check (payment_mode in ('live', 'sandbox'));
    end if;
end;
$$;

alter table public.payment_gateway_settings enable row level security;
revoke all on table public.payment_gateway_settings from public, anon, authenticated;
grant select, update on table public.payment_gateway_settings to authenticated;
grant all on table public.payment_gateway_settings to service_role;

drop policy if exists "Admins read payment gateway settings"
    on public.payment_gateway_settings;
create policy "Admins read payment gateway settings"
    on public.payment_gateway_settings for select to authenticated
    using (public.is_admin());

drop policy if exists "Admins update payment gateway settings"
    on public.payment_gateway_settings;
create policy "Admins update payment gateway settings"
    on public.payment_gateway_settings for update to authenticated
    using (public.is_admin())
    with check (public.is_admin());

alter table public.activity_registration_payments enable row level security;
grant select on table public.activity_registration_payments to authenticated;

drop policy if exists "Admins read activity registration payments"
    on public.activity_registration_payments;
create policy "Admins read activity registration payments"
    on public.activity_registration_payments for select to authenticated
    using (public.is_admin());

create or replace function public.capture_activity_registration_payment_mode()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    select mode
    into new.payment_mode
    from public.payment_gateway_settings
    where singleton = true;

    if new.payment_mode is null then
        raise exception 'Payment gateway mode is not configured.';
    end if;

    if new.payment_mode = 'sandbox' then
        new.checkout_url := 'sandbox://pending/' || new.order_id;
    end if;

    return new;
end;
$$;

drop trigger if exists activity_registration_payment_mode_before_insert
    on public.activity_registration_payments;
create trigger activity_registration_payment_mode_before_insert
    before insert on public.activity_registration_payments
    for each row execute function public.capture_activity_registration_payment_mode();

revoke all on function public.capture_activity_registration_payment_mode()
    from public, anon, authenticated;

create or replace function public.simulate_activity_registration_payment(p_order_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_payment public.activity_registration_payments%rowtype;
    v_result jsonb;
begin
    if auth.uid() is null or not public.is_admin() then
        return jsonb_build_object('ok', false, 'error', 'forbidden');
    end if;

    if p_order_id is null or p_order_id !~ '^HMPS-[0-9a-f-]{36}$' then
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

    if v_payment.payment_mode <> 'sandbox' then
        return jsonb_build_object('ok', false, 'error', 'sandbox_mode_required');
    end if;

    if v_payment.status = 'settled' then
        return jsonb_build_object('ok', true, 'already_applied', true);
    end if;

    if v_payment.status <> 'pending' then
        return jsonb_build_object('ok', false, 'error', 'payment_not_pending');
    end if;

    if v_payment.expires_at <= statement_timestamp() then
        perform public.apply_activity_registration_payment(
            p_order_id,
            'expired',
            null,
            null,
            null
        );
        return jsonb_build_object('ok', false, 'error', 'payment_expired');
    end if;

    v_result := public.apply_activity_registration_payment(
        p_order_id,
        'settled',
        v_payment.amount,
        'Sandbox',
        'SANDBOX-' || p_order_id
    );
    return v_result;
end;
$$;

revoke all on function public.simulate_activity_registration_payment(text)
    from public, anon, authenticated;
grant execute on function public.simulate_activity_registration_payment(text)
    to authenticated;
