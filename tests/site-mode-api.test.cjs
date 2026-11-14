const assert = require("node:assert/strict");
const { afterEach, test } = require("node:test");
const siteModeHandler = require("../api/site-mode");

const originalFetch = global.fetch;
const originalEnvironment = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
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

test("site mode endpoint returns the public mode without exposing credentials", async () => {
    process.env.SUPABASE_URL = "https://project.supabase.co";
    process.env.SUPABASE_ANON_KEY = "public-key";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "server-secret";
    global.fetch = async (url, options) => {
        assert.equal(url.toString(), "https://project.supabase.co/rest/v1/site_settings?setting_key=eq.website_mode&select=setting_value");
        assert.equal(options.headers.apikey, "public-key");
        return new Response(JSON.stringify([{ setting_value: "maintenance" }]), { status: 200 });
    };

    const response = makeResponse();
    await siteModeHandler({ method: "GET" }, response);

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, { mode: "maintenance" });
    assert.equal(response.body.serviceRoleKey, undefined);
    assert.equal(response.headers["Cache-Control"], "no-store");
});

test("site mode endpoint rejects unsupported methods and missing configuration", async () => {
    const methodResponse = makeResponse();
    await siteModeHandler({ method: "POST" }, methodResponse);
    assert.equal(methodResponse.statusCode, 405);

    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_ANON_KEY;
    const configResponse = makeResponse();
    await siteModeHandler({ method: "GET" }, configResponse);
    assert.equal(configResponse.statusCode, 503);
});

test("site mode endpoint rejects missing or invalid database settings", async () => {
    process.env.SUPABASE_URL = "https://project.supabase.co";
    process.env.SUPABASE_ANON_KEY = "public-key";
    global.fetch = async () => new Response(JSON.stringify([]), { status: 200 });

    const response = makeResponse();
    await siteModeHandler({ method: "GET" }, response);
    assert.equal(response.statusCode, 502);
    assert.deepEqual(response.body, { error: "site_mode_unavailable" });
});
