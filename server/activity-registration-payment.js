async function getActivityRegistrationPayment(projectUrl, serviceKey, orderId) {
    const url = new URL("/rest/v1/activity_registration_payments", projectUrl.origin);
    url.searchParams.set("select", "order_id,payment_mode,amount,status");
    url.searchParams.set("order_id", `eq.${orderId}`);

    const upstream = await fetch(url, {
        headers: {
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
        },
        cache: "no-store",
    });

    let records;
    try {
        records = await upstream.json();
    } catch {
        records = null;
    }

    if (!upstream.ok || !Array.isArray(records)) {
        const error = new Error("Supabase could not load the activity payment record.");
        error.status = upstream.status || 502;
        error.code = records?.code;
        throw error;
    }

    if (records.length === 0) {
        return null;
    }
    if (records.length !== 1) {
        const error = new Error("Supabase returned multiple activity payment records.");
        error.status = 502;
        throw error;
    }

    const payment = records[0];
    if (!["live", "sandbox"].includes(payment.payment_mode)) {
        const error = new Error("Supabase returned an invalid activity payment mode.");
        error.status = 502;
        throw error;
    }
    return payment;
}

module.exports = getActivityRegistrationPayment;
