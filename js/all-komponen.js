const PROFILE_PLACEHOLDER = "/assets/profile-placeholder.jpg";
const EVENT_PLACEHOLDER = "/assets/event-placeholder.jpg";
const signedImageUrls = new Map();

function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) {
        element.className = className;
    }
    if (text !== undefined) {
        element.textContent = text;
    }
    return element;
}

function setStatus(container, message, isError = false) {
    if (!container) {
        return;
    }

    if (container.tagName === "P") {
        container.textContent = message;
        container.classList.toggle("error", Boolean(isError));
        return;
    }

    container.replaceChildren(node("p", "content-status", message));
}

function memberAvatarSvg(name) {
    const words = String(name || "")
        .trim()
        .split(/\s+/)
        .filter(Boolean);
    const initials = (
        words.length > 1
            ? words
                  .slice(0, 2)
                  .map((word) => Array.from(word)[0])
                  .join("")
            : Array.from(words[0] || "?")
                  .slice(0, 2)
                  .join("")
    ).toLocaleUpperCase("id-ID");
    const safeInitials = initials.replace(
        /[&<>"']/g,
        (character) =>
            ({
                "&": "&amp;",
                "<": "&lt;",
                ">": "&gt;",
                '"': "&quot;",
                "'": "&apos;",
            })[character],
    );
    const hash = Array.from(String(name || "")).reduce(
        (value, character) => (value * 31 + character.codePointAt(0)) >>> 0,
        0,
    );
    const palettes = [
        ["#13294b", "#dbeafe"],
        ["#166534", "#dcfce7"],
        ["#9a3412", "#ffedd5"],
        ["#6b21a8", "#f3e8ff"],
        ["#155e75", "#cffafe"],
    ];
    const [background, foreground] = palettes[hash % palettes.length];
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160"><rect width="160" height="160" rx="80" fill="${background}"/><circle cx="126" cy="34" r="20" fill="${foreground}" opacity=".18"/><circle cx="35" cy="128" r="27" fill="${foreground}" opacity=".12"/><text x="80" y="88" fill="${foreground}" font-family="Arial,sans-serif" font-size="54" font-weight="700" text-anchor="middle" dominant-baseline="middle">${safeInitials}</text></svg>`;
    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

const isValidActivityGroupInviteUrl = window.hmpssiActivityRegistrationUtils.isValidGroupInviteUrl;

function formatDate(value) {
    if (!value) {
        return "Tanggal belum ditentukan";
    }

    const date = new Date(`${value}T00:00:00`);
    return new Intl.DateTimeFormat("id-ID", {
        day: "numeric",
        month: "long",
        year: "numeric",
    }).format(date);
}

async function mediaUrl(client, path, externalUrl, fallback) {
    if (path) {
        if (!signedImageUrls.has(path)) {
            const signedUrl = client.storage
                .from("hmpssi-media")
                .createSignedUrl(path, 3600)
                .then(({ data, error }) => {
                    if (error) {
                        throw error;
                    }
                    return data.signedUrl;
                })
                .catch((error) => {
                    signedImageUrls.delete(path);
                    throw error;
                });
            signedImageUrls.set(path, signedUrl);
        }
        return signedImageUrls.get(path);
    }
    return externalUrl || fallback;
}

async function createImage(client, path, externalUrl, alt, className, fallback) {
    const image = node("img", className);
    image.src = fallback;
    image.alt = alt || "";
    image.loading = "lazy";
    image.decoding = "async";
    image.addEventListener(
        "error",
        () => {
            if (image.src.endsWith(fallback)) {
                return;
            }
            image.src = fallback;
        },
        { once: true },
    );

    try {
        image.src = await mediaUrl(client, path, externalUrl, fallback);
    } catch (error) {
        console.error("Foto publik tidak dapat dimuat.", error);
    }

    return image;
}

async function renderMembers(container, members, client) {
    if (!container) {
        return;
    }
    container.replaceChildren();

    if (!members.length) {
        setStatus(container, "Susunan pengurus akan diperbarui.");
        return;
    }

    for (const member of members) {
        const card = node("article", "team-member");
        const photo = node("div", "member-photo");
        photo.append(
            await createImage(
                client,
                member.photo_path,
                null,
                `Foto ${member.name}`,
                "",
                memberAvatarSvg(member.name),
            ),
        );

        card.append(
            photo,
            node("h3", "member-name", member.name),
            node("p", "member-position", member.position),
        );
        container.append(card);
    }
}

function getDirectorySections(members) {
    const normalize = (value) =>
        String(value || "")
            .replace(/\s+/g, " ")
            .trim()
            .toLowerCase();
    const coreOrder = new Map([
        ["ketua umum", 0],
        ["sekretaris umum", 1],
        ["bendahara umum", 2],
    ]);
    const programStudyOrder = new Map([
        ["kepala program studi", 0],
        ["sekretaris program studi", 1],
    ]);
    const coreMembers = members
        .filter((member) => coreOrder.has(normalize(member.position)))
        .sort(
            (first, second) =>
                coreOrder.get(normalize(first.position)) -
                coreOrder.get(normalize(second.position)),
        );
    const programStudyMembers = members
        .filter((member) => programStudyOrder.has(normalize(member.position)))
        .sort(
            (first, second) =>
                programStudyOrder.get(normalize(first.position)) -
                programStudyOrder.get(normalize(second.position)),
        );
    const harianByDivision = new Map();
    members
        .filter(
            (member) =>
                !coreOrder.has(normalize(member.position)) &&
                !programStudyOrder.has(normalize(member.position)),
        )
        .forEach((member) => {
            const division =
                member.division && normalize(member.division) !== "pengurus harian"
                    ? member.division
                    : "Lainnya";
            if (!harianByDivision.has(division)) {
                harianByDivision.set(division, []);
            }
            harianByDivision.get(division).push(member);
        });

    const divisionOrder = [
        "Internal",
        "Eksternal",
        "Kesekretariatan",
        "Pemberdayaan Perempuan",
        "Medinfo (Media dan Informasi)",
        "Lainnya",
    ];
    const orderedDivisions = Array.from(harianByDivision, ([division, divisionMembers]) => ({
        division,
        members: divisionMembers.sort((first, second) => {
            const isHead = (member) =>
                /^(kepala divisi|koordinator)/.test(normalize(member.position));
            const firstIsHead = isHead(first);
            const secondIsHead = isHead(second);
            return Number(secondIsHead) - Number(firstIsHead);
        }),
    })).sort((first, second) => {
        const firstOrder = divisionOrder.indexOf(first.division);
        const secondOrder = divisionOrder.indexOf(second.division);
        if (firstOrder < 0 && secondOrder < 0) {
            return first.division.localeCompare(second.division, "id");
        }
        if (firstOrder < 0) {
            return 1;
        }
        if (secondOrder < 0) {
            return -1;
        }
        return firstOrder - secondOrder;
    });

    return [
        ...(coreMembers.length ? [{ title: "Pengurus Inti", members: coreMembers }] : []),
        ...(programStudyMembers.length
            ? [{ title: "Program Studi", members: programStudyMembers }]
            : []),
        ...(orderedDivisions.length
            ? [{ title: "Pengurus Harian", divisions: orderedDivisions }]
            : []),
    ];
}

async function renderDirectoryMembers(grid, members, client) {
    for (const member of members) {
        const card = node("article", "directory-member");
        const photo = node("div", "directory-photo");
        photo.append(
            await createImage(
                client,
                member.photo_path,
                null,
                `Foto ${member.name}`,
                "",
                memberAvatarSvg(member.name),
            ),
        );

        const details = node("div", "directory-details");
        details.append(
            node("h3", "", member.name),
            node("p", "directory-position", member.position),
        );
        if (member.period) {
            details.append(node("p", "directory-period", `Periode ${member.period}`));
        }
        if (member.duties) {
            details.append(node("p", "directory-duties", member.duties));
        }
        card.append(photo, details);
        grid.append(card);
    }
}

async function renderDirectory(container, members, client) {
    if (!container) {
        return;
    }
    container.replaceChildren();

    if (!members.length) {
        setStatus(container, "Data kepengurusan belum dipublikasikan.");
        return;
    }

    for (const group of getDirectorySections(members)) {
        const section = node("section", "directory-division");
        section.append(node("h2", "", group.title));
        if (group.members) {
            const grid = node("div", "division-members");
            await renderDirectoryMembers(grid, group.members, client);
            section.append(grid);
        } else {
            for (const division of group.divisions) {
                const divisionSection = node("section", "directory-subdivision");
                divisionSection.append(node("h3", "", division.division));
                const grid = node("div", "division-members");
                await renderDirectoryMembers(grid, division.members, client);
                divisionSection.append(grid);
                section.append(divisionSection);
            }
        }
        container.append(section);
    }
}

async function renderActivities(container, activities, photos, client) {
    if (!container) {
        return;
    }
    container.replaceChildren();

    if (!activities.length) {
        setStatus(container, "Belum ada kegiatan yang dipublikasikan.");
        return;
    }

    for (const activity of activities) {
        const photo = photos.find((item) => item.activity_id === activity.id);
        const bannerPath = activity.cover_path || photo?.storage_path;
        const bannerUrl = activity.cover_path ? null : photo?.image_url;
        const bannerAlt = activity.cover_path
            ? `Banner ${activity.title}`
            : photo?.alt_text || `Ilustrasi ${activity.title}`;
        const card = node("article", "activity-card");
        const imageArea = node("div", "activity-image");
        imageArea.append(
            await createImage(client, bannerPath, bannerUrl, bannerAlt, "", EVENT_PLACEHOLDER),
        );
        imageArea.append(node("span", "activity-date", formatDate(activity.event_date)));

        const content = node("div", "activity-content");
        content.append(
            node("div", "activity-category", activity.category),
            node("h3", "activity-title", activity.title),
            node("p", "activity-description", activity.description || "Informasi kegiatan."),
        );
        card.append(imageArea, content);
        container.append(card);
    }
}

function getUpcomingActivities(activities, today, limit = 8) {
    return activities
        .filter((activity) => activity.event_date && activity.event_date >= today)
        .sort(
            (first, second) =>
                first.event_date.localeCompare(second.event_date) ||
                first.title.localeCompare(second.title, "id"),
        )
        .slice(0, limit);
}

function groupActivityMedia(mediaItems) {
    const groups = new Map();
    mediaItems.forEach((media) => {
        if (!groups.has(media.activity_id)) {
            groups.set(media.activity_id, []);
        }
        groups.get(media.activity_id).push(media);
    });
    return groups;
}

function localDateValue() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function renderUpcomingAgenda(container, activities) {
    if (!container) {
        return;
    }
    container.replaceChildren();
    const upcoming = getUpcomingActivities(activities, localDateValue());
    if (!upcoming.length) {
        setStatus(container, "Belum ada agenda mendatang yang dipublikasikan.");
        return;
    }

    upcoming.forEach((activity) => {
        const item = node("article", "agenda-item");
        const date = node("time", "agenda-date", formatDate(activity.event_date));
        date.dateTime = activity.event_date;
        const details = node("div", "agenda-details");
        details.append(
            node("p", "agenda-category", activity.category || "Kegiatan"),
            node("h3", "", activity.title),
            node("p", "", activity.description || "Informasi kegiatan."),
        );
        item.append(date, details);
        container.append(item);
    });
}

function getOpenRegistrationActivities(activities, today) {
    return activities
        .filter(
            (activity) =>
                activity.registration_enabled &&
                activity.event_date &&
                activity.event_date >= today &&
                (activity.registration_is_free !== false ||
                    (activity.registration_payment_deadline &&
                        Date.parse(activity.registration_payment_deadline) > Date.now())),
        )
        .sort(
            (first, second) =>
                first.event_date.localeCompare(second.event_date) ||
                first.title.localeCompare(second.title, "id"),
        );
}

function isActivityRegistrationSchemaUnavailable(error) {
    return ["42P01", "42703", "PGRST204", "PGRST205"].includes(error?.code);
}

function normalizeWhatsappNumber(value) {
    const compact = String(value || "")
        .trim()
        .replace(/[\s-]+/g, "");
    if (compact.startsWith("+62")) {
        return `+62${compact.slice(3)}`;
    }
    if (compact.startsWith("62")) {
        return `+62${compact.slice(2)}`;
    }
    if (compact.startsWith("0")) {
        return `+62${compact.slice(1)}`;
    }
    return compact;
}

function registrationField(labelText, name, type, maxLength, autocomplete) {
    const label = node("label", "registration-field");
    const input = node("input");
    input.name = name;
    input.type = type;
    if (type !== "number") {
        input.maxLength = maxLength;
    }
    input.required = true;
    input.autocomplete = autocomplete;
    label.append(document.createTextNode(labelText), input);
    return label;
}

function isValidPaymentQrUrl(value) {
    try {
        const url = new URL(value);
        const isZapayUrl = url.hostname === "zapay.zannmods.net";
        const isLegacyMustikaUrl =
            url.hostname === "mustikapayment.com" && url.pathname === "/api/qr";
        return (
            url.protocol === "https:" &&
            !url.username &&
            !url.password &&
            (isZapayUrl || isLegacyMustikaUrl)
        );
    } catch {
        return false;
    }
}

function isValidPaymentLink(value) {
    try {
        const url = new URL(value);
        return (
            url.protocol === "https:" &&
            (url.hostname === "zapay.zannmods.net" || url.hostname === "mustikapayment.com") &&
            !url.username &&
            !url.password &&
            /^\/pay\/[A-Za-z0-9_-]+$/.test(url.pathname)
        );
    } catch {
        return false;
    }
}

function createQrisPaymentCard(activity, payment) {
    const card = node("section", "payment-qr-card");
    const amount = Number(payment.total || payment.amount || activity.registration_fee);
    card.append(
        node("h4", "", "Pembayaran QRIS"),
        node(
            "p",
            "payment-qr-amount",
            `Total pembayaran Rp${new Intl.NumberFormat("id-ID").format(amount)}`,
        ),
    );
    if (payment.sandbox) {
        card.append(
            node(
                "p",
                "payment-sandbox-note",
                "Mode sandbox aktif. Tidak ada QR atau pembayaran sungguhan; admin akan menyelesaikan simulasi.",
            ),
        );
        const status = node(
            "p",
            "form-status payment-confirmation-status",
            "Menunggu simulasi pembayaran...",
        );
        status.setAttribute("role", "status");
        status.setAttribute("aria-live", "polite");
        card.append(status);
        return card;
    }

    card.append(node("p", "", "Pindai kode QR menggunakan aplikasi pembayaran Anda."));
    if (Number(payment.fee) > 0) {
        const feeLabel =
            payment.fee_bearer === "buyer" ? "Biaya layanan" : "Biaya layanan ditanggung pengelola";
        card.append(
            node(
                "p",
                "payment-qr-fee",
                `${feeLabel}: Rp${new Intl.NumberFormat("id-ID").format(Number(payment.fee))}`,
            ),
        );
    }

    const image = node("img", "payment-qr-image");
    image.src = payment.qr_url;
    image.alt = `Kode QRIS pembayaran Rp${new Intl.NumberFormat("id-ID").format(amount)}`;
    image.loading = "eager";
    image.decoding = "async";
    image.referrerPolicy = "no-referrer";
    const status = node(
        "p",
        "form-status payment-confirmation-status",
        "Menunggu pembayaran QRIS...",
    );
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    image.addEventListener(
        "error",
        () => {
            setStatus(
                status,
                "QRIS tidak dapat ditampilkan. Gunakan tautan pembayaran atau hubungi pengurus.",
                true,
            );
        },
        { once: true },
    );
    card.append(image, status);

    if (isValidPaymentLink(payment.payment_link)) {
        const link = node("a", "btn btn-primary", "Buka halaman pembayaran");
        link.href = payment.payment_link;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        card.append(link);
    }
    return card;
}

function createActivityRegistrationForm(activity) {
    const form = node("form", "activity-registration-form");
    form.dataset.activityRegistration = "true";
    const activityId = node("input");
    activityId.type = "hidden";
    activityId.name = "activity_id";
    activityId.defaultValue = activity.id;
    activityId.value = activity.id;
    form.append(
        activityId,
        registrationField("Nama lengkap", "name", "text", 120, "name"),
        registrationField("Jurusan / Program Studi", "program", "text", 120, "organization"),
        registrationField("Semester", "semester", "number", 2, "off"),
        registrationField("Nomor WhatsApp aktif", "whatsapp", "tel", 24, "tel"),
    );
    const semester = form.elements.namedItem("semester");
    semester.min = "1";
    semester.max = "14";
    semester.step = "1";
    semester.placeholder = "1-14";
    const phone = form.elements.namedItem("whatsapp");
    phone.pattern = "^(?:\\+62|62|0)[0-9 \\x2D]{8,16}$";
    phone.placeholder = "0812 3456 7890";
    phone.title =
        "Awali dengan 0, 62, atau +62, lalu nomor WhatsApp aktif (contoh: 0812 3456 7890).";
    const consent = node("input");
    consent.type = "checkbox";
    consent.name = "consent";
    consent.required = true;
    const consentLabel = node("label", "registration-consent");
    consentLabel.append(
        consent,
        document.createTextNode(
            "Saya menyetujui syarat dan ketentuan serta penggunaan data untuk keperluan pendaftaran kegiatan.",
        ),
    );
    const status = node("p", "form-status");
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    const submit = node("button", "btn btn-primary", "Daftar kegiatan");
    submit.type = "submit";
    form.append(consentLabel, status, submit);
    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const fields = form.elements;
        const button = form.querySelector('button[type="submit"]');
        button.disabled = true;
        setStatus(status, "Mengirim pendaftaran...");
        try {
            const response = await fetch("/api/activity-registrations", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    activity_id: fields.namedItem("activity_id").value,
                    name: fields.namedItem("name").value,
                    program: fields.namedItem("program").value,
                    semester: fields.namedItem("semester").value,
                    whatsapp: normalizeWhatsappNumber(fields.namedItem("whatsapp").value),
                    consent: fields.namedItem("consent").checked,
                }),
            });
            let result;
            try {
                result = await response.json();
            } catch {
                result = null;
            }
            if (!response.ok || !result?.ok) {
                const messages = {
                    activity_full: "Kuota pendaftaran kegiatan ini sudah terpenuhi.",
                    already_registered:
                        "Nomor WhatsApp ini sudah terdaftar untuk kegiatan tersebut.",
                    registration_closed: "Pendaftaran untuk kegiatan ini sudah ditutup.",
                    rate_limited: "Terlalu banyak percobaan. Coba lagi satu jam mendatang.",
                    registration_unavailable:
                        "Pendaftaran belum aktif di sistem. Silakan hubungi pengurus.",
                    payment_in_progress:
                        "Pembuatan pembayaran masih diproses. Tunggu sebentar lalu coba lagi.",
                    payment_unavailable:
                        "Pembayaran QRIS belum dapat diproses. Silakan coba lagi atau hubungi pengurus.",
                    invalid_registration: "Periksa kembali data pendaftaran Anda.",
                };
                throw new Error(
                    messages[result?.error] || "Pendaftaran gagal dikirim. Coba lagi nanti.",
                );
            }

            if (result.requires_payment) {
                if (!result.sandbox && !isValidPaymentQrUrl(result.qr_url)) {
                    throw new Error(
                        "QRIS belum dapat ditampilkan. Silakan coba lagi atau hubungi pengurus.",
                    );
                }
                const fallbackDetails = {
                    participant: {
                        name: fields.namedItem("name").value.trim(),
                        program: fields.namedItem("program").value.trim(),
                        semester: Number(fields.namedItem("semester").value),
                        whatsapp: normalizeWhatsappNumber(fields.namedItem("whatsapp").value),
                    },
                    activity: {
                        title: activity.title,
                        event_date: activity.event_date,
                    },
                };
                form.reset();
                const paymentCard = createQrisPaymentCard(activity, result);
                form.after(paymentCard);
                showActivityPaymentConfirmation(
                    paymentCard,
                    result.order_id,
                    fallbackDetails,
                ).catch((error) => {
                    console.error("Pemantauan pembayaran QRIS gagal.", error);
                    setStatus(
                        paymentCard.querySelector(".payment-confirmation-status"),
                        "Status pembayaran belum dapat diperiksa. Jangan membayar ulang; hubungi panitia untuk konfirmasi.",
                        true,
                    );
                });
                return;
            }

            form.reset();
            setStatus(status, "Pendaftaran berhasil! Anda sudah terdaftar pada kegiatan ini.");
        } catch (error) {
            console.error("Pendaftaran kegiatan gagal dikirim.", error);
            setStatus(status, error.message || "Pendaftaran gagal dikirim. Coba lagi nanti.", true);
        } finally {
            button.disabled = false;
        }
    });
    return form;
}

