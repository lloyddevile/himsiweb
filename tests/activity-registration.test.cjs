const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { afterEach, test } = require("node:test");
const crypto = require("node:crypto");
const registrationHandler = require("../api/activity-registrations");
const confirmationHandler = require("../api/activity-registration-confirmation");

const root = path.join(__dirname, "..");
const confirmationOrderId = "HMPS-9b2f3b2a-ff51-4e31-b22f-9f18fdb68a11";
const originalFetch = global.fetch;
const environmentKeys = [
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "ZAPAY_API_KEY",
    "MUSTIKAPAY_API_KEY",
];
const originalEnvironment = Object.fromEntries(
    environmentKeys.map((key) => [key, process.env[key]]),
);

afterEach(() => {
    global.fetch = originalFetch;
    environmentKeys.forEach((key) => {
        if (originalEnvironment[key] === undefined) {
            delete process.env[key];
        } else {
            process.env[key] = originalEnvironment[key];
        }
    });
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

function registeredDetailsResponse(url, options) {
    const requestUrl = new URL(String(url));
    const table = requestUrl.pathname.split("/").pop();
    if (!["activity_registrations", "activities"].includes(table)) {
        return null;
    }

    assert.equal(options.headers.apikey, "server-secret");
    assert.equal(options.headers.Authorization, "Bearer server-secret");
    if (table === "activity_registrations") {
        assert.equal(
            requestUrl.searchParams.get("select"),
            "name,program,semester,whatsapp,payment_amount,activity_id",
        );
        assert.equal(
            requestUrl.searchParams.get("registration_token"),
            `eq.${confirmationOrderId}`,
        );
        return new Response(
            JSON.stringify([
                {
                    name: "Dewi",
                    program: "Sistem Informasi",
                    semester: 3,
                    whatsapp: "+6281234567890",
                    payment_amount: 25000,
                    activity_id: "9b2f3b2a-ff51-4e31-b22f-9f18fdb68a11",
                },
            ]),
            { status: 200 },
        );
    }

    assert.equal(requestUrl.searchParams.get("select"), "title,event_date");
    assert.equal(
        requestUrl.searchParams.get("id"),
        "eq.9b2f3b2a-ff51-4e31-b22f-9f18fdb68a11",
    );
    return new Response(
        JSON.stringify([{ title: "Seminar SI", event_date: "2026-12-01" }]),
        { status: 200 },
    );
}

function activityPaymentRecordResponse(url, options, paymentMode = "live") {
    const requestUrl = new URL(String(url));
    if (requestUrl.pathname !== "/rest/v1/activity_registration_payments") {
        return null;
    }

    assert.equal(options.headers.apikey, "server-secret");
    assert.equal(options.headers.Authorization, "Bearer server-secret");
    assert.equal(
        requestUrl.searchParams.get("select"),
        "order_id,payment_mode,amount,status",
    );
    assert.equal(
        requestUrl.searchParams.get("order_id"),
        `eq.${confirmationOrderId}`,
    );
    return new Response(
        JSON.stringify([
            {
                order_id: confirmationOrderId,
                payment_mode: paymentMode,
                amount: 25000,
                status: "pending",
            },
        ]),
        { status: 200 },
    );
}

class TestElement {
    constructor(tagName) {
        this.tagName = tagName.toUpperCase();
        this.children = [];
        this.attributes = {};
        this.className = "";
        this.listeners = {};
        this.classList = {
            contains: (name) => this.className.split(/\s+/).includes(name),
            toggle: (name, force) => {
                const classes = new Set(this.className.split(/\s+/).filter(Boolean));
                const shouldAdd = force === undefined ? !classes.has(name) : force;
                if (shouldAdd) {
                    classes.add(name);
                } else {
                    classes.delete(name);
                }
                this.className = Array.from(classes).join(" ");
                return shouldAdd;
            },
        };
    }

    get textContent() {
        return `${this._text || ""}${this.children.map((child) => child.textContent).join("")}`;
    }

    set textContent(value) {
        this._text = String(value);
        this.children = [];
    }

    get childElementCount() {
        return this.children.length;
    }

    append(...elements) {
        elements.forEach((element) => {
            element.parentElement = this;
            this.children.push(element);
        });
    }

    prepend(...elements) {
        elements.forEach((element) => {
            element.parentElement = this;
        });
        this.children.unshift(...elements);
    }

    replaceChildren(...elements) {
        this.children = [];
        this._text = "";
        this.append(...elements);
    }

    querySelector(selector) {
        const matches = (element) =>
            selector.startsWith(".")
                ? element.classList.contains(selector.slice(1))
                : element.tagName.toLowerCase() === selector.toLowerCase();
        const find = (element) => {
            for (const child of element.children) {
                if (matches(child)) {
                    return child;
                }
                const nested = find(child);
                if (nested) {
                    return nested;
                }
            }
            return null;
        };
        return find(this);
    }

    setAttribute(name, value) {
        this.attributes[name] = value;
    }

    addEventListener(name, callback) {
        this.listeners[name] = callback;
    }

    showModal() {
        this.open = true;
    }

    close() {
        this.open = false;
        this.listeners.close?.();
    }

    remove() {
        this.removed = true;
    }
}

function loadPaymentConfirmationUi(fetch) {
    const source = fs.readFileSync(path.join(root, "js", "all-komponen.js"), "utf8");
    const declaration = (name) => {
        const match = source.match(new RegExp(`(?:async )?function ${name}\\([\\s\\S]*?\\n\\}`));
        assert.ok(match, `${name} declaration exists`);
        return match[0];
    };
    const document = {
        body: new TestElement("body"),
        createElement: (tagName) => new TestElement(tagName),
    };
    const context = {
        URL,
        URLSearchParams,
        Intl,
        document,
        fetch,
        window: { location: { search: "" } },
        setTimeout: async () => {},
        isValidActivityGroupInviteUrl: (value) => value === "https://chat.whatsapp.com/InviteCode123",
    };
    vm.runInNewContext(
        [
            declaration("node"),
            declaration("setStatus"),
            declaration("formatDate"),
            declaration("showActivityRegistrationSuccess"),
            declaration("showActivityPaymentConfirmation"),
            "globalThis.showActivityPaymentConfirmation = showActivityPaymentConfirmation;",
        ].join("\n"),
        context,
    );
    return { document, showConfirmation: context.showActivityPaymentConfirmation };
}

function registrationRequest(overrides = {}) {
    return {
        method: "POST",
        headers: {
            "content-type": "application/json",
            "content-length": "220",
            "x-forwarded-for": "203.0.113.8",
            host: "hmpssi.vercel.app",
            origin: "https://hmpssi.vercel.app",
        },
        body: {
            activity_id: "9b2f3b2a-ff51-4e31-b22f-9f18fdb68a11",
            name: "  Dewi  ",
            program: " Sistem Informasi ",
            semester: "3",
            whatsapp: "+62 812-3456-7890",
            consent: true,
        },
        ...overrides,
    };
}

test("activity registration validates consent and same-origin requests before calling Supabase", async () => {
    global.fetch = async () => {
        throw new Error("Supabase must not be called for invalid requests");
    };
    const invalid = makeResponse();
    await registrationHandler(
        registrationRequest({
            body: { ...registrationRequest().body, consent: false },
        }),
        invalid,
    );
    assert.equal(invalid.statusCode, 400);
    assert.equal(invalid.body.error, "invalid_registration");

    const invalidPhone = makeResponse();
    await registrationHandler(
        registrationRequest({
            body: { ...registrationRequest().body, whatsapp: "0812-3456-7890" },
        }),
        invalidPhone,
    );
    assert.equal(invalidPhone.statusCode, 400);

    const crossOrigin = makeResponse();
    await registrationHandler(
        registrationRequest({
            headers: {
                "content-type": "application/json",
                host: "hmpssi.vercel.app",
                origin: "https://attacker.example",
            },
        }),
        crossOrigin,
    );
    assert.equal(crossOrigin.statusCode, 403);
    assert.equal(crossOrigin.body.error, "origin_not_allowed");
});

test("free activity registration calls the server-only RPC with the configured participant fields", async () => {
    process.env.SUPABASE_URL = "https://project.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "server-secret";
    let requestOptions;
    global.fetch = async (url, options) => {
        requestOptions = { url, options };
        return new Response(
            JSON.stringify({
                ok: true,
                registration_id: "a1af3bf5-6d3c-4826-9d8c-d74ff79df119",
            }),
            { status: 200 },
        );
    };
    const response = makeResponse();

    await registrationHandler(registrationRequest(), response);

    assert.equal(response.statusCode, 201);
    assert.deepEqual(response.body, { ok: true, registered: true });
    assert.equal(response.headers["Cache-Control"], "no-store");
    assert.equal(
        requestOptions.url,
        "https://project.supabase.co/rest/v1/rpc/submit_activity_registration",
    );
    assert.equal(requestOptions.options.headers.apikey, "server-secret");
    const payload = JSON.parse(requestOptions.options.body);
    assert.equal(payload.p_name, "Dewi");
    assert.equal(payload.p_program, "Sistem Informasi");
    assert.equal(payload.p_semester, "3");
    assert.equal(payload.p_whatsapp, "+6281234567890");
    assert.match(payload.p_order_id, /^HMPS-[0-9a-f-]{36}$/);
    assert.equal(
        payload.p_requester_hash,
        crypto.createHmac("sha256", "server-secret").update("203.0.113.8").digest("hex"),
    );
});

test("activity registration maps full, duplicate, closed, and rate-limited results", async () => {
    process.env.SUPABASE_URL = "https://project.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "server-secret";
    for (const [error, status] of [
        ["activity_full", 409],
        ["already_registered", 409],
        ["registration_closed", 409],
        ["rate_limited", 429],
    ]) {
        global.fetch = async () =>
            new Response(JSON.stringify({ ok: false, error }), { status: 200 });
        const response = makeResponse();
        await registrationHandler(registrationRequest(), response);
        assert.equal(response.statusCode, status);
        assert.equal(response.body.error, error);
    }
});

test("paid activity registration creates and stores a Zapay QRIS before returning it", async () => {
    process.env.SUPABASE_URL = "https://project.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "server-secret";
    process.env.ZAPAY_API_KEY = "zp_live-secret";
    const calls = [];
    global.fetch = async (url, options) => {
        calls.push({ url: String(url), options });
        const paymentResponse = activityPaymentRecordResponse(url, options);
        if (paymentResponse) {
            return paymentResponse;
        }
        if (String(url).endsWith("/rpc/submit_activity_registration")) {
            return new Response(
                JSON.stringify({
                    ok: true,
                    requires_payment: true,
                    reused: false,
                    order_id: "HMPS-9b2f3b2a-ff51-4e31-b22f-9f18fdb68a11",
                    amount: 25000,
                    activity_title: "Seminar SI",
                    name: "Dewi",
                    payment_deadline: "2026-12-01T10:00:00Z",
                }),
                { status: 200 },
            );
        }
        if (String(url) === "https://zapay.zannmods.net/api/v1/createtransaksi") {
            assert.equal(options.headers["X-Api-Key"], "zp_live-secret");
            assert.equal(options.headers["Content-Type"], "application/json");
            assert.deepEqual(JSON.parse(options.body), {
                order_id: "HMPS-9b2f3b2a-ff51-4e31-b22f-9f18fdb68a11",
                amount: 25000,
                method: "qris",
                customer_name: "Dewi",
                description: "Pendaftaran Seminar SI",
                expire_minutes: 30,
            });
            return new Response(
                JSON.stringify({
                    success: true,
                    data: {
                        order_id: "HMPS-9b2f3b2a-ff51-4e31-b22f-9f18fdb68a11",
                        status: "pending",
                        method: "qris",
                        sandbox: false,
                        amount: 25000,
                        fee: 425,
                        fee_bearer: "buyer",
                        total: 25425,
                        pay_url: "https://zapay.zannmods.net/pay/PayToken123",
                        payment: {
                            type: "qris",
                            qr_url: "https://zapay.zannmods.net/api/qr/QRToken123",
                            expires_at: "2026-12-01 10:30:00",
                        },
                    },
                }),
                { status: 200 },
            );
        }
        if (String(url).endsWith("/rpc/set_activity_registration_checkout")) {
            assert.deepEqual(JSON.parse(options.body), {
                p_order_id: "HMPS-9b2f3b2a-ff51-4e31-b22f-9f18fdb68a11",
                p_checkout_url: "https://zapay.zannmods.net/api/qr/QRToken123",
                p_transaction_id: "HMPS-9b2f3b2a-ff51-4e31-b22f-9f18fdb68a11",
            });
            return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }
        throw new Error(`Unexpected request: ${url}`);
    };

    const response = makeResponse();
    await registrationHandler(registrationRequest(), response);

    assert.equal(response.statusCode, 201);
    assert.deepEqual(response.body, {
        ok: true,
        requires_payment: true,
        reused: false,
        order_id: "HMPS-9b2f3b2a-ff51-4e31-b22f-9f18fdb68a11",
        amount: 25000,
        fee: 425,
        fee_bearer: "buyer",
        total: 25425,
        qr_url: "https://zapay.zannmods.net/api/qr/QRToken123",
        payment_link: "https://zapay.zannmods.net/pay/PayToken123",
        payment_deadline: "2026-12-01T10:00:00Z",
    });
    assert.deepEqual(
        calls.map(({ url }) => url),
        [
            "https://project.supabase.co/rest/v1/rpc/submit_activity_registration",
            "https://project.supabase.co/rest/v1/activity_registration_payments?select=order_id%2Cpayment_mode%2Camount%2Cstatus&order_id=eq.HMPS-9b2f3b2a-ff51-4e31-b22f-9f18fdb68a11",
            "https://zapay.zannmods.net/api/v1/createtransaksi",
            "https://project.supabase.co/rest/v1/rpc/set_activity_registration_checkout",
        ],
    );
});

test("sandbox registration returns a local payment without requesting a Zapay QR", async () => {
    process.env.SUPABASE_URL = "https://project.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "server-secret";
    const calls = [];
    global.fetch = async (url, options) => {
        const urlText = String(url);
        calls.push(urlText);
        if (urlText.endsWith("/rpc/submit_activity_registration")) {
            return new Response(
                JSON.stringify({
                    ok: true,
                    requires_payment: true,
                    reused: false,
                    order_id: confirmationOrderId,
                    amount: 25000,
                }),
                { status: 200 },
            );
        }
        const paymentResponse = activityPaymentRecordResponse(urlText, options, "sandbox");
        if (paymentResponse) {
            return paymentResponse;
        }
        throw new Error(`Sandbox mode must not contact Zapay: ${urlText}`);
    };

    const response = makeResponse();
    await registrationHandler(registrationRequest(), response);

    assert.equal(response.statusCode, 201);
    assert.deepEqual(response.body, {
        ok: true,
        requires_payment: true,
        reused: false,
        sandbox: true,
        order_id: confirmationOrderId,
        amount: 25000,
        payment_deadline: null,
    });
    assert.equal(calls.length, 2);
    assert.equal(calls.some((url) => url.startsWith("https://zapay.")), false);
});

test("reused paid registration returns its saved MustikaPay QR without creating another transaction", async () => {
    process.env.SUPABASE_URL = "https://project.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "server-secret";
    const calls = [];
    global.fetch = async (url, options) => {
        calls.push({ url, options });
        const paymentResponse = activityPaymentRecordResponse(url, options);
        if (paymentResponse) {
            return paymentResponse;
        }
        return new Response(
            JSON.stringify({
                ok: true,
                requires_payment: true,
                reused: true,
                checkout_url:
                    "https://mustikapayment.com/api/qr?data=encoded&ref_no=QR123456&username=merchant",
                order_id: "HMPS-9b2f3b2a-ff51-4e31-b22f-9f18fdb68a11",
            }),
            { status: 200 },
        );
    };

    const response = makeResponse();
    await registrationHandler(registrationRequest(), response);

    assert.equal(response.statusCode, 201);
    assert.deepEqual(response.body, {
        ok: true,
        requires_payment: true,
        reused: true,
        order_id: "HMPS-9b2f3b2a-ff51-4e31-b22f-9f18fdb68a11",
        qr_url: "https://mustikapayment.com/api/qr?data=encoded&ref_no=QR123456&username=merchant",
        payment_link: "https://mustikapayment.com/pay/QR123456",
    });
    assert.equal(calls.length, 2);
    assert.equal(
        calls[0].url,
        "https://project.supabase.co/rest/v1/rpc/submit_activity_registration",
    );
});

test("reused Zapay registration restores the QR, checkout link, and buyer total", async () => {
    process.env.SUPABASE_URL = "https://project.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "server-secret";
    process.env.ZAPAY_API_KEY = "zp_live-secret";
    const calls = [];
    global.fetch = async (url, options) => {
        calls.push({ url: String(url), options });
        const paymentResponse = activityPaymentRecordResponse(url, options);
        if (paymentResponse) {
            return paymentResponse;
        }
        if (String(url).endsWith("/rpc/submit_activity_registration")) {
            return new Response(
                JSON.stringify({
                    ok: true,
                    requires_payment: true,
                    reused: true,
                    checkout_url: "https://zapay.zannmods.net/api/qr/QRToken123",
                    order_id: "HMPS-9b2f3b2a-ff51-4e31-b22f-9f18fdb68a11",
                }),
                { status: 200 },
            );
        }
        assert.equal(
            String(url),
            "https://zapay.zannmods.net/api/v1/statustransaksi?order_id=HMPS-9b2f3b2a-ff51-4e31-b22f-9f18fdb68a11",
        );
        assert.equal(options.headers["X-Api-Key"], "zp_live-secret");
        return new Response(
            JSON.stringify({
                success: true,
                data: {
                    order_id: "HMPS-9b2f3b2a-ff51-4e31-b22f-9f18fdb68a11",
                    status: "pending",
                    method: "qris",
                    sandbox: false,
                    amount: 25000,
                    fee: 425,
                    fee_bearer: "buyer",
                    total: 25425,
                    pay_url: "https://zapay.zannmods.net/pay/PayToken123",
                    payment: {
                        type: "qris",
                        qr_url: "https://zapay.zannmods.net/api/qr/QRToken123",
                    },
                },
            }),
            { status: 200 },
        );
    };

    const response = makeResponse();
    await registrationHandler(registrationRequest(), response);

    assert.equal(response.statusCode, 201);
    assert.deepEqual(response.body, {
        ok: true,
        requires_payment: true,
        reused: true,
        order_id: "HMPS-9b2f3b2a-ff51-4e31-b22f-9f18fdb68a11",
        amount: 25000,
        fee: 425,
        fee_bearer: "buyer",
        total: 25425,
        qr_url: "https://zapay.zannmods.net/api/qr/QRToken123",
        payment_link: "https://zapay.zannmods.net/pay/PayToken123",
    });
    assert.equal(calls.length, 3);
});

test("Zapay failures close the pending payment and log sanitized provider details", async () => {
    process.env.SUPABASE_URL = "https://project.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "server-secret";
    process.env.ZAPAY_API_KEY = " zp_live-secret \n";
    const calls = [];
    global.fetch = async (url, options) => {
        calls.push({ url, options });
        const paymentResponse = activityPaymentRecordResponse(url, options);
        if (paymentResponse) {
            return paymentResponse;
        }
        if (String(url).endsWith("/rpc/submit_activity_registration")) {
            return new Response(
                JSON.stringify({
                    ok: true,
                    requires_payment: true,
                    reused: false,
                    order_id: "HMPS-9b2f3b2a-ff51-4e31-b22f-9f18fdb68a11",
                    amount: 25000,
                    activity_title: "Seminar SI",
                    name: "Dewi",
                }),
                { status: 200 },
            );
        }
        if (String(url) === "https://zapay.zannmods.net/api/v1/createtransaksi") {
            assert.equal(options.headers["X-Api-Key"], "zp_live-secret");
            return new Response(
                JSON.stringify({
                    success: false,
                    error: {
                        code: "unauthorized",
                        message: "API key rejected for customer Dewi",
                    },
                }),
                { status: 403 },
            );
        }
        if (String(url).endsWith("/rpc/apply_activity_registration_payment")) {
            assert.deepEqual(JSON.parse(options.body), {
                p_order_id: "HMPS-9b2f3b2a-ff51-4e31-b22f-9f18fdb68a11",
                p_transaction_status: "failed",
                p_gross_amount: null,
                p_payment_type: null,
                p_transaction_id: null,
            });
            return new Response(JSON.stringify({ ok: true, registered: false }), { status: 200 });
        }
        throw new Error(`Unexpected request: ${url}`);
    };

    const response = makeResponse();
    const originalConsoleError = console.error;
    const errorLogs = [];
    console.error = (...args) => errorLogs.push(args);
    try {
        await registrationHandler(registrationRequest(), response);
    } finally {
        console.error = originalConsoleError;
    }

    assert.equal(response.statusCode, 502);
    assert.deepEqual(response.body, { error: "payment_unavailable" });
    assert.equal(calls.length, 4);
    const paymentError = errorLogs.find(
        ([message]) => message === "Zapay QRIS payment could not be created.",
    );
    assert.deepEqual(
        paymentError[1],
        {
            status: 403,
            code: undefined,
            providerCode: "unauthorized",
            providerMessage: "API key rejected for customer [redacted]",
        },
        JSON.stringify(errorLogs),
    );
    assert.equal(JSON.stringify(errorLogs).includes("zp_live-secret"), false);
});

test("activity registration reports a missing database migration without exposing upstream details", async () => {
    process.env.SUPABASE_URL = "https://project.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "server-secret";
    global.fetch = async () =>
        new Response(
            JSON.stringify({
                code: "PGRST202",
                message: "private upstream detail",
            }),
            { status: 404 },
        );
    const response = makeResponse();

    await registrationHandler(registrationRequest(), response);

    assert.equal(response.statusCode, 503);
    assert.deepEqual(response.body, { error: "registration_unavailable" });
    assert.equal(JSON.stringify(response.body).includes("private upstream detail"), false);
});

test("registration is only offered for enabled, dated activities that have not passed", () => {
    const publicScript = fs.readFileSync(path.join(root, "js", "all-komponen.js"), "utf8");
    const declaration = publicScript.match(
        /function getOpenRegistrationActivities\(activities, today\) \{[\s\S]*?\n\}/,
    );
    assert.ok(declaration);
    const getOpenRegistrationActivities = vm.runInNewContext(`(${declaration[0]})`);
    const activities = [
        { id: "later", title: "Lokakarya", event_date: "2026-12-10", registration_enabled: true },
        { id: "past", title: "Seminar", event_date: "2026-11-14", registration_enabled: true },
        { id: "closed", title: "Rapat", event_date: "2026-11-20", registration_enabled: false },
        { id: "undated", title: "Kegiatan", event_date: null, registration_enabled: true },
        { id: "soon", title: "Pelatihan", event_date: "2026-11-20", registration_enabled: true },
    ];

    assert.deepEqual(
        Array.from(
            getOpenRegistrationActivities(activities, "2026-11-15"),
            (activity) => activity.id,
        ),
        ["soon", "later"],
    );
});

test("QRIS display accepts only trusted provider URLs and CSP allows both providers", () => {
    const publicScript = fs.readFileSync(path.join(root, "js", "all-komponen.js"), "utf8");
    const declaration = publicScript.match(/function isValidPaymentQrUrl\(value\) \{[\s\S]*?\n\}/);
    assert.ok(declaration);
    const isValidPaymentQrUrl = vm.runInNewContext(`(${declaration[0]})`, { URL });
    assert.equal(isValidPaymentQrUrl("https://zapay.zannmods.net/api/qr/QRToken123"), true);
    assert.equal(isValidPaymentQrUrl("https://mustikapayment.com/api/qr?data=encoded"), true);
    assert.equal(isValidPaymentQrUrl("http://zapay.zannmods.net/api/qr/QRToken123"), false);
    assert.equal(isValidPaymentQrUrl("https://zapay.zannmods.net.evil.example/api/qr"), false);

    const config = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));
    const contentSecurityPolicy = config.headers
        .flatMap((rule) => rule.headers)
        .find((header) => header.key === "Content-Security-Policy");
    assert.match(contentSecurityPolicy.value, /img-src[^;]*https:\/\/mustikapayment\.com/);
    assert.match(contentSecurityPolicy.value, /img-src[^;]*https:\/\/zapay\.zannmods\.net/);
});

