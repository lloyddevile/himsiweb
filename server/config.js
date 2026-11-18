const { respond } = require("./http-utils");

module.exports = function handlePublicConfig(req, res) {
    if (req.method !== "GET") {
        res.setHeader("Allow", "GET");
        return respond(res, 405, { error: "method_not_allowed" });
    }

    const url = process.env.SUPABASE_URL;
    const anonKey = process.env.SUPABASE_ANON_KEY;
    if (!url || !anonKey) {
        return respond(res, 503, { error: "service_unavailable" });
    }

    return respond(res, 200, { url, anonKey });
};