function showActivityRegistrationSuccess(result, fallbackDetails) {
    const participant = result.participant || fallbackDetails?.participant || {};
    const activity = result.activity || fallbackDetails?.activity || {};
    const dialog = node("dialog", "registration-success-dialog");
    const content = node("div", "registration-success-content");
    const heading = node("h2", "", "Pendaftaran terkonfirmasi");
    heading.id = "registrationSuccessTitle";
    dialog.setAttribute("aria-labelledby", heading.id);

    content.append(
        node("p", "registration-success-label", "Pembayaran berhasil"),
        heading,
        node("p", "registration-success-message", "Anda telah terdaftar pada kegiatan ini."),
    );

    const details = node("dl", "registration-success-details");
    const appendDetail = (label, value) => {
        if (value === undefined || value === null || String(value).trim() === "") {
            return;
        }
        const row = node("div", "registration-success-detail");
        row.append(node("dt", "", label), node("dd", "", String(value)));
        details.append(row);
    };

    appendDetail("Nama", participant.name);
    appendDetail("Program studi", participant.program);
    appendDetail("Semester", participant.semester ? `Semester ${participant.semester}` : null);
    appendDetail("WhatsApp", participant.whatsapp);
    appendDetail("Kegiatan", activity.title);
    appendDetail(
        "Tanggal kegiatan",
        activity.event_date ? formatDate(activity.event_date) : null,
    );
    if (details.childElementCount) {
        content.append(details);
    } else {
        content.append(
            node(
                "p",
                "registration-success-message",
                "Data pendaftaran belum dapat dimuat. Silakan hubungi panitia untuk konfirmasi.",
            ),
        );
    }

    if (isValidActivityGroupInviteUrl(result.whatsapp_group_link)) {
        const groupLink = node("a", "btn btn-primary", "Gabung grup kegiatan");
        groupLink.href = result.whatsapp_group_link;
        groupLink.target = "_blank";
        groupLink.rel = "noopener noreferrer";
        content.append(groupLink);
    } else {
        content.append(
            node(
                "p",
                "registration-success-message",
                "Hubungi panitia untuk memperoleh tautan grup kegiatan.",
            ),
        );
    }

    const closeButton = node("button", "btn registration-success-close", "Tutup");
    closeButton.type = "button";
    closeButton.addEventListener("click", () => dialog.close());
    content.append(closeButton);
    dialog.append(content);
    dialog.addEventListener("close", () => dialog.remove(), { once: true });
    document.body.append(dialog);
    dialog.showModal();
}

