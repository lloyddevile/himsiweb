const MUSTIKAPAY_BASE_URL = "https://mustikapayment.com";
const { getSupabaseProjectUrl, isSameOriginRequest, respond } = require("./http-utils");
const getActivityRegistrationPayment = require("./activity-registration-payment");
const callSupabaseRpc = require("./supabase-rpc");
const { getApiKeyMode, getTransaction: getZapayTransaction } = require("./zapay");

function isValidActivityGroupInviteUrl(value) {
    if (typeof value !== "string" || value !== value.trim()) {
        return false;
    }

    let url;
    try {
        url = new URL(value);
    } catch {
        return false;
    }
    if (url.protocol !== "https:" || url.username || url.password) {
        return false;
    }

    const segments = url.pathname.split("/").filter(Boolean);
    const isInviteCode = (code) => /^[A-Za-z0-9_-]+$/.test(code);
    if (url.hostname === "chat.whatsapp.com" || url.hostname === "discord.gg") {
        return segments.length === 1 && isInviteCode(segments[0]);
    }
    if (url.hostname === "discord.com") {
        return segments.length === 2 && segments[0] === "invite" && isInviteCode(segments[1]);
    }
    if (url.hostname === "t.me" || url.hostname === "telegram.me") {
        if (segments.length === 1) {
            return (
                /^\+[A-Za-z0-9_-]+$/.test(segments[0]) ||
                /^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(segments[0])
            );
        }
        return segments.length === 2 && segments[0] === "joinchat" && isInviteCode(segments[1]);
    }
    return false;
}

async function checkQrisStatus(apiKey, reference, expectedAmount) {
    const url = new URL("/api/v1/check/qris", MUSTIKAPAY_BASE_URL);
    url.searchParams.set("ref_no", reference);
    const upstream = await fetch(url, {
        headers: { "X-Api-Key": apiKey },
    });

    let payload;
    try {
        payload = await upstream.json();
    } catch {
        payload = null;
    }

    const amount = Number(payload?.amount);
    const status = typeof payload?.status === "string" ? payload.status.toLowerCase() : "";
    if (
        !upstream.ok ||
        !payload ||
        payload.ref_no !== reference ||
        amount !== expectedAmount ||
        !["pending", "success", "expired"].includes(status)
    ) {
        const error = new Error("MustikaPay returned an invalid legacy QRIS status.");
        error.status = upstream.status;
        throw error;
    }
    return status;
}

async function getSupabaseRecord(projectUrl, serviceKey, table, filters, columns) {
    const url = new URL(`/rest/v1/${table}`, projectUrl.origin);
    url.searchParams.set("select", columns.join(","));
    for (const [field, value] of Object.entries(filters)) {
        url.searchParams.set(field, `eq.${value}`);
    }

    const upstream = await fetch(url, {
        headers: {
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
        },
    });

    let records;
    try {
        records = await upstream.json();
    } catch {
        records = null;
    }

    if (!upstream.ok || !Array.isArray(records) || records.length !== 1) {
        const error = new Error("Supabase could not load registered activity details.");
        error.status = upstream.status || 502;
        throw error;
    }

    return records[0];
}

async function getRegisteredDetails(projectUrl, serviceKey, orderId) {
    const registration = await getSupabaseRecord(
        projectUrl,
        serviceKey,
        "activity_registrations",
        { registration_token: orderId },
        ["name", "program", "semester", "whatsapp", "payment_amount", "activity_id"],
    );
    const activity = await getSupabaseRecord(
        projectUrl,
        serviceKey,
        "activities",
        { id: registration.activity_id },
        ["title", "event_date"],
    );
    const semester = Number(registration.semester);
    const amount = Number(registration.payment_amount);
    if (
        typeof registration.name !== "string" ||
        typeof registration.program !== "string" ||
        typeof registration.whatsapp !== "string" ||
        !Number.isInteger(semester) ||
        !Number.isInteger(amount) ||
        typeof activity.title !== "string"
    ) {
        const error = new Error("Supabase returned incomplete registered activity details.");
        error.status = 502;
        throw error;
    }

    return {
        participant: {
            name: registration.name,
            program: registration.program,
            semester,
            whatsapp: registration.whatsapp,
        },
        activity: {
            title: activity.title,
            event_date: activity.event_date,
        },
        amount,
    };
}

