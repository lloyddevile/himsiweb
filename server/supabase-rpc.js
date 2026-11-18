async function callSupabaseRpc(projectUrl, serviceKey, name, body) {
    const upstream = await fetch(`${projectUrl.origin}/rest/v1/rpc/${name}`, {
        method: "POST",
        headers: {
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
    });

    let payload;
    try {
        payload = await upstream.json();
    } catch {
        payload = null;
    }

    if (!upstream.ok || !payload || typeof payload !== "object") {
        const error = new Error("Supabase rejected an RPC request.");
        error.status = upstream.status;
        error.code = payload?.code;
        throw error;
    }

    return payload;
}

module.exports = callSupabaseRpc;