test("the participant WhatsApp pattern is valid in Unicode sets mode", () => {
    const publicScript = fs.readFileSync(path.join(root, "js", "all-komponen.js"), "utf8");
    const declaration = publicScript.match(/phone\.pattern = "([^"]+)";/);
    assert.ok(declaration);
    const pattern = JSON.parse(`"${declaration[1]}"`);
    const regex = new RegExp(pattern, "v");

    assert.equal(regex.test("+62 812-3456 7890"), true);
    assert.equal(regex.test("0812-3456-7890"), true);
    assert.equal(regex.test("6281234567890"), true);
    assert.equal(regex.test("812-3456-7890"), false);
});

test("admin and public pages accept only secure group invite links from supported platforms", () => {
    const source = fs.readFileSync(path.join(root, "js", "activity-registration-utils.js"), "utf8");
    const window = {};
    vm.runInNewContext(source, { URL, window });
    const isValid = window.hmpssiActivityRegistrationUtils.isValidGroupInviteUrl;
    const validLinks = [
        "https://chat.whatsapp.com/InviteCode123",
        "https://t.me/HimsiGroup",
        "https://t.me/+InviteCode123",
        "https://telegram.me/joinchat/Invite-Code",
        "https://discord.gg/Invite-Code",
        "https://discord.com/invite/Invite-Code?event=123",
    ];
    const invalidLinks = [
        "http://discord.gg/Invite-Code",
        "https://discord.com.evil.example/invite/Invite-Code",
        "https://discord.com/channels/123/456",
        "https://user:pass@t.me/HimsiGroup",
        "https://example.com/invite/InviteCode123",
    ];

    validLinks.forEach((link) => assert.equal(isValid(link), true, link));
    invalidLinks.forEach((link) => assert.equal(isValid(link), false, link));

    for (const [page, consumerScript] of [
        ["admin.html", "admin.js"],
        ["beranda.html", "all-komponen.js"],
        ["pengurus.html", "all-komponen.js"],
    ]) {
        const markup = fs.readFileSync(path.join(root, "page", page), "utf8");
        assert.ok(
            markup.indexOf("/js/activity-registration-utils.js") <
                markup.indexOf(`/js/${consumerScript}`),
        );
    }
});

