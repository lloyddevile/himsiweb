const crypto = require("node:crypto");
const { getSupabaseProjectUrl, respond } = require("./http-utils");
const getActivityRegistrationPayment = require("./activity-registration-payment");
const callSupabaseRpc = require("./supabase-rpc");
const { getApiKeyMode } = require("./zapay");

const MAX_BODY_BYTES = 65536;
const ORDER_ID_PATTERN = /^HMPS-[0-9a-f-]{36}$/i;
const EVENT_STATUS = {
    "payment.paid": { providerStatus: "paid", paymentStatus: "settled" },
    "payment.expired": { providerStatus: "expired", paymentStatus: "expired" },
    "payment.canceled": { providerStatus: "canceled", paymentStatus: "cancelled" },
    "payment.failed": { providerStatus: "failed", paymentStatus: "failed" },
};

function readRawBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let length = 0;
        let tooLarge = false;

        req.on("data", (chunk) => {
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            length += buffer.length;
            if (length > MAX_BODY_BYTES) {
                tooLarge = true;
                chunks.length = 0;
                return;
            }
            if (!tooLarge) {
                chunks.push(buffer);
            }
        });
        req.on("end", () => {
            if (tooLarge) {
                const error = new Error("Zapay webhook body is too large.");
                error.status = 413;
                reject(error);
                return;
            }
            resolve(Buffer.concat(chunks).toString("utf8"));
        });
        req.on("error", reject);
    });
}

function isValidSignature(rawBody, signature, apiKey) {
    if (typeof signature !== "string" || !/^[a-f0-9]{64}$/i.test(signature)) {
        return false;
    }

    const expected = crypto.createHmac("sha256", apiKey).update(rawBody).digest();
    const actual = Buffer.from(signature, "hex");
    return crypto.timingSafeEqual(actual, expected);
}

module.exports = async function handleZapayWebhook(req, res) {
    if (req.method !== "POST") {
        res.setHeader("Allow", "POST");
        return respond(res, 405, { error: "method_not_allowed" });
    }

    const contentType = req.headers["content-type"] || "";
    if (!contentType.toLowerCase().startsWith("application/json")) {
        return respond(res, 415, { error: "unsupported_media_type" });
    }

    const apiKey = process.env.ZAPAY_API_KEY?.trim();
    const mode = apiKey ? getApiKeyMode(apiKey) : null;
    if (!mode) {
        console.error("Zapay webhook is missing a valid API key.");
        return respond(res, 503, { error: "webhook_unavailable" });
    }

    try {
        const rawBody = await readRawBody(req);
        const signature = req.headers["x-zapay-signature"];
        if (!isValidSignature(rawBody, signature, apiKey)) {
            return respond(res, 403, { error: "invalid_signature" });
        }

        let event;
        try {
            event = JSON.parse(rawBody);
        } catch {
            return respond(res, 400, { error: "invalid_webhook" });
        }
        if (!event || typeof event !== "object" || Array.isArray(event)) {
            return respond(res, 400, { error: "invalid_webhook" });
        }

        const eventName = req.headers["x-zapay-event"];
        const headerMode = req.headers["x-zapay-mode"];
        const timestamp = Number(event.timestamp);
        if (
            event.event !== eventName ||
            headerMode !== mode ||
            !Number.isInteger(timestamp) ||
            Math.abs(Date.now() / 1000 - timestamp) > 600
        ) {
            return respond(res, 400, { error: "invalid_webhook" });
        }
        if (event.event === "payment.test") {
            return respond(res, 200, { ok: true });
        }

        const transition = Object.prototype.hasOwnProperty.call(EVENT_STATUS, event.event)
            ? EVENT_STATUS[event.event]
            : null;
        const data = event.data;
        if (
            !transition ||
            data?.status !== transition.providerStatus ||
            data?.method !== "qris" ||
            data?.sandbox !== (mode === "sandbox") ||
            !ORDER_ID_PATTERN.test(data?.order_id) ||
            !Number.isInteger(data?.amount) ||
            data.amount < 1000 ||
            data.amount > 10000000
        ) {
            return respond(res, 400, { error: "invalid_webhook" });
        }

        const supabaseUrl = process.env.SUPABASE_URL;
        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        const projectUrl = getSupabaseProjectUrl(supabaseUrl);
        if (!serviceKey || !projectUrl) {
            console.error("Zapay webhook is missing its Supabase configuration.");
            return respond(res, 503, { error: "webhook_unavailable" });
        }

        const payment = await getActivityRegistrationPayment(
            projectUrl,
            serviceKey,
            data.order_id,
        );
        if (!payment) {
            return respond(res, 404, { error: "unknown_order" });
        }
        if (payment.payment_mode !== mode || payment.amount !== data.amount) {
            return respond(res, 400, { error: "invalid_webhook" });
        }

        const applied = await callSupabaseRpc(
            projectUrl,
            serviceKey,
            "apply_activity_registration_payment",
            {
                p_order_id: data.order_id,
                p_transaction_status: transition.paymentStatus,
                p_gross_amount: transition.paymentStatus === "settled" ? data.amount : null,
                p_payment_type: "QRIS",
                p_transaction_id: data.order_id,
            },
        );
        if (
            !applied.ok &&
            !["payment_mismatch", "duplicate_payment", "capacity_conflict"].includes(applied.error)
        ) {
            console.error("Supabase could not apply a Zapay webhook event.", {
                code: applied.error,
            });
            return respond(res, 503, { error: "webhook_unavailable" });
        }

        return respond(res, 200, { ok: true });
    } catch (error) {
        console.error("Zapay webhook processing failed.", { status: error.status });
        return respond(res, error.status === 413 ? 413 : 503, {
            error: error.status === 413 ? "payload_too_large" : "webhook_unavailable",
        });
    }
};
