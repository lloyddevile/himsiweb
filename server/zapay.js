const API_BASE_URL = "https://zapay.zannmods.net/api/v1/";
const TRANSACTION_STATUSES = new Set(["pending", "paid", "expired", "canceled", "failed"]);

function getApiKeyMode(apiKey) {
    if (apiKey.startsWith("zps_")) {
        return "sandbox";
    }
    if (apiKey.startsWith("zp_")) {
        return "live";
    }
    return null;
}

function getZapayUrl(value, isPaymentLink = false) {
    if (typeof value !== "string") {
        return null;
    }

    try {
        const url = new URL(value);
        const isSafeUrl =
            url.protocol === "https:" &&
            url.hostname === "zapay.zannmods.net" &&
            !url.username &&
            !url.password;
        const isSafePaymentPath = !isPaymentLink || /^\/pay\/[A-Za-z0-9_-]+$/.test(url.pathname);
        return isSafeUrl && isSafePaymentPath ? url : null;
    } catch {
        return null;
    }
}

function getProviderErrorDetails(result, apiKey, payment = {}) {
    const providerError = result?.error;
    const providerCode =
        typeof providerError?.code === "string" && /^[A-Za-z0-9._-]{1,60}$/.test(providerError.code)
            ? providerError.code
            : undefined;
    let providerMessage =
        typeof providerError?.message === "string" ? providerError.message : undefined;

    if (providerMessage) {
        for (const sensitiveValue of [apiKey, payment.name, payment.activity_title]) {
            if (sensitiveValue) {
                providerMessage = providerMessage.split(sensitiveValue).join("[redacted]");
            }
        }
        providerMessage = providerMessage.replace(/[\r\n\t]+/g, " ").slice(0, 200);
    }

    return { providerCode, providerMessage };
}

async function requestZapay(apiKey, path, options, payment) {
    const upstream = await fetch(new URL(path.replace(/^\//, ""), API_BASE_URL), {
        ...options,
        headers: {
            "X-Api-Key": apiKey,
            ...options.headers,
        },
    });

    let result;
    try {
        result = await upstream.json();
    } catch {
        result = null;
    }

    if (
        !upstream.ok ||
        result?.success !== true ||
        !result.data ||
        typeof result.data !== "object"
    ) {
        const error = new Error("Zapay did not accept the payment request.");
        error.status = upstream.status;
        Object.assign(error, getProviderErrorDetails(result, apiKey, payment));
        throw error;
    }

    return result.data;
}

function validateTransaction(data, apiKey, orderId, expectedAmount) {
    const expectedMode = getApiKeyMode(apiKey);
    const amount = Number(data.amount);
    if (
        !expectedMode ||
        data.order_id !== orderId ||
        !Number.isInteger(amount) ||
        amount < 1000 ||
        amount > 10000000 ||
        (expectedAmount !== undefined && amount !== expectedAmount) ||
        !Number.isInteger(data.fee) ||
        data.fee < 0 ||
        !Number.isInteger(data.total) ||
        data.total < amount ||
        !["buyer", "seller"].includes(data.fee_bearer) ||
        data.method !== "qris" ||
        data.sandbox !== (expectedMode === "sandbox") ||
        !TRANSACTION_STATUSES.has(data.status)
    ) {
        const error = new Error("Zapay returned an invalid transaction.");
        error.status = 502;
        throw error;
    }
}

async function createQris(apiKey, payment) {
    const mode = getApiKeyMode(apiKey);
    if (!mode) {
        const error = new Error("Zapay API key has an unsupported format.");
        error.status = 503;
        throw error;
    }
    if (!Number.isInteger(payment.amount) || payment.amount < 1000 || payment.amount > 10000000) {
        const error = new Error("The activity fee is outside Zapay's QRIS limits.");
        error.status = 422;
        throw error;
    }

    const data = await requestZapay(
        apiKey,
        "/createtransaksi",
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                order_id: payment.order_id,
                amount: payment.amount,
                method: "qris",
                customer_name: payment.name.slice(0, 40),
                description: `Pendaftaran ${payment.activity_title}`.slice(0, 100),
                expire_minutes: 30,
            }),
        },
        payment,
    );

    validateTransaction(data, apiKey, payment.order_id, payment.amount);
    const qrUrl = getZapayUrl(data.payment?.qr_url);
    const paymentLink = getZapayUrl(data.pay_url, true);
    if (!qrUrl || !paymentLink || data.payment?.type !== "qris") {
        const error = new Error("Zapay returned incomplete QRIS payment details.");
        error.status = 502;
        throw error;
    }

    return {
        reference: payment.order_id,
        qrUrl: qrUrl.toString(),
        paymentLink: paymentLink.toString(),
        amount: data.amount,
        fee: data.fee,
        feeBearer: data.fee_bearer,
        total: data.total,
    };
}

async function getTransaction(apiKey, orderId, expectedAmount) {
    const path = `/statustransaksi?order_id=${encodeURIComponent(orderId)}`;
    const data = await requestZapay(apiKey, path, { method: "GET" });
    validateTransaction(data, apiKey, orderId, expectedAmount);
    return data;
}

module.exports = {
    createQris,
    getApiKeyMode,
    getTransaction,
    getZapayUrl,
};
