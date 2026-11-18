const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { Readable } = require("node:stream");
const { afterEach, test } = require("node:test");
const webhookHandler = require("../api/zapay-webhook");

const originalFetch = global.fetch;
const environmentKeys = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "ZAPAY_API_KEY"];
const originalEnvironment = Object.fromEntries(
    environmentKeys.map((key) => [key, process.env[key]]),
);

afterEach(() => {
    global.fetch = originalFetch;
    for (const key of environmentKeys) {
        if (originalEnvironment[key] === undefined) {
            delete process.env[key];
        } else {
            process.env[key] = originalEnvironment[key];
        }
    }
});

function makeResponse() {
    return {
        headers: {},
        statusCode: null,
        body: null,
        setHeader(name, value) {
            this.headers[name] = value;
        },
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(body) {
            this.body = body;
            return this;
        },
    };
}

function makeWebhookRequest(event, apiKey, overrides = {}) {
    const rawBody = JSON.stringify(event);
    const signature = crypto.createHmac("sha256", apiKey).update(rawBody).digest("hex");
    const request = Readable.from([Buffer.from(rawBody)]);
    request.method = "POST";
    request.headers = {
        "content-type": "application/json",
        "x-zapay-event": event?.event,
        "x-zapay-mode": "sandbox",
        "x-zapay-signature": signature,
        ...overrides.headers,
    };
    return request;
}

function paidEvent(timestamp = Math.floor(Date.now() / 1000)) {
    return {
        event: "payment.paid",
        timestamp,
        data: {
            order_id: "HMPS-9b2f3b2a-ff51-4e31-b22f-9f18fdb68a11",
            status: "paid",
            method: "qris",
            sandbox: true,
            amount: 25000,
        },
    };
}

test("Zapay webhook verifies its signature before settling the exact signed amount", async () => {
    const apiKey = "zps_test-secret";
    process.env.ZAPAY_API_KEY = apiKey;
    process.env.SUPABASE_URL = "https://project.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "server-secret";
    let requestOptions;
    global.fetch = async (url, options) => {
        const requestUrl = new URL(String(url));
        if (requestUrl.pathname === "/rest/v1/activity_registration_payments") {
            assert.equal(options.headers.apikey, "server-secret");
            assert.equal(
                requestUrl.searchParams.get("order_id"),
                "eq.HMPS-9b2f3b2a-ff51-4e31-b22f-9f18fdb68a11",
            );
            return new Response(
                JSON.stringify([
                    {
                        order_id: "HMPS-9b2f3b2a-ff51-4e31-b22f-9f18fdb68a11",
                        payment_mode: "sandbox",
                        amount: 25000,
                        status: "pending",
                    },
                ]),
                { status: 200 },
            );
        }
        assert.equal(
            url,
            "https://project.supabase.co/rest/v1/rpc/apply_activity_registration_payment",
        );
        requestOptions = options;
        return new Response(JSON.stringify({ ok: true, registered: true }), { status: 200 });
    };

    const response = makeResponse();
    await webhookHandler(makeWebhookRequest(paidEvent(), apiKey), response);

    assert.equal(response.statusCode, 200);
    assert.deepEqual(JSON.parse(requestOptions.body), {
        p_order_id: "HMPS-9b2f3b2a-ff51-4e31-b22f-9f18fdb68a11",
        p_transaction_status: "settled",
        p_gross_amount: 25000,
        p_payment_type: "QRIS",
        p_transaction_id: "HMPS-9b2f3b2a-ff51-4e31-b22f-9f18fdb68a11",
    });
});

test("Zapay webhook rejects an event mode that differs from the saved payment mode", async () => {
    const apiKey = "zps_test-secret";
    process.env.ZAPAY_API_KEY = apiKey;
    process.env.SUPABASE_URL = "https://project.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "server-secret";
    global.fetch = async (url) => {
        const requestUrl = new URL(String(url));
        assert.equal(requestUrl.pathname, "/rest/v1/activity_registration_payments");
        return new Response(
            JSON.stringify([
                {
                    order_id: "HMPS-9b2f3b2a-ff51-4e31-b22f-9f18fdb68a11",
                    payment_mode: "live",
                    amount: 25000,
                    status: "pending",
                },
            ]),
            { status: 200 },
        );
    };

    const response = makeResponse();
    await webhookHandler(makeWebhookRequest(paidEvent(), apiKey), response);

    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.body, { error: "invalid_webhook" });
});

test("Zapay webhook rejects invalid signatures before contacting Supabase", async () => {
    const apiKey = "zps_test-secret";
    process.env.ZAPAY_API_KEY = apiKey;
    const event = paidEvent();
    const request = makeWebhookRequest(event, apiKey);
    request.headers["x-zapay-signature"] = "0".repeat(64);
    global.fetch = async () => {
        throw new Error("Invalid webhook signatures must not call Supabase");
    };

    const response = makeResponse();
    await webhookHandler(request, response);

    assert.equal(response.statusCode, 403);
    assert.deepEqual(response.body, { error: "invalid_signature" });
});

test("Zapay webhook rejects timestamps outside the allowed replay window", async () => {
    const apiKey = "zps_test-secret";
    process.env.ZAPAY_API_KEY = apiKey;
    const event = paidEvent(Math.floor(Date.now() / 1000) - 601);
    global.fetch = async () => {
        throw new Error("Stale webhooks must not call Supabase");
    };

    const response = makeResponse();
    await webhookHandler(makeWebhookRequest(event, apiKey), response);

    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.body, { error: "invalid_webhook" });
});

test("Zapay webhook rejects an event mode that does not match the configured API key", async () => {
    const apiKey = "zps_test-secret";
    process.env.ZAPAY_API_KEY = apiKey;
    global.fetch = async () => {
        throw new Error("Mode-mismatched webhooks must not call Supabase");
    };

    const response = makeResponse();
    const request = makeWebhookRequest(paidEvent(), apiKey, {
        headers: { "x-zapay-mode": "live" },
    });
    await webhookHandler(request, response);

    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.body, { error: "invalid_webhook" });
});

test("Zapay test webhook is acknowledged without calling Supabase", async () => {
    const apiKey = "zps_test-secret";
    process.env.ZAPAY_API_KEY = apiKey;
    const event = {
        event: "payment.test",
        timestamp: Math.floor(Date.now() / 1000),
    };
    global.fetch = async () => {
        throw new Error("Test webhook events must not call Supabase");
    };

    const response = makeResponse();
    await webhookHandler(makeWebhookRequest(event, apiKey), response);

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, { ok: true });
});

test("Zapay webhook rejects a signed non-object event body", async () => {
    const apiKey = "zps_test-secret";
    process.env.ZAPAY_API_KEY = apiKey;
    global.fetch = async () => {
        throw new Error("Invalid webhook bodies must not call Supabase");
    };

    const response = makeResponse();
    await webhookHandler(makeWebhookRequest(null, apiKey), response);

    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.body, { error: "invalid_webhook" });
});
