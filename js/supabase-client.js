window.hmpssiSupabaseReady = (async () => {
    const response = await fetch("/api/config");
    if (!response.ok) {
        throw new Error("Konfigurasi Supabase belum tersedia.");
    }

    const config = await response.json();
    if (!config.url || !config.anonKey || !window.supabase?.createClient) {
        throw new Error("Supabase belum dikonfigurasi dengan benar.");
    }

    return window.supabase.createClient(config.url, config.anonKey);
})();
