const crypto = require("node:crypto");
const {
    getRequestBody,
    getSupabaseProjectUrl,
    isSameOriginRequest,
    respond,
} = require("./http-utils");

const MAX_BODY_BYTES = 8192;

function validateContact(body) {
    if (!body || typeof body !== "object" || Array.isArray(body) || body.consent !== true) {
        return null;
    }

    const fields = ["name", "email", "subject", "message"];
    const limits = { name: 120, email: 254, subject: 160, message: 5000 };
    const values = {};

    for (const field of fields) {
        if (typeof body[field] !== "string") {
            return null;
        }

        values[field] = body[field].trim();
        if (!values[field] || values[field].length > limits[field]) {
            return null;
        }
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) {
        return null;
    }

    return values;
}

module.exports = async function handleContact(req, res) {
    if (req.method !== "POST") {
        res.setHeader("Allow", "POST");
        return respond(res, 405, { error: "method_not_allowed" });
    }

    const contentType = req.headers["content-type"] || "";
    if (!contentType.toLowerCase().startsWith("application/json")) {
        return respond(res, 415, { error: "unsupported_media_type" });
    }

    const contentLength = Number(req.headers["content-length"] || 0);
    if (contentLength > MAX_BODY_BYTES) {
        return respond(res, 413, { error: "request_too_large" });
    }

    if (!isSameOriginRequest(req)) {
        return respond(res, 403, { error: "origin_not_allowed" });
    }

    const contact = validateContact(getRequestBody(req));
    if (!contact) {
        return respond(res, 400, { error: "invalid_contact_details" });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceKey) {
        console.error("Contact API is missing its Supabase environment configuration.");
        return respond(res, 503, { error: "service_unavailable" });
    }

    const projectUrl = getSupabaseProjectUrl(supabaseUrl);
    if (!projectUrl) {
        console.error("Contact API has an invalid Supabase URL.");
        return respond(res, 503, { error: "service_unavailable" });
    }

    const forwardedFor = req.headers["x-forwarded-for"];
    const requesterAddress =
        typeof forwardedFor === "string"
            ? forwardedFor.split(",")[0].trim()
            : req.socket?.remoteAddress || "unknown";
    const requesterHash = crypto
        .createHmac("sha256", serviceKey)
        .update(requesterAddress)
        .digest("hex");

    try {
        const response = await fetch(`${projectUrl.origin}/rest/v1/rpc/submit_contact_message`, {
            method: "POST",
            headers: {
                apikey: serviceKey,
                Authorization: `Bearer ${serviceKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                p_name: contact.name,
                p_email: contact.email,
                p_subject: contact.subject,
                p_message: contact.message,
                p_requester_hash: requesterHash,
            }),
        });

        if (!response.ok) {
            let error;
            try {
                error = await response.json();
            } catch {
                error = null;
            }

            if (error?.code === "P0001" && error?.message === "rate limit exceeded") {
                return respond(res, 429, { error: "rate_limited" });
            }

            console.error("Supabase rejected a contact message.", { status: response.status });
            return respond(res, 502, { error: "message_not_saved" });
        }

        return respond(res, 201, { ok: true });
    } catch (error) {
        console.error("Contact API could not reach Supabase.", error);
        return respond(res, 502, { error: "message_not_saved" });
    }
};
