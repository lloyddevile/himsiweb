do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conrelid = 'public.activities'::regclass
            and conname = 'activities_paid_registration_fee_minimum_check'
    ) then
        alter table public.activities
            add constraint activities_paid_registration_fee_minimum_check
            check (registration_is_free or registration_fee >= 1000);
    end if;
end;
$$;
