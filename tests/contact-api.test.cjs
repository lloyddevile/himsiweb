const assert = require("node:assert/strict");
const { afterEach, test } = require("node:test");
const contactHandler = require("../api/contact");
const configHandler = require("../api/config");

const originalFetch = global.fetch;
const originalEnvironment = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
};

afterEach(() => {
    global.fetch = originalFetch;
    Object.entries(originalEnvironment).forEach(([key, value]) => {
        if (value === undefined) {
            delete process.env[key];
        } else {
            process.env[key] = value;
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

function contactRequest(overrides = {}) {
    return {
        method: "POST",
        headers: {
            "content-type": "application/json",
            "x-forwarded-for": "203.0.113.8",
            host: "hmpssi.vercel.app",
            origin: "https://hmpssi.vercel.app",
        },
        body: {
            name: "  Dewi  ",
            email: "dewi@example.org",
            subject: "Pertanyaan",
            message: "Mohon informasi.",
            consent: true,
        },
        ...overrides,
    };
}

test("contact endpoint rejects invalid input before calling Supabase", async () => {
    const response = makeResponse();
    global.fetch = async () => {
        throw new Error("Supabase must not be called for invalid input");
    };

    await contactHandler(contactRequest({ body: { name: "", email: "bad" } }), response);
    assert.equal(response.statusCode, 400);
    assert.equal(response.body.error, "invalid_contact_details");
});

test("contact endpoint rejects missing origin and cross-origin requests", async () => {
    const missingOrigin = makeResponse();
    await contactHandler(
        contactRequest({
            headers: { "content-type": "application/json", host: "hmpssi.vercel.app" },
        }),
        missingOrigin,
    );
    assert.equal(missingOrigin.statusCode, 403);

    const crossOrigin = makeResponse();
    await contactHandler(
        contactRequest({
            headers: {
                "content-type": "application/json",
                host: "hmpssi.vercel.app",
                origin: "https://attacker.example",
            },
        }),
        crossOrigin,
    );
    assert.equal(crossOrigin.statusCode, 403);
});

test("contact endpoint stores validated data through the server-only RPC", async () => {
    process.env.SUPABASE_URL = "https://project.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "server-secret";
    let requestOptions;
    global.fetch = async (url, options) => {
        requestOptions = { url, options };
        return new Response(null, { status: 204 });
    };
    const response = makeResponse();

    await contactHandler(contactRequest(), response);

    assert.equal(response.statusCode, 201);
    assert.equal(response.body.ok, true);
    assert.equal(
        requestOptions.url,
        "https://project.supabase.co/rest/v1/rpc/submit_contact_message",
    );
    assert.equal(requestOptions.options.headers.apikey, "server-secret");
    const payload = JSON.parse(requestOptions.options.body);
    assert.equal(payload.p_name, "Dewi");
    assert.match(payload.p_requester_hash, /^[0-9a-f]{64}$/);
    assert.equal(response.headers["Cache-Control"], "no-store");
});

test("contact endpoint reports database rate limiting", async () => {
    process.env.SUPABASE_URL = "https://project.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "server-secret";
    global.fetch = async () =>
        new Response(
            JSON.stringify({
                code: "P0001",
                message: "rate limit exceeded",
            }),
            { status: 400 },
        );
    const response = makeResponse();

    await contactHandler(contactRequest(), response);

    assert.equal(response.statusCode, 429);
    assert.equal(response.body.error, "rate_limited");
});

test("public config exposes only the anon key and rejects other methods", () => {
    process.env.SUPABASE_URL = "https://project.supabase.co";
    process.env.SUPABASE_ANON_KEY = "public-anon";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "server-secret";

    const response = makeResponse();
    configHandler({ method: "GET" }, response);
    assert.deepEqual(response.body, {
        url: "https://project.supabase.co",
        anonKey: "public-anon",
    });
    assert.equal(response.body.serviceRoleKey, undefined);

    const rejected = makeResponse();
    configHandler({ method: "POST" }, rejected);
    assert.equal(rejected.statusCode, 405);
});