test("admin configures terms, payment, group invite link, and views private participant details", () => {
    const dashboard = fs.readFileSync(path.join(root, "page", "admin.html"), "utf8");
    const adminScript = fs.readFileSync(path.join(root, "js", "admin.js"), "utf8");
    const publicScript = fs.readFileSync(path.join(root, "js", "all-komponen.js"), "utf8");
    const migration = fs.readFileSync(
        path.join(root, "supabase", "migrations", "20261116000000_activity_registrations.sql"),
        "utf8",
    );
    const paymentMigration = fs.readFileSync(
        path.join(
            root,
            "supabase",
            "migrations",
            "20261116010000_activity_registration_payments.sql",
        ),
        "utf8",
    );
    const paymentModeMigration = fs.readFileSync(
        path.join(
            root,
            "supabase",
            "migrations",
            "20261118000000_payment_gateway_sandbox_mode.sql",
        ),
        "utf8",
    );
    const mustikaMigration = fs.readFileSync(
        path.join(
            root,
            "supabase",
            "migrations",
            "20261116020000_activity_registration_mustikapay.sql",
        ),
        "utf8",
    );
    const groupInviteMigration = fs.readFileSync(
        path.join(
            root,
            "supabase",
            "migrations",
            "20261116030000_activity_registration_group_invites.sql",
        ),
        "utf8",
    );
    const groupInviteConstraintMigration = fs.readFileSync(
        path.join(
            root,
            "supabase",
            "migrations",
            "20261116040000_activity_registration_group_invite_constraint.sql",
        ),
        "utf8",
    );
    const homepage = fs.readFileSync(path.join(root, "page", "beranda.html"), "utf8");

    assert.match(dashboard, /name="registration_enabled" type="checkbox"/);
    assert.match(
        dashboard,
        /<input\b(?=[^>]*\bname="registration_capacity")(?=[^>]*\btype="number")(?=[^>]*\bmin="1")[^>]*>/,
    );
    assert.match(dashboard, /name="registration_terms"/);
    assert.match(dashboard, /name="registration_is_free" type="checkbox" checked/);
    assert.match(
        dashboard,
        /<input\b(?=[^>]*\bname="registration_fee")(?=[^>]*\btype="number")(?=[^>]*\bmin="1000")(?=[^>]*\bmax="10000000")[^>]*>/,
    );
    assert.match(
        dashboard,
        /<input\b(?=[^>]*\bname="registration_payment_deadline")(?=[^>]*\btype="datetime-local")[^>]*>/,
    );
    assert.match(dashboard, /name="registration_whatsapp_group_link"/);
    assert.match(dashboard, /id="paymentGatewaySettings"/);
    assert.match(dashboard, /name="mode"/);
    assert.match(dashboard, /API key live tetap disimpan di\s+Environment Variables Vercel/);
    assert.match(dashboard, /Pembayaran\s+berbayar diproses melalui QRIS\s+Zapay/);
    assert.match(dashboard, /Link grup peserta \(diberikan setelah pembayaran sukses\)/);
    assert.match(dashboard, /id="activityRegistrationsList"/);
    assert.match(publicScript, /Jurusan \/ Program Studi/);
    assert.match(publicScript, /Nomor WhatsApp aktif/);
    assert.match(homepage, /href="#activityRegistrations">Pendaftaran Kegiatan<\/a>/);
    assert.match(homepage, /id="activityRegistrations"/);
    assert.match(homepage, /h3>Pendaftaran Kegiatan<\/h3>/);
    assert.match(adminScript, /activity\.registration_enabled/);
    assert.match(adminScript, /activity\.registration_capacity \?\? ""/);
    assert.match(adminScript, /field === "registration_capacity" && !input\.value\s+\? null/);
    assert.match(adminScript, /from\("payment_gateway_settings"\)/);
    assert.match(adminScript, /simulate_activity_registration_payment/);
    assert.match(adminScript, /payment_mode === "sandbox"/);
    assert.match(adminScript, /form\.elements\.namedItem\("event_date"\)\.required = enabled/);
    assert.match(adminScript, /client\s*\.\s*from\s*\(\s*"activity_registrations"\s*\)/);
    assert.match(publicScript, /consent\.required = true/);
    assert.match(publicScript, /fields\.namedItem\("program"\)\.value/);
    assert.match(publicScript, /fields\.namedItem\("semester"\)\.value/);
    assert.match(publicScript, /fields\.namedItem\("whatsapp"\)\.value/);
    assert.match(
        publicScript,
        /card\.append\(heading, createActivityRegistrationForm\(activity\)\)/,
    );
    assert.match(publicScript, /function createQrisPaymentCard\(activity, payment\)/);
    assert.match(publicScript, /payment\.qr_url/);
    assert.match(
        publicScript,
        /function showActivityRegistrationSuccess\(result, fallbackDetails\)/,
    );
    assert.match(publicScript, /container\.querySelector\("\.payment-confirmation-status"\)/);
    assert.match(publicScript, /Jangan membayar ulang; hubungi panitia untuk konfirmasi/);
    assert.match(publicScript, /showActivityRegistrationSuccess\(result, fallbackDetails\)/);
    assert.match(publicScript, /if \(!registrationSchemaAvailable\)/);
    assert.match(
        migration,
        /for\s+select\s+to authenticated\s+using \(public\.is_admin\s*\(\s*\)\)/i,
    );
    assert.match(
        migration,
        /for\s+delete\s+to authenticated\s+using \(public\.is_admin\s*\(\s*\)\)/i,
    );
    assert.match(
        migration,
        /revoke all on table public\.activity_registrations\s+from\s+public,\s*anon,\s*authenticated/i,
    );
    assert.match(migration, /for update/i);
    assert.match(migration, /v_registration_count >= v_activity\.registration_capacity/i);
    assert.match(migration, /activity_registrations_unique_email_idx/i);
    assert.match(migration, /activity_registrations_unique_student_idx/i);
    assert.match(paymentMigration, /activity_registration_private_settings/i);
    assert.match(paymentMigration, /get_activity_registration_confirmation/i);
    assert.match(paymentModeMigration, /payment_gateway_settings/);
    assert.match(paymentModeMigration, /payment_mode in \('live', 'sandbox'\)/);
    assert.match(paymentModeMigration, /sandbox:\/\/pending\//);
    assert.match(paymentModeMigration, /auth\.uid\(\) is null or not public\.is_admin\(\)/);
    assert.match(paymentModeMigration, /v_payment\.payment_mode <> 'sandbox'/);
    assert.match(paymentModeMigration, /grant execute on function public\.simulate_activity_registration_payment\(text\)\s+to authenticated/i);
    assert.match(
        paymentMigration,
        /grant all on table public\.activity_registration_payments to service_role/i,
    );
    assert.match(
        paymentMigration,
        /revoke all on table public\.activity_registration_private_settings\s+from\s+public,\s*anon,\s*authenticated/i,
    );
    assert.match(
        mustikaMigration,
        /set_activity_registration_checkout\s*\(\s*p_order_id text,\s*p_checkout_url text,\s*p_transaction_id text/i,
    );
    assert.match(mustikaMigration, /transaction_id = p_transaction_id/i);
    assert.match(mustikaMigration, /claim_activity_registration_payment_check/i);
    assert.match(mustikaMigration, /status_checked_at timestamptz/i);
    assert.match(
        groupInviteMigration,
        /drop constraint if exists activity_registration_private_settings_whatsapp_group_link_check/i,
    );
    assert.match(groupInviteMigration, /discord\\\.com\/invite/i);
    assert.match(groupInviteMigration, /t\\\.me\|telegram\\\.me/i);
    assert.match(
        groupInviteConstraintMigration,
        /pg_get_constraintdef\s*\(oid\) like '%whatsapp_group_link%'/i,
    );
    assert.match(groupInviteConstraintMigration, /drop constraint %I/i);
    assert.match(
        groupInviteConstraintMigration,
        /add constraint activity_registration_group_link_check/i,
    );
    assert.match(migration, /to service_role/i);
});

test("payment confirmation reuses one status and opens a participant details dialog when registered", async () => {
    const orderId = confirmationOrderId;
    const successUi = loadPaymentConfirmationUi(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
            ok: true,
            status: "registered",
            participant: {
                name: "Dewi",
                program: "Sistem Informasi",
                semester: 3,
                whatsapp: "+6281234567890",
            },
            activity: { title: "Seminar SI", event_date: "2026-12-01" },
            whatsapp_group_link: "https://chat.whatsapp.com/InviteCode123",
        }),
    }));
    const paymentCard = new TestElement("section");
    const cardStatus = new TestElement("p");
    cardStatus.className = "form-status payment-confirmation-status";
    cardStatus.textContent = "Menunggu pembayaran QRIS...";
    paymentCard.append(cardStatus);

    await successUi.showConfirmation(paymentCard, orderId);

    assert.equal(paymentCard.children.length, 1);
    assert.equal(paymentCard.querySelector(".payment-confirmation-status"), cardStatus);
    assert.equal(cardStatus.textContent, "Pembayaran terverifikasi. Anda sudah terdaftar.");
    const dialog = successUi.document.body.querySelector(".registration-success-dialog");
    assert.ok(dialog?.open);
    assert.match(dialog.textContent, /Dewi/);
    assert.match(dialog.textContent, /Sistem Informasi/);
    assert.match(dialog.textContent, /Seminar SI/);
    assert.match(dialog.textContent, /1 Desember 2026/);
    assert.equal(dialog.querySelector("a").href, "https://chat.whatsapp.com/InviteCode123");

    const unavailableUi = loadPaymentConfirmationUi(async () => ({
        ok: false,
        status: 503,
        json: async () => ({ error: "confirmation_unavailable" }),
    }));
    const unavailableCard = new TestElement("section");
    await unavailableUi.showConfirmation(unavailableCard, orderId);

    assert.equal(unavailableCard.children.length, 1);
    assert.match(
        unavailableCard.querySelector(".payment-confirmation-status").textContent,
        /Status pembayaran belum dapat diperiksa/,
    );
    assert.doesNotMatch(
        unavailableCard.querySelector(".payment-confirmation-status").textContent,
        /Menunggu/,
    );
    assert.equal(unavailableUi.document.body.children.length, 0);
});