module.exports = async function handleActivityRegistrationConfirmation(req, res) {
    if (req.method !== "GET") {
        res.setHeader("Allow", "GET");
        return respond(res, 405, { error: "method_not_allowed" });
    }

    const host = req.headers.host;
    if (!isSameOriginRequest(req, { allowMissingOrigin: true })) {
        return respond(res, 403, { error: "origin_not_allowed" });
    }

    const orderId =
        req.query?.order_id || new URL(req.url, `https://${host}`).searchParams.get("order_id");
    if (typeof orderId !== "string" || !/^HMPS-[0-9a-f-]{36}$/.test(orderId)) {
        return respond(res, 400, { error: "invalid_order" });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceKey) {
        console.error(
            "Registration confirmation API is missing its Supabase environment configuration.",
        );
        return respond(res, 503, { error: "confirmation_unavailable" });
    }

    const projectUrl = getSupabaseProjectUrl(supabaseUrl);
    if (!projectUrl) {
        console.error("Registration confirmation API has an invalid Supabase URL.");
        return respond(res, 503, { error: "confirmation_unavailable" });
    }

    try {
        let payload = await callSupabaseRpc(
            projectUrl,
            serviceKey,
            "get_activity_registration_confirmation",
            { p_order_id: orderId },
        );
        if (!payload.ok) {
            return respond(res, 404, { error: "unknown_order" });
        }

        if (payload.status === "pending") {
            const paymentRecord = await getActivityRegistrationPayment(
                projectUrl,
                serviceKey,
                orderId,
            );
            if (!paymentRecord) {
                return respond(res, 404, { error: "unknown_order" });
            }
            if (paymentRecord.payment_mode === "sandbox") {
                return respond(res, 200, {
                    ok: true,
                    status: "pending",
                    whatsapp_group_link: null,
                    sandbox: true,
                });
            }

            const claim = await callSupabaseRpc(
                projectUrl,
                serviceKey,
                "claim_activity_registration_payment_check",
                { p_order_id: orderId },
            );
            if (!claim.ok) {
                return respond(res, 503, { error: "confirmation_unavailable" });
            }
            if (claim.should_check === true) {
                let transactionStatus;
                let transactionId = claim.transaction_id;
                if (claim.transaction_id === orderId) {
                    const apiKey = process.env.ZAPAY_API_KEY?.trim();
                    if (!apiKey || getApiKeyMode(apiKey) !== "live") {
                        console.error(
                            "Registration confirmation API does not have a live Zapay API key.",
                        );
                        return respond(res, 503, { error: "confirmation_unavailable" });
                    }

                    const transaction = await getZapayTransaction(
                        apiKey,
                        orderId,
                        Number(claim.amount),
                    );
                    transactionStatus = {
                        pending: "pending",
                        paid: "settled",
                        expired: "expired",
                        canceled: "cancelled",
                        failed: "failed",
                    }[transaction.status];
                } else {
                    const apiKey = process.env.MUSTIKAPAY_API_KEY?.trim();
                    if (!apiKey) {
                        console.error(
                            "Registration confirmation API is missing its legacy MustikaPay API key.",
                        );
                        return respond(res, 503, { error: "confirmation_unavailable" });
                    }

                    const qrisStatus = await checkQrisStatus(
                        apiKey,
                        claim.transaction_id,
                        Number(claim.amount),
                    );
                    transactionStatus = qrisStatus === "success" ? "settled" : qrisStatus;
                }

                if (transactionStatus !== "pending") {
                    const applied = await callSupabaseRpc(
                        projectUrl,
                        serviceKey,
                        "apply_activity_registration_payment",
                        {
                            p_order_id: orderId,
                            p_transaction_status: transactionStatus,
                            p_gross_amount: Number(claim.amount),
                            p_payment_type: "QRIS",
                            p_transaction_id: transactionId,
                        },
                    );
                    if (
                        !applied.ok &&
                        !["payment_mismatch", "duplicate_payment", "capacity_conflict"].includes(
                            applied.error,
                        )
                    ) {
                        return respond(res, 503, { error: "confirmation_unavailable" });
                    }
                    payload = await callSupabaseRpc(
                        projectUrl,
                        serviceKey,
                        "get_activity_registration_confirmation",
                        { p_order_id: orderId },
                    );
                    if (!payload.ok) {
                        return respond(res, 404, { error: "unknown_order" });
                    }
                }
            }
        }

        const groupLink =
            payload.status === "registered" &&
            isValidActivityGroupInviteUrl(payload.whatsapp_group_link)
                ? payload.whatsapp_group_link
                : null;
        const response = {
            ok: true,
            status: payload.status,
            whatsapp_group_link: groupLink,
        };
        if (payload.status === "registered") {
            try {
                Object.assign(response, await getRegisteredDetails(projectUrl, serviceKey, orderId));
                response.registration_details_available = true;
            } catch (error) {
                console.error("Registered activity details could not be loaded.", {
                    status: error.status,
                });
                response.registration_details_available = false;
            }
        }
        return respond(res, 200, response);
    } catch (error) {
        console.error("Activity registration confirmation could not be verified.", {
            status: error.status,
            code: error.code,
            providerCode: error.providerCode,
            providerMessage: error.providerMessage,
        });
        return respond(res, 502, { error: "confirmation_unavailable" });
    }
};
