do $$
begin
    if exists (
        select 1
        from public.members
        where archived_at is null
            and lower(btrim(position)) in (
                'ketua umum',
                'sekretaris umum',
                'bendahara umum',
                'kepala program studi',
                'sekretaris program studi'
            )
        group by lower(btrim(position))
        having count(*) > 1
    ) then
        raise exception 'Duplicate active single-seat leadership positions exist. Archive or correct the duplicates before applying this migration.';
    end if;

    if exists (
        select 1
        from public.members
        where archived_at is null
            and lower(btrim(position)) like 'kepala divisi%'
        group by lower(btrim(division))
        having count(*) > 1
    ) then
        raise exception 'A division has multiple active heads. Archive or correct the duplicates before applying this migration.';
    end if;
end;
$$;

create unique index if not exists members_unique_core_role_idx
    on public.members (lower(btrim(position)))
    where archived_at is null
        and lower(btrim(position)) in (
            'ketua umum',
            'sekretaris umum',
            'bendahara umum',
            'kepala program studi',
            'sekretaris program studi'
        );

create unique index if not exists members_unique_kadiv_per_division_idx
    on public.members (lower(btrim(division)))
    where archived_at is null
        and lower(btrim(position)) like 'kepala divisi%';

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conrelid = 'public.members'::regclass
            and conname = 'members_supported_division_role_check'
    ) then
        alter table public.members
            add constraint members_supported_division_role_check
            check (
                lower(btrim(position)) not in ('kepala divisi', 'anggota divisi')
                or division in (
                    'Internal',
                    'Eksternal',
                    'Kesekretariatan',
                    'Pemberdayaan Perempuan',
                    'Medinfo (Media dan Informasi)'
                )
            );
    end if;
end;
$$;