test("sandbox payment card clearly explains that no real QR is created", () => {
    const source = fs.readFileSync(path.join(root, "js", "all-komponen.js"), "utf8");
    const declaration = (name) => {
        const match = source.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n\\}`));
        assert.ok(match, `${name} declaration exists`);
        return match[0];
    };
    const context = {
        document: { createElement: (tagName) => new TestElement(tagName) },
        Intl,
    };
    vm.runInNewContext(
        [
            declaration("node"),
            declaration("createQrisPaymentCard"),
            "globalThis.createQrisPaymentCard = createQrisPaymentCard;",
        ].join("\n"),
        context,
    );

    const card = context.createQrisPaymentCard(
        { registration_fee: 25000 },
        { amount: 25000, sandbox: true },
    );
    assert.equal(card.querySelector("img"), null);
    assert.match(card.textContent, /Tidak ada QR atau pembayaran sungguhan/);
    assert.match(card.textContent, /Menunggu simulasi pembayaran/);
});

test("confirmation endpoint returns only the payment-specific group invite after registration", async () => {
    process.env.SUPABASE_URL = "https://project.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "server-secret";
    let requestBody;
    let requestCount = 0;
    global.fetch = async (url, options) => {
        requestCount += 1;
        const detailsResponse = registeredDetailsResponse(url, options);
        if (detailsResponse) {
            return detailsResponse;
        }
        assert.equal(
            url,
            "https://project.supabase.co/rest/v1/rpc/get_activity_registration_confirmation",
        );
        requestBody = JSON.parse(options.body);
        return new Response(
            JSON.stringify({
                ok: true,
                status: "registered",
                whatsapp_group_link: "https://chat.whatsapp.com/InviteCode123",
            }),
            { status: 200 },
        );
    };

    const response = makeResponse();
    await confirmationHandler(
        {
            method: "GET",
            url: "/api/activity-registration-confirmation?order_id=HMPS-9b2f3b2a-ff51-4e31-b22f-9f18fdb68a11",
            headers: { host: "hmpssi.vercel.app" },
        },
        response,
    );

    assert.deepEqual(requestBody, { p_order_id: "HMPS-9b2f3b2a-ff51-4e31-b22f-9f18fdb68a11" });
    assert.deepEqual(response.body, {
        ok: true,
        status: "registered",
        whatsapp_group_link: "https://chat.whatsapp.com/InviteCode123",
        participant: {
            name: "Dewi",
            program: "Sistem Informasi",
            semester: 3,
            whatsapp: "+6281234567890",
        },
        activity: { title: "Seminar SI", event_date: "2026-12-01" },
        amount: 25000,
        registration_details_available: true,
    });
    assert.equal(response.headers["Cache-Control"], "no-store");
    assert.equal(requestCount, 3);

    global.fetch = async (url) => {
        if (
            url === "https://project.supabase.co/rest/v1/rpc/get_activity_registration_confirmation"
        ) {
            return new Response(
                JSON.stringify({
                    ok: true,
                    status: "pending",
                    whatsapp_group_link: "https://chat.whatsapp.com/InviteCode123",
                }),
                { status: 200 },
            );
        }
        const paymentResponse = activityPaymentRecordResponse(url, {
            headers: {
                apikey: "server-secret",
                Authorization: "Bearer server-secret",
            },
        });
        if (paymentResponse) {
            return paymentResponse;
        }
        assert.equal(
            url,
            "https://project.supabase.co/rest/v1/rpc/claim_activity_registration_payment_check",
        );
        return new Response(JSON.stringify({ ok: true, should_check: false }), { status: 200 });
    };
    const pendingResponse = makeResponse();
    await confirmationHandler(
        {
            method: "GET",
            url: "/api/activity-registration-confirmation?order_id=HMPS-9b2f3b2a-ff51-4e31-b22f-9f18fdb68a11",
            headers: { host: "hmpssi.vercel.app" },
        },
        pendingResponse,
    );
    assert.deepEqual(pendingResponse.body, {
        ok: true,
        status: "pending",
        whatsapp_group_link: null,
    });
    assert.equal("participant" in pendingResponse.body, false);
    assert.equal("activity" in pendingResponse.body, false);
});

test("confirmation preserves verified payment status if participant details cannot be loaded", async () => {
    process.env.SUPABASE_URL = "https://project.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "server-secret";
    global.fetch = async (url) => {
        if (
            String(url) ===
            "https://project.supabase.co/rest/v1/rpc/get_activity_registration_confirmation"
        ) {
            return new Response(
                JSON.stringify({
                    ok: true,
                    status: "registered",
                    whatsapp_group_link: "https://chat.whatsapp.com/InviteCode123",
                }),
                { status: 200 },
            );
        }
        return new Response(JSON.stringify({ message: "private database detail" }), {
            status: 403,
        });
    };

    const response = makeResponse();
    await confirmationHandler(
        {
            method: "GET",
            url: `/api/activity-registration-confirmation?order_id=${confirmationOrderId}`,
            headers: { host: "hmpssi.vercel.app" },
        },
        response,
    );

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, {
        ok: true,
        status: "registered",
        whatsapp_group_link: "https://chat.whatsapp.com/InviteCode123",
        registration_details_available: false,
    });
    assert.equal(JSON.stringify(response.body).includes("private database detail"), false);
});

test("sandbox confirmation remains pending without calling the Zapay status endpoint", async () => {
    process.env.SUPABASE_URL = "https://project.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "server-secret";
    let requestCount = 0;
    global.fetch = async (url, options) => {
        requestCount += 1;
        if (
            String(url) ===
            "https://project.supabase.co/rest/v1/rpc/get_activity_registration_confirmation"
        ) {
            return new Response(JSON.stringify({ ok: true, status: "pending" }), {
                status: 200,
            });
        }
        const paymentResponse = activityPaymentRecordResponse(url, options, "sandbox");
        if (paymentResponse) {
            return paymentResponse;
        }
        throw new Error(`Sandbox confirmation must not contact Zapay: ${url}`);
    };

    const response = makeResponse();
    await confirmationHandler(
        {
            method: "GET",
            url: `/api/activity-registration-confirmation?order_id=${confirmationOrderId}`,
            headers: { host: "hmpssi.vercel.app" },
        },
        response,
    );

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, {
        ok: true,
        status: "pending",
        whatsapp_group_link: null,
        sandbox: true,
    });
    assert.equal(requestCount, 2);
});

test("confirmation verifies MustikaPay QRIS before marking the participant registered", async () => {
    process.env.SUPABASE_URL = "https://project.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "server-secret";
    process.env.MUSTIKAPAY_API_KEY = "mustika-secret";
    const calls = [];
    global.fetch = async (url, options) => {
        const urlText = String(url);
        calls.push({ url: urlText, options });
        const paymentResponse = activityPaymentRecordResponse(urlText, options);
        if (paymentResponse) {
            return paymentResponse;
        }
        const detailsResponse = registeredDetailsResponse(urlText, options);
        if (detailsResponse) {
            return detailsResponse;
        }
        if (
            urlText ===
            "https://project.supabase.co/rest/v1/rpc/get_activity_registration_confirmation"
        ) {
            const count = calls.filter((call) => call.url === urlText).length;
            return new Response(
                JSON.stringify(
                    count === 1
                        ? { ok: true, status: "pending" }
                        : {
                              ok: true,
                              status: "registered",
                              whatsapp_group_link: "https://chat.whatsapp.com/InviteCode123",
                          },
                ),
                { status: 200 },
            );
        }
        if (
            urlText ===
            "https://project.supabase.co/rest/v1/rpc/claim_activity_registration_payment_check"
        ) {
            return new Response(
                JSON.stringify({
                    ok: true,
                    should_check: true,
                    amount: 25000,
                    transaction_id: "QR123456",
                }),
                { status: 200 },
            );
        }
        if (urlText === "https://mustikapayment.com/api/v1/check/qris?ref_no=QR123456") {
            assert.equal(options.headers["X-Api-Key"], "mustika-secret");
            return new Response(
                JSON.stringify({
                    ref_no: "QR123456",
                    status: "success",
                    type: "QRIS",
                    amount: 25000,
                }),
                { status: 200 },
            );
        }
        if (
            urlText ===
            "https://project.supabase.co/rest/v1/rpc/apply_activity_registration_payment"
        ) {
            assert.deepEqual(JSON.parse(options.body), {
                p_order_id: "HMPS-9b2f3b2a-ff51-4e31-b22f-9f18fdb68a11",
                p_transaction_status: "settled",
                p_gross_amount: 25000,
                p_payment_type: "QRIS",
                p_transaction_id: "QR123456",
            });
            return new Response(JSON.stringify({ ok: true, registered: true }), { status: 200 });
        }
        throw new Error(`Unexpected request: ${urlText}`);
    };

    const response = makeResponse();
    await confirmationHandler(
        {
            method: "GET",
            url: "/api/activity-registration-confirmation?order_id=HMPS-9b2f3b2a-ff51-4e31-b22f-9f18fdb68a11",
            headers: { host: "hmpssi.vercel.app" },
        },
        response,
    );

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, {
        ok: true,
        status: "registered",
        whatsapp_group_link: "https://chat.whatsapp.com/InviteCode123",
        participant: {
            name: "Dewi",
            program: "Sistem Informasi",
            semester: 3,
            whatsapp: "+6281234567890",
        },
        activity: { title: "Seminar SI", event_date: "2026-12-01" },
        amount: 25000,
        registration_details_available: true,
    });
    assert.equal(calls.length, 8);
});

test("confirmation verifies Zapay status and amount before marking the participant registered", async () => {
    process.env.SUPABASE_URL = "https://project.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "server-secret";
    process.env.ZAPAY_API_KEY = "zp_live-secret";
    const calls = [];
    global.fetch = async (url, options) => {
        const urlText = String(url);
        calls.push({ url: urlText, options });
        const paymentResponse = activityPaymentRecordResponse(urlText, options);
        if (paymentResponse) {
            return paymentResponse;
        }
        const detailsResponse = registeredDetailsResponse(urlText, options);
        if (detailsResponse) {
            return detailsResponse;
        }
        if (
            urlText ===
            "https://project.supabase.co/rest/v1/rpc/get_activity_registration_confirmation"
        ) {
            const count = calls.filter((call) => call.url === urlText).length;
            return new Response(
                JSON.stringify(
                    count === 1
                        ? { ok: true, status: "pending" }
                        : {
                              ok: true,
                              status: "registered",
                              whatsapp_group_link: "https://chat.whatsapp.com/InviteCode123",
                          },
                ),
                { status: 200 },
            );
        }
        if (
            urlText ===
            "https://project.supabase.co/rest/v1/rpc/claim_activity_registration_payment_check"
        ) {
            return new Response(
                JSON.stringify({
                    ok: true,
                    should_check: true,
                    amount: 25000,
                    transaction_id: "HMPS-9b2f3b2a-ff51-4e31-b22f-9f18fdb68a11",
                }),
                { status: 200 },
            );
        }
        if (
            urlText ===
            "https://zapay.zannmods.net/api/v1/statustransaksi?order_id=HMPS-9b2f3b2a-ff51-4e31-b22f-9f18fdb68a11"
        ) {
            assert.equal(options.headers["X-Api-Key"], "zp_live-secret");
            return new Response(
                JSON.stringify({
                    success: true,
                    data: {
                        order_id: "HMPS-9b2f3b2a-ff51-4e31-b22f-9f18fdb68a11",
                        status: "paid",
                        method: "qris",
                        sandbox: false,
                        amount: 25000,
                        fee: 425,
                        fee_bearer: "buyer",
                        total: 25425,
                    },
                }),
                { status: 200 },
            );
        }
        if (
            urlText ===
            "https://project.supabase.co/rest/v1/rpc/apply_activity_registration_payment"
        ) {
            assert.deepEqual(JSON.parse(options.body), {
                p_order_id: "HMPS-9b2f3b2a-ff51-4e31-b22f-9f18fdb68a11",
                p_transaction_status: "settled",
                p_gross_amount: 25000,
                p_payment_type: "QRIS",
                p_transaction_id: "HMPS-9b2f3b2a-ff51-4e31-b22f-9f18fdb68a11",
            });
            return new Response(JSON.stringify({ ok: true, registered: true }), { status: 200 });
        }
        throw new Error(`Unexpected request: ${urlText}`);
    };

    const response = makeResponse();
    await confirmationHandler(
        {
            method: "GET",
            url: "/api/activity-registration-confirmation?order_id=HMPS-9b2f3b2a-ff51-4e31-b22f-9f18fdb68a11",
            headers: { host: "hmpssi.vercel.app" },
        },
        response,
    );

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, {
        ok: true,
        status: "registered",
        whatsapp_group_link: "https://chat.whatsapp.com/InviteCode123",
        participant: {
            name: "Dewi",
            program: "Sistem Informasi",
            semester: 3,
            whatsapp: "+6281234567890",
        },
        activity: { title: "Seminar SI", event_date: "2026-12-01" },
        amount: 25000,
        registration_details_available: true,
    });
    assert.equal(calls.length, 8);
});

test("confirmation does not settle a QRIS transaction when the provider amount differs", async () => {
    process.env.SUPABASE_URL = "https://project.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "server-secret";
    process.env.ZAPAY_API_KEY = "zp_live-secret";
    const calls = [];
    global.fetch = async (url, options) => {
        const urlText = String(url);
        calls.push(urlText);
        const paymentResponse = activityPaymentRecordResponse(urlText, options);
        if (paymentResponse) {
            return paymentResponse;
        }
        if (
            urlText ===
            "https://project.supabase.co/rest/v1/rpc/get_activity_registration_confirmation"
        ) {
            return new Response(JSON.stringify({ ok: true, status: "pending" }), { status: 200 });
        }
        if (
            urlText ===
            "https://project.supabase.co/rest/v1/rpc/claim_activity_registration_payment_check"
        ) {
            return new Response(
                JSON.stringify({
                    ok: true,
                    should_check: true,
                    amount: 25000,
                    transaction_id: "HMPS-9b2f3b2a-ff51-4e31-b22f-9f18fdb68a11",
                }),
                { status: 200 },
            );
        }
        if (
            urlText ===
            "https://zapay.zannmods.net/api/v1/statustransaksi?order_id=HMPS-9b2f3b2a-ff51-4e31-b22f-9f18fdb68a11"
        ) {
            return new Response(
                JSON.stringify({
                    success: true,
                    data: {
                        order_id: "HMPS-9b2f3b2a-ff51-4e31-b22f-9f18fdb68a11",
                        status: "paid",
                        method: "qris",
                        sandbox: true,
                        amount: 1000,
                        fee: 257,
                        fee_bearer: "buyer",
                        total: 1257,
                    },
                }),
                { status: 200 },
            );
        }
        throw new Error(`Unexpected request: ${urlText}`);
    };

    const response = makeResponse();
    await confirmationHandler(
        {
            method: "GET",
            url: "/api/activity-registration-confirmation?order_id=HMPS-9b2f3b2a-ff51-4e31-b22f-9f18fdb68a11",
            headers: { host: "hmpssi.vercel.app" },
        },
        response,
    );

    assert.equal(response.statusCode, 502);
    assert.deepEqual(response.body, { error: "confirmation_unavailable" });
    assert.equal(
        calls.some((url) => url.endsWith("/rpc/apply_activity_registration_payment")),
        false,
    );
});

test("confirmation endpoint allows supported group invites and rejects unsafe links", async () => {
    process.env.SUPABASE_URL = "https://project.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "server-secret";
    const inviteLinks = [
        ["https://chat.whatsapp.com/InviteCode123", "https://chat.whatsapp.com/InviteCode123"],
        ["https://t.me/HimsiGroup", "https://t.me/HimsiGroup"],
        ["https://t.me/+InviteCode123", "https://t.me/+InviteCode123"],
        ["https://discord.gg/Invite-Code", "https://discord.gg/Invite-Code"],
        ["https://discord.com/invite/Invite-Code", "https://discord.com/invite/Invite-Code"],
        ["https://discord.com.evil.example/invite/Invite-Code", null],
        ["http://discord.gg/Invite-Code", null],
        ["javascript:alert(1)", null],
    ];

    for (const [inviteLink, expectedLink] of inviteLinks) {
        global.fetch = async (url) => {
            const detailsResponse = registeredDetailsResponse(url, {
                headers: {
                    apikey: "server-secret",
                    Authorization: "Bearer server-secret",
                },
            });
            if (detailsResponse) {
                return detailsResponse;
            }
            assert.equal(
                url,
                "https://project.supabase.co/rest/v1/rpc/get_activity_registration_confirmation",
            );
            return new Response(
                JSON.stringify({
                    ok: true,
                    status: "registered",
                    whatsapp_group_link: inviteLink,
                }),
                { status: 200 },
            );
        };

        const response = makeResponse();
        await confirmationHandler(
            {
                method: "GET",
                url: "/api/activity-registration-confirmation?order_id=HMPS-9b2f3b2a-ff51-4e31-b22f-9f18fdb68a11",
                headers: { host: "hmpssi.vercel.app" },
            },
            response,
        );

        assert.equal(response.statusCode, 200);
        assert.equal(response.body.whatsapp_group_link, expectedLink, inviteLink);
    }
});