async function showActivityPaymentConfirmation(
    container,
    providedOrderId = null,
    fallbackDetails = null,
) {
    const query = new URLSearchParams(window.location.search);
    const orderId = providedOrderId || query.get("order_id");
    if (!orderId || !/^HMPS-[0-9a-f-]{36}$/.test(orderId)) {
        return;
    }

    let status = container.querySelector(".payment-confirmation-status");
    if (!status) {
        status = node("p", "form-status payment-confirmation-status");
        status.setAttribute("role", "status");
        status.setAttribute("aria-live", "polite");
        container.prepend(status);
    }

    for (let attempt = 0; attempt < 180; attempt += 1) {
        try {
            const response = await fetch(
                `/api/activity-registration-confirmation?order_id=${encodeURIComponent(orderId)}`,
                { cache: "no-store" },
            );
            let result;
            try {
                result = await response.json();
            } catch {
                result = null;
            }
            if (!response.ok || !result?.ok) {
                setStatus(
                    status,
                    "Status pembayaran belum dapat diperiksa saat ini. Jangan membayar ulang; hubungi panitia untuk konfirmasi.",
                    true,
                );
                if (response.status === 503 || response.status === 404) {
                    return;
                }
            } else if (result.status === "registered") {
                setStatus(status, "Pembayaran terverifikasi. Anda sudah terdaftar.");
                showActivityRegistrationSuccess(result, fallbackDetails);
                return;
            } else if (result.status === "review") {
                setStatus(
                    status,
                    "Pembayaran diterima, tetapi pendaftaran perlu diperiksa. Hubungi panitia.",
                    true,
                );
                return;
            } else if (["expired", "failed", "cancelled"].includes(result.status)) {
                setStatus(
                    status,
                    "Pembayaran belum berhasil diselesaikan. Pendaftaran belum tercatat.",
                    true,
                );
                return;
            } else if (result.sandbox === true) {
                setStatus(status, "Menunggu admin menyelesaikan simulasi pembayaran...");
            } else {
                setStatus(status, "Menunggu verifikasi pembayaran QRIS...");
            }
        } catch (error) {
            console.error("Status pembayaran kegiatan belum dapat diperiksa.", error);
            setStatus(
                status,
                "Koneksi untuk memeriksa status pembayaran terputus. Jangan membayar ulang; coba periksa kembali atau hubungi panitia.",
                true,
            );
        }

        if (attempt < 179) {
            await new Promise((resolve) => setTimeout(resolve, 10000));
        }
    }

    if (!status.classList.contains("error")) {
        setStatus(
            status,
            "Pembayaran masih diverifikasi. Tetap simpan halaman ini atau muat ulang beberapa saat lagi untuk melihat status dan tautan grup.",
        );
    }
}

