const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { afterEach, test } = require("node:test");
const adminUsersHandler = require("../api/admin-users");
const root = path.join(__dirname, "..");

const originalFetch = global.fetch;
const originalConsoleError = console.error;
const environmentKeys = [
    "SUPABASE_URL",
    "SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "ADMIN_ACCOUNT_CREATOR_EMAIL",
];
const originalEnvironment = Object.fromEntries(environmentKeys.map((key) => [key, process.env[key]]));

afterEach(() => {
    global.fetch = originalFetch;
    console.error = originalConsoleError;
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

function accountRequest(overrides = {}) {
    return {
        method: "POST",
        headers: {
            "content-type": "application/json",
            "content-length": "66",
            host: "hmpssi.vercel.app",
            origin: "https://hmpssi.vercel.app",
            authorization: "Bearer owner-token",
        },
        body: { username: "Editor.Admin", password: "a-secure-password-123" },
        ...overrides,
    };
}

function configureEnvironment() {
    process.env.SUPABASE_URL = "https://project.supabase.co";
    process.env.SUPABASE_ANON_KEY = "public-anon";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "server-secret";
    process.env.ADMIN_ACCOUNT_CREATOR_EMAIL = "muhammadfatiha83@gmail.com";
}

test("admin dashboard offers username-password creation only to the designated owner", () => {
    const adminHtml = fs.readFileSync(path.join(root, "page", "admin.html"), "utf8");
    const adminScript = fs.readFileSync(path.join(root, "js", "admin.js"), "utf8");

    assert.match(adminHtml, /id="newAdminUsername"[^>]*name="username"/);
    assert.match(adminHtml, /id="newAccountPassword"[^>]*name="password"[^>]*minlength="12"/);
    assert.match(adminScript, /const ADMIN_ACCOUNT_CREATOR_EMAIL = "muhammadfatiha83@gmail\.com"/);
    assert.match(adminScript, /fetch\("\/api\/admin-users"/);
    assert.match(adminScript, /Authorization: `Bearer \$\{accessToken\}`/);
});

test("admin account endpoint rejects cross-origin requests", async () => {
    let fetchCalled = false;
    global.fetch = async () => {
        fetchCalled = true;
        throw new Error("Supabase must not be called for a cross-origin request");
    };
    const response = makeResponse();

    await adminUsersHandler(accountRequest({
        headers: { ...accountRequest().headers, origin: "https://attacker.example" },
    }), response);

    assert.equal(response.statusCode, 403);
    assert.equal(fetchCalled, false);
});

test("only the configured admin can create username-password admin accounts", async () => {
    configureEnvironment();
    const calls = [];
    global.fetch = async (url, options) => {
        calls.push({ url: url.toString(), options });
        if (url.toString() === "https://project.supabase.co/auth/v1/user") {
            return new Response(JSON.stringify({ id: "owner-id", email: "muhammadfatiha83@gmail.com" }), { status: 200 });
        }
        if (url.toString() === "https://project.supabase.co/rest/v1/rpc/is_admin") {
            return new Response("true", { status: 200 });
        }
        if (url.toString() === "https://project.supabase.co/auth/v1/admin/users") {
            return new Response(JSON.stringify({ id: "new-admin-id" }), { status: 200 });
        }
        if (url.toString() === "https://project.supabase.co/rest/v1/admin_users") {
            return new Response(null, { status: 201 });
        }
        throw new Error(`Unexpected Supabase URL: ${url}`);
    };
    const response = makeResponse();

    await adminUsersHandler(accountRequest(), response);

    assert.equal(response.statusCode, 201);
    assert.deepEqual(response.body, { ok: true, username: "editor.admin" });
    const createCall = calls.find((call) => call.url.endsWith("/auth/v1/admin/users"));
    assert.equal(createCall.options.headers.Authorization, "Bearer server-secret");
    assert.deepEqual(JSON.parse(createCall.options.body), {
        email: "editor.admin@admin.hmpssi.invalid",
        password: "a-secure-password-123",
        email_confirm: true,
        user_metadata: { username: "editor.admin" },
    });
    const grantCall = calls.find((call) => call.url.endsWith("/rest/v1/admin_users"));
    assert.deepEqual(JSON.parse(grantCall.options.body), { user_id: "new-admin-id" });
});

test("admin account endpoint refuses users outside the configured owner email", async () => {
    configureEnvironment();
    global.fetch = async () => new Response(JSON.stringify({
        id: "other-id",
        email: "another-admin@example.org",
    }), { status: 200 });
    const response = makeResponse();

    await adminUsersHandler(accountRequest(), response);

    assert.equal(response.statusCode, 403);
    assert.deepEqual(response.body, { error: "forbidden" });
});

test("admin account endpoint requires the owner account to have admin access", async () => {
    configureEnvironment();
    global.fetch = async (url) => {
        if (url.toString() === "https://project.supabase.co/auth/v1/user") {
            return new Response(JSON.stringify({ id: "owner-id", email: "muhammadfatiha83@gmail.com" }), { status: 200 });
        }
        return new Response("false", { status: 200 });
    };
    const response = makeResponse();

    await adminUsersHandler(accountRequest(), response);

    assert.equal(response.statusCode, 403);
    assert.deepEqual(response.body, { error: "forbidden" });
});

test("admin account endpoint reports an already-used username", async () => {
    configureEnvironment();
    global.fetch = async (url) => {
        if (url.toString() === "https://project.supabase.co/auth/v1/user") {
            return new Response(JSON.stringify({ id: "owner-id", email: "muhammadfatiha83@gmail.com" }), { status: 200 });
        }
        if (url.toString() === "https://project.supabase.co/rest/v1/rpc/is_admin") {
            return new Response("true", { status: 200 });
        }
        return new Response(JSON.stringify({ code: "email_exists" }), { status: 422 });
    };
    const response = makeResponse();

    await adminUsersHandler(accountRequest(), response);

    assert.equal(response.statusCode, 409);
    assert.deepEqual(response.body, { error: "username_taken" });
});

test("admin account endpoint rolls back Auth user creation if admin access cannot be granted", async () => {
    configureEnvironment();
    const calls = [];
    console.error = () => {};
    global.fetch = async (url, options) => {
        calls.push({ url: url.toString(), options });
        if (url.toString() === "https://project.supabase.co/auth/v1/user") {
            return new Response(JSON.stringify({ id: "owner-id", email: "muhammadfatiha83@gmail.com" }), { status: 200 });
        }
        if (url.toString() === "https://project.supabase.co/rest/v1/rpc/is_admin") {
            return new Response("true", { status: 200 });
        }
        if (url.toString() === "https://project.supabase.co/auth/v1/admin/users") {
            return new Response(JSON.stringify({ id: "new-admin-id" }), { status: 201 });
        }
        if (url.toString() === "https://project.supabase.co/rest/v1/admin_users") {
            return new Response(null, { status: 403 });
        }
        if (url.toString() === "https://project.supabase.co/auth/v1/admin/users/new-admin-id") {
            return new Response(null, { status: 204 });
        }
        throw new Error(`Unexpected Supabase URL: ${url}`);
    };
    const response = makeResponse();

    await adminUsersHandler(accountRequest(), response);

    assert.equal(response.statusCode, 502);
    assert.equal(calls.some((call) => call.options.method === "DELETE"), true);
});
