update public.members
set division = 'Pengurus Inti'
where lower(btrim(position)) in ('ketua umum', 'sekretaris umum', 'bendahara umum')
    and division <> 'Pengurus Inti';

update public.members
set division = 'Program Studi'
where lower(btrim(position)) in ('kepala program studi', 'sekretaris program studi')
    and division <> 'Program Studi';

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conrelid = 'public.members'::regclass
            and conname = 'members_organization_group_check'
    ) then
        alter table public.members
            add constraint members_organization_group_check
            check (
                (
                    lower(btrim(position)) not in (
                        'ketua umum',
                        'sekretaris umum',
                        'bendahara umum'
                    )
                    or division = 'Pengurus Inti'
                )
                and (
                    lower(btrim(position)) not in (
                        'kepala program studi',
                        'sekretaris program studi'
                    )
                    or division = 'Program Studi'
                )
            );
    end if;
end;
$$;