function renderActivityRegistrations(container, activities, registrationSchemaAvailable) {
    if (!container) {
        return;
    }
    container.replaceChildren();
    if (!registrationSchemaAvailable) {
        setStatus(container, "Pendaftaran online belum dikonfigurasi. Silakan hubungi pengurus.");
        return;
    }

    const openActivities = getOpenRegistrationActivities(activities, localDateValue());
    if (!openActivities.length) {
        setStatus(container, "Belum ada kegiatan yang membuka pendaftaran online saat ini.");
        return;
    }

    for (const activity of openActivities) {
        const card = node("article", "activity-registration-card");
        const heading = node("div", "activity-registration-heading");
        heading.append(
            node("p", "agenda-category", activity.category || "Kegiatan"),
            node("h4", "", activity.title),
            node("p", "", formatDate(activity.event_date)),
            node(
                "p",
                "registration-capacity",
                activity.registration_is_free
                    ? "Pendaftaran gratis"
                    : `Biaya pendaftaran Rp${new Intl.NumberFormat("id-ID").format(activity.registration_fee)}`,
            ),
            node(
                "p",
                "registration-capacity",
                activity.registration_capacity
                    ? `Kuota ${activity.registration_capacity} peserta`
                    : "Kuota tidak dibatasi",
            ),
        );
        if (activity.description) {
            heading.append(node("p", "", activity.description));
        }
        if (activity.registration_payment_deadline && !activity.registration_is_free) {
            heading.append(
                node(
                    "p",
                    "",
                    `Batas pembayaran: ${new Intl.DateTimeFormat("id-ID", {
                        dateStyle: "long",
                        timeStyle: "short",
                    }).format(new Date(activity.registration_payment_deadline))}`,
                ),
            );
        }
        if (activity.registration_terms) {
            const terms = node("details", "registration-terms");
            terms.append(
                node("summary", "", "Baca syarat dan ketentuan"),
                node("p", "", activity.registration_terms),
            );
            heading.append(terms);
        }
        card.append(heading, createActivityRegistrationForm(activity));
        container.append(card);
    }
}

