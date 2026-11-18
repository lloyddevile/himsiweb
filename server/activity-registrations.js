const crypto = require("node:crypto");
const {
    getRequestBody,
    getSupabaseProjectUrl,
    isSameOriginRequest,
    respond,
} = require("./http-utils");
const callSupabaseRpc = require("./supabase-rpc");
const getActivityRegistrationPayment = require("./activity-registration-payment");
const { createQris, getApiKeyMode, getTransaction, getZapayUrl } = require("./zapay");

const MAX_BODY_BYTES = 8192;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MUSTIKAPAY_BASE_URL = "https://mustikapayment.com";

function validateRegistration(body) {
    if (!body || typeof body !== "object" || Array.isArray(body) || body.consent !== true) {
        return null;
    }

    const fields = ["name", "program", "semester", "whatsapp"];
    const limits = { name: 120, program: 120, semester: 2, whatsapp: 24 };
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

    if (
        !UUID_PATTERN.test(body.activity_id) ||
        !/^(?:[1-9]|1[0-4])$/.test(values.semester) ||
        !/^\+62[0-9 -]{8,16}$/.test(values.whatsapp)
    ) {
        return null;
    }

    const whatsappDigits = values.whatsapp.replace(/\D/g, "");
    if (whatsappDigits.length < 10 || whatsappDigits.length > 15) {
        return null;
    }

    values.activity_id = body.activity_id;
    values.semester = Number(values.semester);
    values.whatsapp = `+${whatsappDigits}`;
    return values;
}

function getMustikaPayUrl(value, pathname) {
    if (typeof value !== "string") {
        return null;
    }

    try {
        const url = new URL(value);
        return url.protocol === "https:" &&
            url.hostname === "mustikapayment.com" &&
            url.pathname === pathname
            ? url
            : null;
    } catch {
        return null;
    }
}

async function markPaymentFailed(projectUrl, serviceKey, orderId) {
    return callSupabaseRpc(projectUrl, serviceKey, "apply_activity_registration_payment", {
        p_order_id: orderId,
        p_transaction_status: "failed",
        p_gross_amount: null,
        p_payment_type: null,
        p_transaction_id: null,
    });
}

function getPublicError(error) {
    if (error === "invalid_registration") {
        return { status: 400, payload: { error } };
    }
    if (error === "rate_limited") {
        return { status: 429, payload: { error } };
    }
    if (
        error === "activity_full" ||
        error === "already_registered" ||
        error === "registration_closed" ||
        error === "payment_in_progress"
    ) {
        return { status: 409, payload: { error } };
    }
    return null;
}

