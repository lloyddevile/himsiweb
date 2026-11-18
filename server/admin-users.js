const USERNAME_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{1,30}[a-z0-9])$/;
const LOGIN_EMAIL_DOMAIN = "admin.hmpssi.invalid";
const {
    getRequestBody,
    getSupabaseProjectUrl,
    isSameOriginRequest,
    respond,
} = require("./http-utils");

function isDuplicateUser(error) {
    return ["email_exists", "user_already_exists"].includes(error?.code);
}

async function rollbackCreatedUser(projectUrl, serviceKey, userId) {
    try {
        const response = await fetch(
            new URL(`/auth/v1/admin/users/${encodeURIComponent(userId)}`, projectUrl.origin),
            {
                method: "DELETE",
                headers: {
                    apikey: serviceKey,
                    Authorization: `Bearer ${serviceKey}`,
                },
            },
        );
        if (!response.ok) {
            console.error("Supabase could not roll back an incomplete admin account.", {
                status: response.status,
            });
        }
    } catch (error) {
        console.error("Supabase could not reach the admin account rollback endpoint.", error);
    }
}

module.exports = async function handleAdminUsers(req, res) {
    if (req.method !== "POST") {
        res.setHeader("Allow", "POST");
        return respond(res, 405, { error: "method_not_allowed" });
    }

    res.setHeader("Cache-Control", "no-store");
    const contentType = req.headers["content-type"] || "";
    if (!contentType.toLowerCase().startsWith("application/json")) {
        return respond(res, 415, { error: "unsupported_media_type" });
    }

    const contentLength = Number(req.headers["content-length"] || 0);
    if (contentLength > 4096) {
        return respond(res, 413, { error: "request_too_large" });
    }

    if (!isSameOriginRequest(req)) {
        return respond(res, 403, { error: "forbidden" });
    }

    const body = getRequestBody(req);
    const username = typeof body?.username === "string" ? body.username.trim().toLowerCase() : "";
    const password = typeof body?.password === "string" ? body.password : "";
    if (
        !USERNAME_PATTERN.test(username) ||
        username.includes("..") ||
        password.length < 6 ||
        password.length > 128
    ) {
        return respond(res, 400, { error: "invalid_admin_details" });
    }

    const authorization = req.headers.authorization || "";
    const tokenMatch =
        typeof authorization === "string" && authorization.match(/^Bearer ([^\s]+)$/i);
    const supabaseUrl = process.env.SUPABASE_URL;
    const anonKey = process.env.SUPABASE_ANON_KEY;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const creatorEmail = process.env.ADMIN_ACCOUNT_CREATOR_EMAIL?.trim().toLowerCase();
    if (!tokenMatch || !supabaseUrl || !anonKey || !serviceKey || !creatorEmail) {
        if (!tokenMatch) {
            return respond(res, 401, { error: "unauthorized" });
        }
        console.error("Admin account API is missing its server configuration.");
        return respond(res, 503, { error: "service_unavailable" });
    }

    const projectUrl = getSupabaseProjectUrl(supabaseUrl);
    if (!projectUrl) {
        console.error("Admin account API has an invalid Supabase URL.");
        return respond(res, 503, { error: "service_unavailable" });
    }

    const token = tokenMatch[1];
    try {
        const userResponse = await fetch(new URL("/auth/v1/user", projectUrl.origin), {
            headers: {
                apikey: anonKey,
                Authorization: `Bearer ${token}`,
            },
            cache: "no-store",
        });
        if (!userResponse.ok) {
            return respond(res, 401, { error: "unauthorized" });
        }
        const user = await userResponse.json();
        if (typeof user.email !== "string" || user.email.toLowerCase() !== creatorEmail) {
            return respond(res, 403, { error: "forbidden" });
        }

        const adminResponse = await fetch(new URL("/rest/v1/rpc/is_admin", projectUrl.origin), {
            method: "POST",
            headers: {
                apikey: anonKey,
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
            },
            body: "{}",
            cache: "no-store",
        });
        if (!adminResponse.ok) {
            console.error("Supabase rejected the admin account authorization check.", {
                status: adminResponse.status,
            });
            return respond(res, 502, { error: "authorization_check_failed" });
        }
        if ((await adminResponse.json()) !== true) {
            return respond(res, 403, { error: "forbidden" });
        }

        const createResponse = await fetch(new URL("/auth/v1/admin/users", projectUrl.origin), {
            method: "POST",
            headers: {
                apikey: serviceKey,
                Authorization: `Bearer ${serviceKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                email: `${username}@${LOGIN_EMAIL_DOMAIN}`,
                password,
                email_confirm: true,
                user_metadata: { username },
            }),
        });
        const createdUser = await createResponse.json().catch(() => null);
        if (!createResponse.ok) {
            if (isDuplicateUser(createdUser)) {
                return respond(res, 409, { error: "username_taken" });
            }
            console.error("Supabase could not create an admin account.", {
                status: createResponse.status,
            });
            return respond(res, 502, { error: "admin_creation_failed" });
        }

        const userId = createdUser?.id || createdUser?.user?.id;
        if (typeof userId !== "string" || !userId) {
            console.error("Supabase created an admin account without returning a user ID.");
            return respond(res, 502, { error: "admin_creation_failed" });
        }

        let grantResponse;
        try {
            grantResponse = await fetch(new URL("/rest/v1/admin_users", projectUrl.origin), {
                method: "POST",
                headers: {
                    apikey: serviceKey,
                    Authorization: `Bearer ${serviceKey}`,
                    "Content-Type": "application/json",
                    Prefer: "return=minimal",
                },
                body: JSON.stringify({ user_id: userId }),
            });
        } catch (error) {
            console.error("Supabase could not grant admin access to a newly created user.", error);
            await rollbackCreatedUser(projectUrl, serviceKey, userId);
            return respond(res, 502, { error: "admin_creation_failed" });
        }
        if (!grantResponse.ok) {
            console.error("Supabase could not grant admin access to a newly created user.", {
                status: grantResponse.status,
            });
            await rollbackCreatedUser(projectUrl, serviceKey, userId);
            return respond(res, 502, { error: "admin_creation_failed" });
        }

        return respond(res, 201, { ok: true, username });
    } catch (error) {
        console.error("Admin account API could not complete its Supabase request.", error);
        return respond(res, 502, { error: "admin_creation_failed" });
    }
};