async function renderActivityMediaFolders(container, mediaItems, activities, client) {
    if (!container) {
        return;
    }
    container.replaceChildren();
    const groups = groupActivityMedia(mediaItems);
    if (!groups.size) {
        setStatus(container, "Dokumentasi kegiatan akan ditampilkan di sini.");
        return;
    }

    const activityById = new Map(activities.map((activity) => [activity.id, activity]));
    for (const [activityId, items] of groups) {
        const activity = activityById.get(activityId);
        if (!activity) {
            continue;
        }
        const folder = node("details", "public-activity-folder");
        const summary = node("summary", "", `${activity.title} · ${items.length} dokumentasi`);
        const contents = node("div", "public-activity-media-grid");
        folder.append(summary, contents);

        const signedResult = await client.storage.from("hmpssi-media").createSignedUrls(
            items.map((media) => media.storage_path),
            3600,
        );
        if (signedResult.error) {
            throw signedResult.error;
        }
        if (!Array.isArray(signedResult.data) || signedResult.data.length !== items.length) {
            throw new Error("Tautan dokumentasi tidak lengkap.");
        }
        for (const [index, media] of items.entries()) {
            const signedFile = signedResult.data[index];
            if (!signedFile?.signedUrl || signedFile.error) {
                throw new Error(
                    signedFile?.error || `Tautan file "${media.file_name}" gagal dibuat.`,
                );
            }
            const link = node("a", "public-activity-media");
            link.href = signedFile.signedUrl;
            link.target = "_blank";
            link.rel = "noopener noreferrer";
            if (media.content_type.startsWith("image/")) {
                const image = node("img");
                image.src = signedFile.signedUrl;
                image.alt = media.caption || media.file_name;
                image.loading = "lazy";
                image.decoding = "async";
                image.addEventListener(
                    "error",
                    () => {
                        image.src = EVENT_PLACEHOLDER;
                    },
                    { once: true },
                );
                link.append(image);
            } else {
                link.append(
                    node(
                        "span",
                        "public-activity-file-icon",
                        media.content_type.startsWith("video/") ? "VIDEO" : "DOKUMEN",
                    ),
                );
            }
            const info = node("span", "public-activity-media-info");
            info.append(
                node("strong", "", media.file_name),
                node("span", "activity-date-tag", formatDate(media.documented_on)),
            );
            if (media.caption) {
                info.append(node("span", "", media.caption));
            }
            link.append(info);
            contents.append(link);
        }
        container.append(folder);
    }
}

