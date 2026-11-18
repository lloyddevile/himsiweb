alter table public.activity_registration_payments
    add column if not exists status_checked_at timestamptz;

drop function if exists public.set_activity_registration_checkout(text, text);

create or replace function public.set_activity_registration_checkout(
    p_order_id text,
    p_checkout_url text,
    p_transaction_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_updated integer;
begin
    if p_transaction_id is null or btrim(p_transaction_id) = '' then
        return jsonb_build_object('ok', false, 'error', 'invalid_transaction');
    end if;

    update public.activity_registration_payments
    set checkout_url = p_checkout_url,
        transaction_id = p_transaction_id,
        updated_at = statement_timestamp()
    where order_id = p_order_id
        and status = 'pending'
        and expires_at > statement_timestamp();

    get diagnostics v_updated = row_count;
    return jsonb_build_object('ok', v_updated = 1);
end;
$$;

revoke all on function public.set_activity_registration_checkout(text, text, text)
    from public, anon, authenticated;
grant execute on function public.set_activity_registration_checkout(text, text, text)
    to service_role;

create or replace function public.claim_activity_registration_payment_check(p_order_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_payment public.activity_registration_payments%rowtype;
begin
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

    if v_payment.status <> 'pending'
        or v_payment.transaction_id is null
        or coalesce(v_payment.status_checked_at, '-infinity'::timestamptz)
            > statement_timestamp() - interval '5 seconds'
    then
        return jsonb_build_object('ok', true, 'should_check', false);
    end if;

    update public.activity_registration_payments
    set status_checked_at = statement_timestamp(),
        updated_at = statement_timestamp()
    where id = v_payment.id;

    return jsonb_build_object(
        'ok', true,
        'should_check', true,
        'amount', v_payment.amount,
        'transaction_id', v_payment.transaction_id
    );
end;
$$;

revoke all on function public.claim_activity_registration_payment_check(text)
    from public, anon, authenticated;
grant execute on function public.claim_activity_registration_payment_check(text)
    to service_role;

create unique index if not exists activity_registration_payments_transaction_id_idx
    on public.activity_registration_payments (transaction_id)
    where transaction_id is not null;