module.exports = async function handleActivityRegistration(req, res) {
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

    const registration = validateRegistration(getRequestBody(req));
    if (!registration) {
        return respond(res, 400, { error: "invalid_registration" });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceKey) {
        console.error(
            "Activity registration API is missing its Supabase environment configuration.",
        );
        return respond(res, 503, { error: "registration_unavailable" });
    }

    const projectUrl = getSupabaseProjectUrl(supabaseUrl);
    if (!projectUrl) {
        console.error("Activity registration API has an invalid Supabase URL.");
        return respond(res, 503, { error: "registration_unavailable" });
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
        const orderId = `HMPS-${crypto.randomUUID()}`;
        const payload = await callSupabaseRpc(
            projectUrl,
            serviceKey,
            "submit_activity_registration",
            {
                p_activity_id: registration.activity_id,
                p_name: registration.name,
                p_program: registration.program,
                p_semester: String(registration.semester),
                p_whatsapp: registration.whatsapp,
                p_requester_hash: requesterHash,
                p_order_id: orderId,
            },
        );

        if (!payload.ok) {
            const publicError = getPublicError(payload.error);
            if (!publicError) {
                console.error("Supabase returned an unknown activity registration result.");
                return respond(res, 502, { error: "registration_not_saved" });
            }
            return respond(res, publicError.status, publicError.payload);
        }

        if (!payload.requires_payment) {
            return respond(res, 201, { ok: true, registered: true });
        }

        let paymentRecord;
        try {
            paymentRecord = await getActivityRegistrationPayment(
                projectUrl,
                serviceKey,
                payload.order_id,
            );
        } catch (error) {
            console.error("Supabase could not load the activity payment mode.", {
                status: error.status,
                code: error.code,
            });
            return respond(res, 503, { error: "payment_unavailable" });
        }
        if (!paymentRecord) {
            console.error("Supabase did not return the saved activity payment.");
            return respond(res, 503, { error: "payment_unavailable" });
        }

        if (paymentRecord.payment_mode === "sandbox") {
            return respond(res, 201, {
                ok: true,
                requires_payment: true,
                reused: payload.reused === true,
                sandbox: true,
                order_id: payload.order_id,
                amount: paymentRecord.amount,
                payment_deadline: payload.payment_deadline || null,
            });
        }

        if (payload.reused === true) {
            const legacyQrUrl = getMustikaPayUrl(payload.checkout_url, "/api/qr");
            if (legacyQrUrl) {
                const reference = legacyQrUrl.searchParams.get("ref_no");
                const paymentLink = reference
                    ? getMustikaPayUrl(
                          `${MUSTIKAPAY_BASE_URL}/pay/${encodeURIComponent(reference)}`,
                          `/pay/${reference}`,
                      )
                    : null;
                return respond(res, 201, {
                    ok: true,
                    requires_payment: true,
                    reused: true,
                    order_id: payload.order_id,
                    qr_url: legacyQrUrl.toString(),
                    payment_link: paymentLink?.toString() || null,
                });
            }

            const zapayQrUrl = getZapayUrl(payload.checkout_url);
            const apiKey = process.env.ZAPAY_API_KEY?.trim();
            if (!zapayQrUrl || getApiKeyMode(apiKey || "") !== "live") {
                console.error("A reused activity payment has invalid Zapay details.");
                return respond(res, 502, { error: "payment_unavailable" });
            }
            try {
                const transaction = await getTransaction(apiKey, payload.order_id);
                const paymentLink = getZapayUrl(transaction.pay_url, true);
                if (!paymentLink) {
                    throw new Error("Zapay returned an invalid payment link.");
                }
                return respond(res, 201, {
                    ok: true,
                    requires_payment: true,
                    reused: true,
                    order_id: payload.order_id,
                    amount: transaction.amount,
                    fee: transaction.fee,
                    fee_bearer: transaction.fee_bearer,
                    total: transaction.total,
                    qr_url: zapayQrUrl.toString(),
                    payment_link: paymentLink.toString(),
                });
            } catch (error) {
                console.error("Zapay could not restore a saved payment.", {
                    status: error.status,
                    providerCode: error.providerCode,
                    providerMessage: error.providerMessage,
                });
                return respond(res, 502, { error: "payment_unavailable" });
            }
        }

        const apiKey = process.env.ZAPAY_API_KEY?.trim();
        if (!apiKey || getApiKeyMode(apiKey) !== "live") {
            try {
                await markPaymentFailed(projectUrl, serviceKey, payload.order_id);
            } catch (error) {
                console.error(
                    "Supabase could not close a payment after missing gateway configuration.",
                    {
                        status: error.status,
                        code: error.code,
                    },
                );
            }
            console.error("Activity registration API does not have a live Zapay API key.");
            return respond(res, 503, { error: "payment_unavailable" });
        }

        try {
            const payment = await createQris(apiKey, {
                ...payload,
                order_id: payload.order_id,
                amount: Number(payload.amount),
                name: registration.name,
            });
            const saved = await callSupabaseRpc(
                projectUrl,
                serviceKey,
                "set_activity_registration_checkout",
                {
                    p_order_id: payload.order_id,
                    p_checkout_url: payment.qrUrl,
                    p_transaction_id: payment.reference,
                },
            );
            if (!saved.ok) {
                throw new Error("Supabase could not save the Zapay QRIS reference.");
            }
            return respond(res, 201, {
                ok: true,
                requires_payment: true,
                reused: false,
                order_id: payload.order_id,
                amount: payload.amount,
                fee: payment.fee,
                fee_bearer: payment.feeBearer,
                total: payment.total,
                qr_url: payment.qrUrl,
                payment_link: payment.paymentLink,
                payment_deadline: payload.payment_deadline,
            });
        } catch (error) {
            try {
                await markPaymentFailed(projectUrl, serviceKey, payload.order_id);
            } catch (closeError) {
                console.error("Supabase could not close a failed QRIS payment.", {
                    status: closeError.status,
                    code: closeError.code,
                });
            }
            console.error("Zapay QRIS payment could not be created.", {
                status: error.status,
                code: error.code,
                providerCode: error.providerCode,
                providerMessage: error.providerMessage,
            });
            return respond(res, 502, { error: "payment_unavailable" });
        }
    } catch (error) {
        const migrationMissing = error.code === "PGRST202" || error.code === "PGRST203";
        console.error("Activity registration API could not complete its server request.", {
            status: error.status,
            code: error.code,
        });
        return respond(res, migrationMissing ? 503 : 502, {
            error: migrationMissing ? "registration_unavailable" : "registration_not_saved",
        });
    }
};