function renderPrograms(container, programs) {
    if (!container) {
        return;
    }
    container.replaceChildren();

    if (!programs.length) {
        setStatus(container, "Program kerja akan diperbarui.");
        return;
    }

    programs.forEach((program) => {
        const card = node("article", "program-card");
        card.append(
            node("h3", "", program.title),
            node("p", "", program.description || "Informasi program kerja."),
        );
        if (program.period) {
            card.append(node("span", "program-period", `Periode ${program.period}`));
        }
        container.append(card);
    });
}

async function renderGallery(container, filters, photos, activities, client) {
    if (!container || !filters) {
        return;
    }
    container.replaceChildren();
    filters.replaceChildren();

    if (!photos.length) {
        setStatus(container, "Belum ada foto kegiatan yang dipublikasikan.");
        return;
    }

    const activityById = new Map(activities.map((activity) => [activity.id, activity]));
    const categories = [
        ...new Set(
            photos.map((photo) => activityById.get(photo.activity_id)?.category || "Lainnya"),
        ),
    ];
    const filterValues = ["Semua", ...categories];

    const renderForCategory = async (category) => {
        container.replaceChildren();
        const visiblePhotos =
            category === "Semua"
                ? photos
                : photos.filter(
                      (photo) =>
                          (activityById.get(photo.activity_id)?.category || "Lainnya") === category,
                  );

        for (const photo of visiblePhotos) {
            const activity = activityById.get(photo.activity_id);
            const item = node("article", "gallery-item");
            item.append(
                await createImage(
                    client,
                    photo.storage_path,
                    photo.image_url,
                    photo.alt_text,
                    "",
                    EVENT_PLACEHOLDER,
                ),
            );

            const overlay = node("div", "gallery-overlay");
            const info = node("div", "gallery-info");
            info.append(
                node("h3", "", photo.caption || activity?.title || "Dokumentasi kegiatan"),
                node("p", "", activity?.title || "HMPS Sistem Informasi"),
            );
            overlay.append(info);
            item.append(overlay);
            container.append(item);
        }
    };

    filterValues.forEach((category, index) => {
        const button = node("button", `filter-btn${index === 0 ? " active" : ""}`, category);
        button.type = "button";
        button.setAttribute("aria-pressed", index === 0 ? "true" : "false");
        button.addEventListener("click", () => {
            filters.querySelectorAll(".filter-btn").forEach((item) => {
                item.classList.toggle("active", item === button);
                item.setAttribute("aria-pressed", item === button ? "true" : "false");
            });
            renderForCategory(category).catch((error) => {
                console.error("Filter galeri gagal dimuat.", error);
                setStatus(container, "Foto tidak dapat dimuat saat ini.");
            });
        });
        filters.append(button);
    });

    await renderForCategory("Semua");
}

