const { getSupabaseProjectUrl, respond } = require("./http-utils");

module.exports = async function handleSiteMode(req, res) {
    if (req.method !== "GET") {
        res.setHeader("Allow", "GET");
        return respond(res, 405, { error: "method_not_allowed" });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const anonKey = process.env.SUPABASE_ANON_KEY;
    if (!supabaseUrl || !anonKey) {
        return respond(res, 503, { error: "service_unavailable" });
    }

    const projectUrl = getSupabaseProjectUrl(supabaseUrl);
    if (!projectUrl) {
        console.error("Site mode API has an invalid Supabase URL.");
        return respond(res, 503, { error: "service_unavailable" });
    }

    const settingsUrl = new URL("/rest/v1/site_settings", projectUrl.origin);
    settingsUrl.searchParams.set("setting_key", "eq.website_mode");
    settingsUrl.searchParams.set("select", "setting_value,maintenance_note");

    try {
        const response = await fetch(settingsUrl, {
            headers: {
                apikey: anonKey,
                Authorization: `Bearer ${anonKey}`,
            },
            cache: "no-store",
        });
        if (!response.ok) {
            console.error("Supabase rejected the site mode request.", { status: response.status });
            return respond(res, 502, { error: "site_mode_unavailable" });
        }

        const rows = await response.json();
        const settings = Array.isArray(rows) ? rows[0] : null;
        const mode = settings?.setting_value;
        if (mode !== "public" && mode !== "maintenance") {
            console.error("Supabase returned an invalid website mode.");
            return respond(res, 502, { error: "site_mode_unavailable" });
        }

        const maintenanceNote =
            typeof settings.maintenance_note === "string"
                ? settings.maintenance_note.slice(0, 500)
                : "";
        return respond(res, 200, { mode, maintenanceNote });
    } catch (error) {
        console.error("Site mode API could not reach Supabase.", error);
        return respond(res, 502, { error: "site_mode_unavailable" });
    }
};
