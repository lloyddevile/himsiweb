-- Gunakan tanggal WITA (Asia/Makassar) untuk menentukan apakah kegiatan sudah lewat,
-- supaya sesuai dengan tampilan form di situs (tanggal lokal pengunjung).
do $migration$
declare
    v_definition text;
begin
    select pg_get_functiondef(
        'public.submit_activity_registration(uuid, text, text, text, text, text, text)'::regprocedure
    )
    into v_definition;

    if v_definition is null then
        raise exception 'submit_activity_registration belum ada. Jalankan migrasi pendaftaran kegiatan terlebih dahulu.';
    end if;

    if position('current_date' in v_definition) = 0 then
        raise notice 'submit_activity_registration sudah tidak memakai current_date; tidak ada perubahan.';
        return;
    end if;

    v_definition := replace(
        v_definition,
        'current_date',
        '(statement_timestamp() at time zone ''Asia/Makassar'')::date'
    );
    execute v_definition;
end;
$migration$;