async function renderGalleryMarquee(container, photos, client) {
    if (!container) {
        return;
    }
    container.replaceChildren();

    if (!photos.length) {
        setStatus(container, "Dokumentasi kegiatan akan ditampilkan di sini.");
        return;
    }

    const track = node("div", "gallery-marquee-track");
    const appendPhotos = async (target, hidden) => {
        for (const photo of photos) {
            const image = await createImage(
                client,
                photo.storage_path,
                photo.image_url,
                photo.alt_text,
                "",
                EVENT_PLACEHOLDER,
            );
            const frame = node("div", "gallery-marquee-frame");
            if (hidden) {
                frame.setAttribute("aria-hidden", "true");
            }
            frame.append(image);
            target.append(frame);
        }
    };

    await appendPhotos(track, false);
    await appendPhotos(track, true);
    container.append(track);
}

function setupMobileNavigation() {
    const menuButton = document.querySelector(".mobile-menu");
    const navMenu = document.getElementById("primaryNav");
    if (!menuButton || !navMenu) {
        return;
    }

    const closeMenu = () => {
        navMenu.classList.remove("active");
        navMenu.querySelectorAll(".nav-dropdown").forEach((dropdown) => {
            dropdown.open = false;
        });
        menuButton.setAttribute("aria-expanded", "false");
        menuButton.setAttribute("aria-label", "Buka menu navigasi");
    };

    menuButton.addEventListener("click", () => {
        const isOpen = menuButton.getAttribute("aria-expanded") === "true";
        if (isOpen) {
            closeMenu();
            return;
        }

        navMenu.classList.add("active");
        menuButton.setAttribute("aria-expanded", "true");
        menuButton.setAttribute("aria-label", "Tutup menu navigasi");
    });

    navMenu.querySelectorAll('a[href^="#"]').forEach((link) => {
        link.addEventListener("click", () => closeMenu());
    });

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            closeMenu();
            menuButton.focus();
        }
    });
}

function setupContactForm() {
    const form = document.getElementById("contactForm");
    const status = document.getElementById("contactStatus");
    if (!form || !status) {
        return;
    }

    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        status.textContent = "";
        const submitButton = form.querySelector('button[type="submit"]');
        submitButton.disabled = true;
        form.setAttribute("aria-busy", "true");

        const fields = ["name", "email", "subject", "message"];
        const payload = Object.fromEntries(
            fields.map((field) => [field, form.elements.namedItem(field).value.trim()]),
        );
        payload.consent = form.elements.namedItem("consent").checked;

        try {
            const response = await fetch("/api/contact", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
            let result;
            try {
                result = await response.json();
            } catch {
                result = null;
            }

            if (!response.ok) {
                const messages = {
                    rate_limited: "Terlalu banyak pesan dikirim. Silakan coba lagi nanti.",
                    service_unavailable: "Layanan kontak belum siap. Silakan coba lagi nanti.",
                };
                throw new Error(
                    messages[result?.error] ||
                        "Pesan belum tersimpan. Periksa koneksi lalu coba lagi.",
                );
            }

            form.reset();
            status.textContent = "Pesan berhasil disimpan. Terima kasih telah menghubungi kami.";
            status.classList.remove("error");
        } catch (error) {
            status.textContent = error.message || "Pesan belum tersimpan. Silakan coba lagi.";
            status.classList.add("error");
        } finally {
            submitButton.disabled = false;
            form.removeAttribute("aria-busy");
        }
    });
}

function setupGalleryFilters() {
    const filters = document.getElementById("galleryFilters");
    const container = document.getElementById("galleryGrid");
    if (filters && container) {
        filters.replaceChildren();
        setStatus(container, "Memuat galeri...");
    }
}

function getHomepageLeaders(members) {
    const leadershipOrder = new Map([
        ["kepala program studi", 0],
        ["sekretaris program studi", 1],
        ["ketua umum", 2],
        ["sekretaris umum", 3],
        ["bendahara umum", 4],
    ]);

    return members
        .filter((member) => {
            const position = String(member.position || "")
                .replace(/\s+/g, " ")
                .trim()
                .toLowerCase();
            return member.is_featured && leadershipOrder.has(position);
        })
        .sort((first, second) => {
            const firstPosition = String(first.position || "")
                .replace(/\s+/g, " ")
                .trim()
                .toLowerCase();
            const secondPosition = String(second.position || "")
                .replace(/\s+/g, " ")
                .trim()
                .toLowerCase();
            return leadershipOrder.get(firstPosition) - leadershipOrder.get(secondPosition);
        });
}

