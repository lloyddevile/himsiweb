function respond(res, status, payload) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.status(status).json(payload);
}

function getRequestBody(req) {
    if (typeof req.body === "string") {
        try {
            return JSON.parse(req.body);
        } catch {
            return null;
        }
    }

    return req.body;
}

function getSupabaseProjectUrl(value) {
    try {
        const url = new URL(value);
        if (
            url.protocol === "https:" ||
            url.hostname === "localhost" ||
            url.hostname === "127.0.0.1"
        ) {
            return url;
        }
    } catch {
        return null;
    }

    return null;
}

function isSameOriginRequest(req, { allowMissingOrigin = false } = {}) {
    const { origin, host } = req.headers;
    if (!host || (!origin && !allowMissingOrigin)) {
        return false;
    }
    if (!origin) {
        return true;
    }

    try {
        return new URL(origin).host === host;
    } catch {
        return false;
    }
}

module.exports = {
    getRequestBody,
    getSupabaseProjectUrl,
    isSameOriginRequest,
    respond,
};