async function loadPublicContent() {
    const activityGrid = document.getElementById("activitiesGrid");
    const programGrid = document.getElementById("programsGrid");
    const featuredMembers = document.getElementById("featuredMembers");
    const galleryGrid = document.getElementById("galleryGrid");
    const galleryFilters = document.getElementById("galleryFilters");
    const galleryMarquee = document.getElementById("galleryMarquee");
    const upcomingAgenda = document.getElementById("upcomingAgenda");
    const activityRegistrations = document.getElementById("activityRegistrations");
    const activityMediaFolders = document.getElementById("activityMediaFolders");
    const directory = document.getElementById("directoryGrid");

    [
        activityGrid,
        programGrid,
        featuredMembers,
        galleryGrid,
        galleryMarquee,
        upcomingAgenda,
        activityRegistrations,
        activityMediaFolders,
        directory,
    ].forEach((container) => {
        if (container) {
            setStatus(container, "Memuat konten...");
        }
    });
    if (galleryFilters) {
        galleryFilters.replaceChildren();
    }

    const needs = {
        members: Boolean(featuredMembers || directory),
        programs: Boolean(programGrid),
        activities: Boolean(
            activityGrid ||
            upcomingAgenda ||
            activityRegistrations ||
            activityMediaFolders ||
            galleryGrid,
        ),
        photos: Boolean(activityGrid || galleryGrid || galleryMarquee),
        media: Boolean(activityMediaFolders),
        registration: Boolean(activityRegistrations),
    };
    const skipped = Promise.resolve({ data: [], error: null });

    try {
        const client = await window.hmpssiSupabaseReady;
        const [
            membersResult,
            programsResult,
            activitiesResult,
            photosResult,
            activityMediaResult,
            registrationSettingsResult,
        ] = await Promise.all([
            needs.members
                ? client
                      .from("members")
                      .select(
                          "id,name,position,division,duties,period,photo_path,sort_order,is_featured",
                      )
                      .eq("published", true)
                      .is("archived_at", null)
                      .order("sort_order")
                      .limit(200)
                : skipped,
            needs.programs
                ? client
                      .from("programs")
                      .select("id,title,description,period,sort_order")
                      .eq("published", true)
                      .is("archived_at", null)
                      .order("sort_order")
                      .limit(100)
                : skipped,
            needs.activities
                ? client
                      .from("activities")
                      .select("id,title,description,category,event_date,cover_path,sort_order")
                      .eq("published", true)
                      .is("archived_at", null)
                      .order("event_date", { ascending: false })
                      .limit(100)
                : skipped,
            needs.photos
                ? client
                      .from("gallery_photos")
                      .select("id,activity_id,storage_path,image_url,alt_text,caption,sort_order")
                      .eq("published", true)
                      .is("archived_at", null)
                      .order("sort_order")
                      .limit(300)
                : skipped,
            needs.media
                ? client
                      .from("activity_media")
                      .select(
                          "id,activity_id,storage_path,file_name,content_type,documented_on,caption",
                      )
                      .eq("published", true)
                      .is("archived_at", null)
                      .order("documented_on", { ascending: false })
                      .limit(500)
                : skipped,
            needs.registration
                ? client
                      .from("activities")
                      .select(
                          "id,registration_enabled,registration_capacity,registration_terms,registration_is_free,registration_fee,registration_payment_deadline",
                      )
                      .eq("published", true)
                      .is("archived_at", null)
                      .limit(100)
                : skipped,
        ]);

        const section = async (containers, task) => {
            try {
                await task();
            } catch (error) {
                console.error("Bagian konten publik gagal dimuat.", error);
                containers.forEach((container) => {
                    setStatus(container, "Konten belum dapat dimuat. Silakan coba lagi nanti.");
                });
            }
        };
        const orThrow = (result) => {
            if (result.error) {
                throw result.error;
            }
            return result.data || [];
        };

        await section([featuredMembers, directory], async () => {
            const members = orThrow(membersResult);
            await renderMembers(featuredMembers, getHomepageLeaders(members), client);
            await renderDirectory(directory, members, client);
        });
        await section([activityGrid], async () => {
            await renderActivities(
                activityGrid,
                orThrow(activitiesResult),
                orThrow(photosResult),
                client,
            );
        });
        await section([upcomingAgenda], async () => {
            renderUpcomingAgenda(upcomingAgenda, orThrow(activitiesResult));
        });
        await section([activityRegistrations], async () => {
            const activities = orThrow(activitiesResult);
            const registrationSchemaAvailable = !registrationSettingsResult.error;
            if (
                registrationSettingsResult.error &&
                !isActivityRegistrationSchemaUnavailable(registrationSettingsResult.error)
            ) {
                throw registrationSettingsResult.error;
            }
            if (!registrationSchemaAvailable) {
                console.warn("Migrasi pendaftaran kegiatan belum dijalankan di Supabase.");
            }
            const registrationSettings = new Map(
                (registrationSettingsResult.data || []).map((activity) => [activity.id, activity]),
            );
            renderActivityRegistrations(
                activityRegistrations,
                activities.map((activity) => ({
                    ...activity,
                    ...(registrationSettings.get(activity.id) || {}),
                })),
                registrationSchemaAvailable,
            );
        });
        await section([programGrid], async () => {
            renderPrograms(programGrid, orThrow(programsResult));
        });
        await section([galleryGrid], async () => {
            await renderGallery(
                galleryGrid,
                galleryFilters,
                orThrow(photosResult),
                orThrow(activitiesResult),
                client,
            );
        });
        await section([activityMediaFolders], async () => {
            const mediaError = activityMediaResult.error;
            if (mediaError && mediaError.code !== "42P01" && mediaError.code !== "PGRST205") {
                throw mediaError;
            }
            if (mediaError) {
                console.warn("Migrasi dokumentasi kegiatan belum dijalankan di Supabase.");
            }
            await renderActivityMediaFolders(
                activityMediaFolders,
                activityMediaResult.data || [],
                orThrow(activitiesResult),
                client,
            );
        });
        await section([galleryMarquee], async () => {
            await renderGalleryMarquee(galleryMarquee, orThrow(photosResult), client);
        });
        if (activityRegistrations) {
            showActivityPaymentConfirmation(activityRegistrations);
        }
    } catch (error) {
        console.error("Konten publik gagal dimuat.", error);
        [
            activityGrid,
            programGrid,
            featuredMembers,
            galleryGrid,
            galleryMarquee,
            upcomingAgenda,
            activityRegistrations,
            activityMediaFolders,
            directory,
        ].forEach((container) => {
            setStatus(container, "Konten belum dapat dimuat. Silakan coba lagi nanti.");
        });
    }
}

function setupScrollEffects() {
    const header = document.querySelector("header");
    if (header) {
        window.addEventListener(
            "scroll",
            () => {
                header.classList.toggle("scrolled", window.scrollY > 100);
            },
            { passive: true },
        );
    }
}

setupMobileNavigation();
setupContactForm();
setupGalleryFilters();
setupScrollEffects();
loadPublicContent();

const currentYear = document.getElementById("currentYear");
if (currentYear) {
    currentYear.textContent = String(new Date().getFullYear());
}
