const MEDIA_BUCKET = "hmpssi-media";
const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
const MAX_ACTIVITY_MEDIA_SIZE = 10 * 1024 * 1024;
const MAX_ACTIVITY_MEDIA_FILES = 10;
const MAX_EDIT_SOURCE_SIZE = 50 * 1024 * 1024;
const MAX_EDITED_IMAGE_DIMENSION = 4096;
const ADMIN_ACCOUNT_CREATOR_EMAIL = "muhammadfatiha83@gmail.com";
const ADMIN_LOGIN_EMAIL_DOMAIN = "admin.hmpssi.invalid";
const UNIQUE_MEMBER_POSITIONS = new Set([
    "ketua umum",
    "sekretaris umum",
    "bendahara umum",
    "kepala program studi",
    "sekretaris program studi",
]);
const ALLOWED_IMAGE_TYPES = new Map([
    ["image/jpeg", "jpg"],
    ["image/png", "png"],
    ["image/webp", "webp"],
]);
const ALLOWED_ACTIVITY_MEDIA_TYPES = new Map([
    ["image/jpeg", "jpg"],
    ["image/png", "png"],
    ["image/webp", "webp"],
    ["application/pdf", "pdf"],
    ["video/mp4", "mp4"],
    ["video/webm", "webm"],
    ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "docx"],
    ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx"],
    ["application/vnd.openxmlformats-officedocument.presentationml.presentation", "pptx"],
]);
const AUDIT_ACTION_LABELS = {
    INSERT: "Dibuat",
    UPDATE: "Diubah",
    DELETE: "Dihapus",
};
const AUDIT_ENTITY_LABELS = {
    members: "Anggota",
    programs: "Program kerja",
    activities: "Kegiatan",
    gallery_photos: "Foto galeri",
    activity_media: "Dokumentasi kegiatan",
    contact_messages: "Pesan masuk",
    site_settings: "Mode website",
};

let client;
let dashboardStatus;
let activeTab = "members";
let cachedActivities = [];
let activityRegistrationSchemaAvailable = false;
let paymentGatewaySettingsAvailable = false;

function element(tag, className, text) {
    const item = document.createElement(tag);
    if (className) {
        item.className = className;
    }
    if (text !== undefined) {
        item.textContent = text;
    }
    return item;
}

function setStatus(target, text, isError) {
    target.textContent = text || "";
    target.classList.toggle("error", Boolean(isError));
}

const isValidActivityGroupInviteUrl = window.hmpssiActivityRegistrationUtils.isValidGroupInviteUrl;

function setFormBusy(form, busy) {
    form.querySelectorAll('button[type="submit"]').forEach((button) => {
        button.disabled = busy;
    });
}

async function storageUrl(path) {
    const result = await client.storage.from(MEDIA_BUCKET).createSignedUrl(path, 3600);
    if (result.error) {
        throw result.error;
    }
    return result.data.signedUrl;
}

function getLocalDateInputValue(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function getLocalDateTimeInputValue(value) {
    if (!value) {
        return "";
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return "";
    }
    const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return localDate.toISOString().slice(0, 16);
}

function activityMediaPath(activityId, documentedOn, fileId, extension) {
    return `activities/${activityId}/${documentedOn}/${fileId}.${extension}`;
}

function isActivityMediaTableUnavailable(error) {
    return error?.code === "42P01" || error?.code === "PGRST205";
}

function isActivityRegistrationSchemaUnavailable(error) {
    return ["42P01", "42703", "PGRST204", "PGRST205"].includes(error?.code);
}

function normalizeMemberValue(value) {
    return String(value || "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
}

function getMemberPositionConflict(members, candidate, editingId = null) {
    const position = normalizeMemberValue(candidate.position);
    const division = normalizeMemberValue(candidate.division);
    const duplicate = members.some((member) => {
        if (member.id === editingId || member.archived_at) {
            return false;
        }
        const existingPosition = normalizeMemberValue(member.position);
        if (UNIQUE_MEMBER_POSITIONS.has(position)) {
            return existingPosition === position;
        }
        return (
            position === "kepala divisi" &&
            /^kepala divisi(?:\s|$)/.test(existingPosition) &&
            normalizeMemberValue(member.division) === division
        );
    });

    if (!duplicate) {
        return null;
    }
    if (position === "kepala divisi") {
        return `Divisi ${candidate.division} sudah memiliki Kepala Divisi.`;
    }
    return `Jabatan ${candidate.position} hanya boleh dimiliki satu anggota.`;
}

function memberPositionConflictMessage(position, division, error = null) {
    const errorText = [error?.constraint, error?.message, error?.details]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
    if (
        normalizeMemberValue(position) === "kepala divisi" ||
        errorText.includes("members_unique_kadiv_per_division_idx")
    ) {
        return `Divisi ${division || "tersebut"} sudah memiliki Kepala Divisi.`;
    }
    return `Jabatan ${position || "tersebut"} hanya boleh dimiliki satu anggota.`;
}

async function validateMemberPosition(candidate, editingId = null) {
    const result = await client
        .from("members")
        .select("id,position,division,archived_at")
        .is("archived_at", null)
        .limit(1000);
    if (result.error) {
        throw result.error;
    }

    const message = getMemberPositionConflict(result.data, candidate, editingId);
    if (message) {
        throw new Error(message);
    }
}

function syncMemberDivisionField() {
    const position = normalizeMemberValue(document.getElementById("memberPosition").value);
    const divisionField = document.getElementById("memberDivisionField");
    const divisionSelect = document.getElementById("memberDivisionSelect");
    const divisionInput = document.getElementById("memberDivision");
    const fixedDivision = UNIQUE_MEMBER_POSITIONS.has(position)
        ? position.includes("program studi")
            ? "Program Studi"
            : "Pengurus Inti"
        : null;

    if (fixedDivision) {
        divisionField.hidden = true;
        divisionSelect.required = false;
        divisionInput.value = fixedDivision;
        return;
    }

    divisionField.hidden = false;
    divisionSelect.required = true;
    divisionInput.value = divisionSelect.value;
}

function addLegacyOption(select, value, label) {
    if (!value || Array.from(select.options).some((option) => option.value === value)) {
        return;
    }
    const option = new Option(`${label}: ${value}`, value);
    option.dataset.legacy = "true";
    select.add(option);
}

function connectMemberPositionFields() {
    const form = document.getElementById("memberForm");
    const position = document.getElementById("memberPosition");
    const division = document.getElementById("memberDivisionSelect");

    position.addEventListener("change", syncMemberDivisionField);
    division.addEventListener("change", syncMemberDivisionField);
    form.addEventListener("reset", () => {
        setTimeout(() => {
            [position, division].forEach((select) => {
                Array.from(select.options)
                    .filter((option) => option.dataset.legacy === "true")
                    .forEach((option) => option.remove());
            });
            syncMemberDivisionField();
        }, 0);
    });
    syncMemberDivisionField();
}

function setTab(tab) {
    activeTab = tab;
    document.querySelectorAll(".tab-button").forEach((button) => {
        const selected = button.dataset.tab === tab;
        button.classList.toggle("active", selected);
        button.setAttribute("aria-current", selected ? "page" : "false");
    });
    document.querySelectorAll(".dashboard-panel").forEach((panel) => {
        panel.hidden = panel.dataset.panel !== tab;
    });
    loadTab(tab).catch((error) => {
        console.error(`Dashboard ${tab} gagal dimuat.`, error);
        setStatus(dashboardStatus, "Data gagal dimuat. Periksa koneksi lalu coba lagi.", true);
    });
}

function createAction(label, action, className = "button button-secondary") {
    const button = element("button", className, label);
    button.type = "button";
    button.addEventListener("click", async () => {
        button.disabled = true;
        try {
            await action();
        } catch (error) {
            console.error(`Aksi "${label}" gagal.`, error);
            const detail = typeof error?.message === "string" ? ` ${error.message}` : "";
            setStatus(
                dashboardStatus,
                `Aksi gagal.${detail || " Periksa koneksi dan izin admin, lalu coba lagi."}`,
                true,
            );
        } finally {
            button.disabled = false;
        }
    });
    return button;
}

function recordCard(title, description, meta) {
    const card = element("article", "record-card");
    const details = element("div");
    details.append(element("h3", "", title));
    if (description) {
        details.append(element("p", "", description));
    }
    if (meta) {
        details.append(element("p", "record-meta", meta));
    }
    const actions = element("div", "record-actions");
    card.append(details, actions);
    return { card, actions };
}

function statusLabel(row) {
    if (row.archived_at) {
        return "Diarsipkan";
    }
    return row.published ? "Dipublikasikan" : "Draf";
}

async function showLogin() {
    document.getElementById("dashboardPanel").hidden = true;
    document.getElementById("loginPanel").hidden = false;
}

async function showDashboard() {
    const result = await client.rpc("is_admin");
    if (result.error) {
        throw result.error;
    }
    if (result.data !== true) {
        await client.auth.signOut();
        await showLogin();
        setStatus(
            document.getElementById("loginStatus"),
            "Akun ini belum diberi akses admin.",
            true,
        );
        return;
    }

    const userResult = await client.auth.getUser();
    if (userResult.error) {
        throw userResult.error;
    }
    document.getElementById("adminAccountSettings").hidden =
        userResult.data.user?.email?.toLowerCase() !== ADMIN_ACCOUNT_CREATOR_EMAIL;

    document.getElementById("loginPanel").hidden = true;
    document.getElementById("dashboardPanel").hidden = false;
    setStatus(document.getElementById("loginStatus"), "");
    setTab(activeTab);
}

async function loadTab(tab) {
    setStatus(dashboardStatus, "Memuat data...");

    if (tab === "members") {
        await loadMembers();
    } else if (tab === "programs") {
        await loadPrograms();
    } else if (tab === "activities") {
        await loadActivities();
        await loadActivityRegistrations();
    } else if (tab === "gallery") {
        await loadActivities();
        await Promise.all([loadGallery(), loadActivityMedia()]);
    } else if (tab === "messages") {
        await loadMessages();
    } else if (tab === "site-mode") {
        await loadSiteMode();
    } else if (tab === "audit-log") {
        await loadAuditLog();
    }

    setStatus(dashboardStatus, "");
}

function updateSiteModeDescription(mode) {
    const description = document.getElementById("siteModeDescription");
    const maintenanceNoteField = document.getElementById("maintenanceNoteField");
    maintenanceNoteField.hidden = mode !== "maintenance";
    description.textContent =
        mode === "maintenance"
            ? "Halaman publik akan menampilkan pemberitahuan dan catatan maintenance. Dashboard admin tetap tersedia."
            : "Website dapat diakses pengunjung seperti biasa.";
}

async function loadSiteMode() {
    const result = await client
        .from("site_settings")
        .select("setting_value, maintenance_note")
        .eq("setting_key", "website_mode")
        .single();
    if (result.error) {
        throw result.error;
    }

    const mode = result.data.setting_value;
    if (mode !== "public" && mode !== "maintenance") {
        throw new Error("Mode website di database tidak valid.");
    }
    document.getElementById("siteMode").value = mode;
    document.getElementById("maintenanceNote").value = result.data.maintenance_note || "";
    updateSiteModeDescription(mode);
}

async function refreshAfterMutation(successMessage) {
    try {
        await loadTab(activeTab);
        setStatus(dashboardStatus, successMessage);
    } catch (error) {
        console.error("Perubahan tersimpan, tetapi data dashboard gagal dimuat ulang.", error);
        setStatus(
            dashboardStatus,
            `${successMessage} Data tersimpan, tetapi tampilan belum dapat diperbarui.`,
            true,
        );
    }
}

async function loadMembers() {
    const result = await client
        .from("members")
        .select(
            "id,name,position,division,duties,period,photo_path,sort_order,is_featured,published,archived_at",
        )
        .order("sort_order")
        .limit(300);
    if (result.error) {
        throw result.error;
    }

    const list = document.getElementById("membersList");
    list.replaceChildren();
    if (!result.data.length) {
        list.append(element("p", "content-status", "Belum ada data anggota."));
        return;
    }

    result.data.forEach((member) => {
        const { card, actions } = recordCard(
            member.name,
            `${member.position} · ${member.division}`,
            [member.period, statusLabel(member), member.is_featured ? "Tampil di beranda" : ""]
                .filter(Boolean)
                .join(" · "),
        );
        actions.append(
            createAction("Edit", () => editMember(member)),
            createAction(member.archived_at ? "Pulihkan" : "Arsipkan", () =>
                archiveRecord("members", member.id, member.archived_at),
            ),
            createAction(
                "Hapus anggota",
                () => deleteRecord("members", member.id, "Anggota", member.photo_path, member.name),
                "button button-danger",
            ),
        );
        list.append(card);
    });
}

function editMember(member) {
    const form = document.getElementById("memberForm");
    const photoInput = form.elements.namedItem("photo");
    photoInput.value = "";
    photoInput.dispatchEvent(new Event("change", { bubbles: true }));
    form.elements.namedItem("id").value = member.id;
    form.elements.namedItem("name").value = member.name;
    addLegacyOption(document.getElementById("memberPosition"), member.position, "Jabatan lama");
    form.elements.namedItem("position").value = member.position;
    addLegacyOption(
        document.getElementById("memberDivisionSelect"),
        member.division,
        "Divisi lama",
    );
    document.getElementById("memberDivisionSelect").value = member.division;
    syncMemberDivisionField();
    form.elements.namedItem("duties").value = member.duties || "";
    form.elements.namedItem("period").value = member.period || "";
    form.elements.namedItem("photo_path").value = member.photo_path || "";
    form.elements.namedItem("sort_order").value = member.sort_order;
    form.elements.namedItem("is_featured").checked = member.is_featured;
    form.elements.namedItem("published").checked = member.published;
    form.scrollIntoView({ behavior: "smooth", block: "start" });
    form.elements.namedItem("name").focus();
}

async function loadPrograms() {
    const result = await client
        .from("programs")
        .select("id,title,description,period,sort_order,published,archived_at")
        .order("sort_order")
        .limit(300);
    if (result.error) {
        throw result.error;
    }

    const list = document.getElementById("programsList");
    list.replaceChildren();
    if (!result.data.length) {
        list.append(element("p", "content-status", "Belum ada program kerja."));
        return;
    }

    result.data.forEach((program) => {
        const { card, actions } = recordCard(
            program.title,
            program.description,
            [program.period, statusLabel(program)].filter(Boolean).join(" · "),
        );
        actions.append(
            createAction("Edit", () => editProgram(program)),
            createAction(program.archived_at ? "Pulihkan" : "Arsipkan", () =>
                archiveRecord("programs", program.id, program.archived_at),
            ),
            createAction(
                "Hapus program",
                () => deleteRecord("programs", program.id, "Program kerja", null, program.title),
                "button button-danger",
            ),
        );
        list.append(card);
    });
}

function editProgram(program) {
    const form = document.getElementById("programForm");
    form.elements.namedItem("id").value = program.id;
    form.elements.namedItem("title").value = program.title;
    form.elements.namedItem("description").value = program.description || "";
    form.elements.namedItem("period").value = program.period || "";
    form.elements.namedItem("sort_order").value = program.sort_order;
    form.elements.namedItem("published").checked = program.published;
    form.scrollIntoView({ behavior: "smooth", block: "start" });
    form.elements.namedItem("title").focus();
}

async function loadActivities() {
    const result = await client
        .from("activities")
        .select(
            "id,title,description,category,event_date,cover_path,sort_order,published,archived_at",
        )
        .order("event_date", { ascending: false })
        .limit(300);
    if (result.error) {
        throw result.error;
    }

    cachedActivities = result.data;
    const [registrationSettings, privateRegistrationSettings, paymentGatewaySettings] =
        await Promise.all([
            client
                .from("activities")
                .select(
                    "id,registration_enabled,registration_capacity,registration_terms,registration_is_free,registration_fee,registration_payment_deadline",
                )
                .limit(300),
            client
                .from("activity_registration_private_settings")
                .select("activity_id,whatsapp_group_link")
                .limit(300),
            client
                .from("payment_gateway_settings")
                .select("mode")
                .eq("singleton", true)
                .maybeSingle(),
        ]);
    const registrationSettingsField = document.getElementById("activityRegistrationSettings");
    const registrationStatus = document.getElementById("activityRegistrationStatus");
    const paymentGatewaySettingsField = document.getElementById("paymentGatewaySettings");
    const paymentGatewaySettingsForm = document.getElementById("paymentGatewaySettingsForm");
    activityRegistrationSchemaAvailable =
        !registrationSettings.error && !privateRegistrationSettings.error;
    paymentGatewaySettingsAvailable =
        !paymentGatewaySettings.error && Boolean(paymentGatewaySettings.data);
    registrationSettingsField.hidden = !activityRegistrationSchemaAvailable;
    paymentGatewaySettingsField.hidden = !paymentGatewaySettingsAvailable;
    let registrationSchemaMessage = "";
    if (!activityRegistrationSchemaAvailable) {
        const schemaError = registrationSettings.error || privateRegistrationSettings.error;
        if (!isActivityRegistrationSchemaUnavailable(schemaError)) {
            throw schemaError;
        }
        registrationSchemaMessage =
            "Jalankan migrasi pembayaran dan pendaftaran kegiatan di Supabase untuk mengaktifkan fitur ini.";
    } else {
        const settingsById = new Map(
            registrationSettings.data.map((activity) => [activity.id, activity]),
        );
        const privateSettingsById = new Map(
            privateRegistrationSettings.data.map((settings) => [settings.activity_id, settings]),
        );
        cachedActivities = cachedActivities.map((activity) => ({
            ...activity,
            ...(settingsById.get(activity.id) || {}),
            registration_whatsapp_group_link:
                privateSettingsById.get(activity.id)?.whatsapp_group_link || "",
        }));
    }
    if (paymentGatewaySettings.error) {
        if (!isActivityRegistrationSchemaUnavailable(paymentGatewaySettings.error)) {
            throw paymentGatewaySettings.error;
        }
        registrationSchemaMessage =
            "Jalankan migrasi mode pembayaran Sandbox sebelum menggunakan konfigurasi pembayaran.";
    } else if (paymentGatewaySettings.data) {
        if (!["live", "sandbox"].includes(paymentGatewaySettings.data.mode)) {
            throw new Error("Mode pembayaran di database tidak valid.");
        }
        paymentGatewaySettingsForm.elements.namedItem("mode").value =
            paymentGatewaySettings.data.mode;
    } else {
        registrationSchemaMessage =
            "Pengaturan mode pembayaran tidak ditemukan. Periksa migrasi mode pembayaran Sandbox.";
    }
    setStatus(registrationStatus, registrationSchemaMessage);

    const mediaActivitySelect = document.querySelector(
        '#activityMediaForm select[name="activity_id"]',
    );
    if (mediaActivitySelect) {
        mediaActivitySelect.replaceChildren(new Option("Pilih kegiatan", ""));
        cachedActivities
            .filter((activity) => !activity.archived_at)
            .forEach((activity) => {
                mediaActivitySelect.add(new Option(activity.title, activity.id));
            });
    }

    const list = document.getElementById("activitiesList");
    if (!list) {
        return;
    }
    list.replaceChildren();
    if (!cachedActivities.length) {
        list.append(element("p", "content-status", "Belum ada kegiatan."));
        return;
    }

    cachedActivities.forEach((activity) => {
        const { card, actions } = recordCard(
            activity.title,
            activity.description,
            [
                activity.category,
                activity.event_date,
                statusLabel(activity),
                activityRegistrationSchemaAvailable
                    ? activity.registration_enabled
                        ? "Pendaftaran dibuka"
                        : "Tanpa pendaftaran"
                    : "",
            ]
                .filter(Boolean)
                .join(" · "),
        );
        actions.append(
            createAction("Edit", () => editActivity(activity)),
            createAction(activity.archived_at ? "Pulihkan" : "Arsipkan", () =>
                archiveRecord("activities", activity.id, activity.archived_at),
            ),
            createAction(
                "Hapus kegiatan",
                () =>
                    deleteRecord(
                        "activities",
                        activity.id,
                        "Kegiatan",
                        activity.cover_path,
                        activity.title,
                    ),
                "button button-danger",
            ),
        );
        list.append(card);
    });
}

async function loadActivityRegistrations() {
    const list = document.getElementById("activityRegistrationsList");
    const status = document.getElementById("activityRegistrationStatus");
    list.replaceChildren();
    if (!activityRegistrationSchemaAvailable) {
        setStatus(
            status,
            "Jalankan migrasi pendaftaran kegiatan di Supabase untuk melihat pendaftar.",
        );
        return;
    }

    const [result, pendingPaymentsResult] = await Promise.all([
        client
            .from("activity_registrations")
            .select(
                "id,activity_id,name,program,semester,whatsapp,payment_amount,payment_method,created_at",
            )
            .order("created_at", { ascending: false })
            .limit(1000),
        paymentGatewaySettingsAvailable
            ? client
                  .from("activity_registration_payments")
                  .select(
                      "order_id,activity_id,name,program,semester,whatsapp,amount,payment_mode,status,created_at",
                  )
                  .eq("status", "pending")
                  .order("created_at", { ascending: false })
                  .limit(1000)
            : Promise.resolve({ data: [], error: null }),
    ]);
    if (result.error) {
        if (isActivityRegistrationSchemaUnavailable(result.error)) {
            setStatus(
                status,
                "Jalankan migrasi pendaftaran kegiatan di Supabase untuk melihat pendaftar.",
            );
            return;
        }
        throw result.error;
    }
    if (pendingPaymentsResult.error) {
        if (isActivityRegistrationSchemaUnavailable(pendingPaymentsResult.error)) {
            paymentGatewaySettingsAvailable = false;
            document.getElementById("paymentGatewaySettings").hidden = true;
            setStatus(
                status,
                "Jalankan migrasi mode pembayaran Sandbox untuk melihat transaksi yang menunggu.",
            );
        } else {
            throw pendingPaymentsResult.error;
        }
    }

    const registrations = result.data.map((registration) => ({
        ...registration,
        recordType: "registered",
    }));
    const pendingPayments = pendingPaymentsResult.data || [];
    pendingPayments.forEach((payment) => {
        registrations.push({
            ...payment,
            id: payment.order_id,
            payment_amount: payment.amount,
            payment_method: payment.payment_mode === "sandbox" ? "Sandbox" : "QRIS",
            recordType: "pending",
        });
    });
    if (paymentGatewaySettingsAvailable) {
        setStatus(status, "");
    }
    if (!registrations.length) {
        list.append(element("p", "content-status", "Belum ada pendaftar."));
        return;
    }

    const activityById = new Map(cachedActivities.map((activity) => [activity.id, activity]));
    const registrationsByActivity = new Map();
    registrations.forEach((registration) => {
        if (!registrationsByActivity.has(registration.activity_id)) {
            registrationsByActivity.set(registration.activity_id, []);
        }
        registrationsByActivity.get(registration.activity_id).push(registration);
    });

    for (const [activityId, registrations] of registrationsByActivity) {
        const activity = activityById.get(activityId);
        const group = element("details", "activity-registration-admin-group");
        group.append(
            element(
                "summary",
                "",
                `${activity?.title || "Kegiatan diarsipkan"} · ${registrations.length} pendaftar`,
            ),
        );
        const groupList = element("div", "record-list");
        registrations.forEach((registration) => {
            const registeredAt = new Intl.DateTimeFormat("id-ID", {
                dateStyle: "medium",
                timeStyle: "short",
            }).format(new Date(registration.created_at));
            const paymentStatus =
                registration.recordType === "pending"
                    ? registration.payment_mode === "sandbox"
                        ? "Menunggu simulasi pembayaran (Sandbox)"
                        : "Menunggu pembayaran QRIS"
                    : registration.payment_amount > 0
                      ? `Dibayar Rp${new Intl.NumberFormat("id-ID").format(registration.payment_amount)} via ${registration.payment_method}`
                      : "Gratis";
            const { card, actions } = recordCard(
                registration.name,
                `${registration.program} · Semester ${registration.semester} · WhatsApp ${registration.whatsapp}`,
                `${registration.recordType === "pending" ? "Menunggu sejak" : "Terdaftar"} ${registeredAt} · ${paymentStatus}`,
            );
            if (registration.recordType === "pending") {
                if (registration.payment_mode === "sandbox") {
                    actions.append(
                        createAction(
                            "Simulasikan pembayaran sukses",
                            async () => {
                                const simulation = await client.rpc(
                                    "simulate_activity_registration_payment",
                                    { p_order_id: registration.order_id },
                                );
                                if (simulation.error) {
                                    throw simulation.error;
                                }
                                if (simulation.data?.ok !== true) {
                                    const errors = {
                                        payment_expired:
                                            "Batas waktu transaksi sandbox sudah lewat.",
                                        payment_not_pending:
                                            "Transaksi ini tidak lagi menunggu pembayaran.",
                                        sandbox_mode_required:
                                            "Transaksi ini bukan transaksi sandbox.",
                                    };
                                    throw new Error(
                                        errors[simulation.data?.error] ||
                                            "Transaksi sandbox gagal diselesaikan.",
                                    );
                                }
                                await refreshAfterMutation(
                                    "Transaksi sandbox berhasil disimulasikan sebagai lunas.",
                                );
                            },
                            "button button-primary",
                        ),
                    );
                }
            } else {
                actions.append(
                    createAction(
                        "Batalkan pendaftaran",
                        () =>
                            deleteRecord(
                                "activity_registrations",
                                registration.id,
                                "Pendaftaran",
                                null,
                                registration.name,
                            ),
                        "button button-danger",
                    ),
                );
            }
            groupList.append(card);
        });
        group.append(groupList);
        list.append(group);
    }
}

function editActivity(activity) {
    const form = document.getElementById("activityForm");
    form.elements.namedItem("id").value = activity.id;
    form.elements.namedItem("cover_path").value = activity.cover_path || "";
    form.elements.namedItem("title").value = activity.title;
    form.elements.namedItem("description").value = activity.description || "";
    form.elements.namedItem("category").value = activity.category;
    form.elements.namedItem("event_date").value = activity.event_date || "";
    form.elements.namedItem("sort_order").value = activity.sort_order;
    form.elements.namedItem("published").checked = activity.published;
    form.elements.namedItem("registration_enabled").checked = Boolean(
        activity.registration_enabled,
    );
    form.elements.namedItem("registration_capacity").value = activity.registration_capacity ?? "";
    form.elements.namedItem("registration_terms").value = activity.registration_terms || "";
    form.elements.namedItem("registration_is_free").checked =
        activity.registration_is_free !== false;
    form.elements.namedItem("registration_fee").value = activity.registration_fee || "";
    form.elements.namedItem("registration_payment_deadline").value = getLocalDateTimeInputValue(
        activity.registration_payment_deadline,
    );
    form.elements.namedItem("registration_whatsapp_group_link").value =
        activity.registration_whatsapp_group_link || "";
    syncActivityRegistrationDateRequirement();
    form.scrollIntoView({ behavior: "smooth", block: "start" });
    form.elements.namedItem("title").focus();
}

async function loadGallery() {
    const result = await client
        .from("gallery_photos")
        .select(
            "id,activity_id,storage_path,image_url,alt_text,caption,sort_order,published,archived_at",
        )
        .order("created_at", { ascending: false })
        .limit(300);
    if (result.error) {
        throw result.error;
    }

    const list = document.getElementById("galleryList");
    list.replaceChildren();
    if (!result.data.length) {
        list.append(element("p", "content-status", "Belum ada foto galeri."));
        return;
    }

    for (const photo of result.data) {
        const card = element("article", "gallery-record");
        const image = element("img");
        try {
            image.src = photo.storage_path ? await storageUrl(photo.storage_path) : photo.image_url;
        } catch (error) {
            console.error("Foto galeri tidak dapat dimuat.", error);
            image.src = "/assets/event-placeholder.jpg";
        }
        image.alt = photo.alt_text;
        image.loading = "lazy";
        const activity = cachedActivities.find((item) => item.id === photo.activity_id);
        const title = element("h3", "", photo.caption || activity?.title || "Foto galeri");
        const meta = element(
            "p",
            "",
            `${statusLabel(photo)}${activity ? ` · ${activity.title}` : ""}`,
        );
        const actions = element("div", "record-actions");
        actions.append(
            createAction(photo.published ? "Sembunyikan" : "Publikasikan", () =>
                togglePublished("gallery_photos", photo.id, photo.published),
            ),
            createAction(photo.archived_at ? "Pulihkan" : "Arsipkan", () =>
                archiveRecord("gallery_photos", photo.id, photo.archived_at),
            ),
            createAction("Hapus foto", () => deletePhoto(photo), "button button-danger"),
        );
        card.append(image, title, meta, actions);
        list.append(card);
    }
}

function createActivityMediaCard(media) {
    const card = element("article", "record-card activity-media-record");
    const details = element("div", "activity-media-details");
    const isImage = media.content_type.startsWith("image/");
    const isVideo = media.content_type.startsWith("video/");

    if (isImage) {
        const image = element("img", "activity-media-preview");
        image.src = media.previewUrl;
        image.alt = media.caption || media.file_name;
        image.loading = "lazy";
        details.append(image);
    } else {
        details.append(element("span", "activity-media-file-type", isVideo ? "VIDEO" : "DOKUMEN"));
    }

    details.append(
        element("h4", "", media.file_name),
        element("p", "", media.caption || "Tanpa keterangan"),
        element(
            "p",
            "record-meta",
            `${media.documented_on} · ${media.content_type} · ${statusLabel(media)}`,
        ),
    );
    const actions = element("div", "record-actions");
    const download = element("a", "button button-secondary", "Buka / unduh");
    download.href = media.downloadUrl;
    download.target = "_blank";
    download.rel = "noopener noreferrer";
    actions.append(
        download,
        createAction(media.published ? "Sembunyikan" : "Publikasikan", () =>
            togglePublished("activity_media", media.id, media.published),
        ),
        createAction(media.archived_at ? "Pulihkan" : "Arsipkan", () =>
            archiveRecord("activity_media", media.id, media.archived_at),
        ),
        createAction(
            "Hapus dokumentasi",
            () =>
                deleteRecord(
                    "activity_media",
                    media.id,
                    "Dokumentasi kegiatan",
                    media.storage_path,
                    media.file_name,
                ),
            "button button-danger",
        ),
    );
    card.append(details, actions);
    return card;
}

async function loadActivityMedia() {
    const result = await client
        .from("activity_media")
        .select(
            "id,activity_id,storage_path,file_name,content_type,documented_on,caption,published,archived_at",
        )
        .order("documented_on", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(500);
    if (isActivityMediaTableUnavailable(result.error)) {
        document
            .getElementById("activityMediaFoldersList")
            .replaceChildren(
                element(
                    "p",
                    "content-status",
                    "Jalankan migrasi activity_media di Supabase untuk mengaktifkan folder dokumentasi.",
                ),
            );
        return;
    }
    if (result.error) {
        throw result.error;
    }

    const list = document.getElementById("activityMediaFoldersList");
    list.replaceChildren();
    if (!result.data.length) {
        list.append(element("p", "content-status", "Belum ada dokumentasi per kegiatan."));
        return;
    }

    const groups = new Map();
    result.data.forEach((media) => {
        if (!groups.has(media.activity_id)) {
            groups.set(media.activity_id, []);
        }
        groups.get(media.activity_id).push(media);
    });

    for (const [activityId, mediaItems] of groups) {
        const activity = cachedActivities.find((item) => item.id === activityId);
        const folder = element("details", "activity-media-folder");
        const summary = element(
            "summary",
            "",
            `${activity?.title || "Kegiatan tidak ditemukan"} · ${mediaItems.length} file`,
        );
        const folderContents = element("div", "activity-media-folder-contents");
        folder.append(summary, folderContents);

        const signedResult = await client.storage.from(MEDIA_BUCKET).createSignedUrls(
            mediaItems.map((media) => media.storage_path),
            3600,
        );
        if (signedResult.error) {
            throw signedResult.error;
        }
        if (!Array.isArray(signedResult.data) || signedResult.data.length !== mediaItems.length) {
            throw new Error("Tautan dokumentasi tidak lengkap.");
        }
        for (const [index, media] of mediaItems.entries()) {
            const signedFile = signedResult.data[index];
            if (!signedFile?.signedUrl || signedFile.error) {
                throw new Error(
                    signedFile?.error || `Tautan file "${media.file_name}" gagal dibuat.`,
                );
            }
            media.downloadUrl = signedFile.signedUrl;
            media.previewUrl = media.downloadUrl;
            folderContents.append(createActivityMediaCard(media));
        }
        list.append(folder);
    }
}

async function loadMessages() {
    const result = await client
        .from("contact_messages")
        .select("id,name,email,subject,message,is_read,archived_at,created_at")
        .order("created_at", { ascending: false })
        .limit(300);
    if (result.error) {
        throw result.error;
    }

    const list = document.getElementById("messagesList");
    list.replaceChildren();
    if (!result.data.length) {
        list.append(element("p", "content-status", "Belum ada pesan masuk."));
        return;
    }

    result.data.forEach((message) => {
        const { card, actions } = recordCard(
            message.subject,
            `${message.name} · ${message.email}`,
            `${new Date(message.created_at).toLocaleString("id-ID")}${message.is_read ? " · Dibaca" : " · Baru"}${message.archived_at ? " · Diarsipkan" : ""}`,
        );
        card.firstElementChild.append(element("p", "", message.message));
        const email = element("a", "button button-secondary", "Balas via email");
        email.href = `mailto:${message.email.replace(/[^A-Za-z0-9@.!#$%&'*+/=?^_`{|}~-]/g, "")}?subject=${encodeURIComponent(`Re: ${message.subject}`)}`;
        actions.append(
            email,
            createAction(message.is_read ? "Tandai belum dibaca" : "Tandai dibaca", () =>
                updateMessage(message.id, { is_read: !message.is_read }),
            ),
            createAction(message.archived_at ? "Pulihkan" : "Arsipkan", () =>
                archiveRecord("contact_messages", message.id, message.archived_at),
            ),
            createAction(
                "Hapus pesan",
                () =>
                    deleteRecord(
                        "contact_messages",
                        message.id,
                        "Pesan masuk",
                        null,
                        message.subject,
                    ),
                "button button-danger",
            ),
        );
        list.append(card);
    });
}

async function loadAuditLog() {
    const result = await client
        .from("admin_audit_logs")
        .select(
            "id,actor_user_id,actor_email,action,entity_name,record_label,changed_fields,details,created_at",
        )
        .order("created_at", { ascending: false })
        .limit(100);
    if (result.error) {
        throw result.error;
    }

    const list = document.getElementById("auditLogList");
    list.replaceChildren();
    if (!result.data.length) {
        list.append(element("p", "content-status", "Belum ada aktivitas admin."));
        return;
    }

    result.data.forEach((entry) => {
        const action = AUDIT_ACTION_LABELS[entry.action] || entry.action;
        const entity = AUDIT_ENTITY_LABELS[entry.entity_name] || entry.entity_name;
        const actor = entry.actor_email || entry.actor_user_id || "Admin tidak diketahui";
        const timestamp = new Date(entry.created_at).toLocaleString("id-ID");
        const { card } = recordCard(
            `${action}: ${entry.record_label}`,
            `Oleh: ${actor}`,
            `${entity} · ${timestamp}`,
        );
        if (entry.details) {
            card.firstElementChild.append(element("p", "record-meta", entry.details));
        }
        list.append(card);
    });
}

async function archiveRecord(table, id, archivedAt) {
    const nextValue = archivedAt ? null : new Date().toISOString();
    const result = await client.from(table).update({ archived_at: nextValue }).eq("id", id);
    if (result.error) {
        if (table === "members" && result.error.code === "23505") {
            throw new Error(
                "Anggota tidak dapat dipulihkan karena jabatan atau divisinya sudah terisi.",
            );
        }
        throw result.error;
    }
    await refreshAfterMutation(nextValue ? "Data diarsipkan." : "Data dipulihkan.");
}

async function togglePublished(table, id, isPublished) {
    const result = await client.from(table).update({ published: !isPublished }).eq("id", id);
    if (result.error) {
        throw result.error;
    }
    await refreshAfterMutation(isPublished ? "Konten disembunyikan." : "Konten dipublikasikan.");
}

async function updateMessage(id, updates) {
    const result = await client.from("contact_messages").update(updates).eq("id", id);
    if (result.error) {
        throw result.error;
    }
    await refreshAfterMutation("Status pesan diperbarui.");
}

async function uploadImage(file, folder) {
    if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
        throw new Error("Pilih foto JPEG, PNG, atau WebP.");
    }
    if (file.size > MAX_IMAGE_SIZE) {
        throw new Error(
            folder === "members"
                ? "Foto melebihi 10 MB. Gunakan fitur Edit, crop, dan resize sebelum menyimpan."
                : "Foto galeri melebihi batas 10 MB per file.",
        );
    }

    if (file.size === 0) {
        throw new Error("File foto kosong. Pilih foto yang valid.");
    }

    const path = `${folder}/${crypto.randomUUID()}.${ALLOWED_IMAGE_TYPES.get(file.type)}`;
    const result = await client.storage.from(MEDIA_BUCKET).upload(path, file, {
        contentType: file.type,
        cacheControl: "3600",
        upsert: false,
    });
    if (result.error) {
        throw result.error;
    }
    return path;
}

function connectMemberPhotoEditor() {
    const form = document.getElementById("memberForm");
    const fileInput = form.elements.namedItem("photo");
    const preview = document.getElementById("memberPhotoPreview");
    const emptyPreview = document.getElementById("memberPhotoEmpty");
    const editButton = document.getElementById("editMemberPhotoButton");
    const dialog = document.getElementById("memberPhotoEditor");
    const canvas = document.getElementById("photoEditorCanvas");
    const context = canvas.getContext("2d");
    const widthInput = document.getElementById("photoOutputWidth");
    const heightInput = document.getElementById("photoOutputHeight");
    const keepAspect = document.getElementById("photoKeepAspect");
    const zoomInput = document.getElementById("photoZoom");
    const zoomValue = document.getElementById("photoZoomValue");
    const selectCropModeButton = document.getElementById("selectPhotoCropMode");
    const movePhotoModeButton = document.getElementById("movePhotoMode");
    const editorStatus = document.getElementById("photoEditorStatus");
    let previewUrl = null;
    let sourceBitmap = null;
    let crop = null;
    let dragStart = null;
    let dragOffsetStart = null;
    let activeDragMode = null;
    let editorMode = "crop";
    let zoom = 1;
    let photoOffsetX = 0;
    let photoOffsetY = 0;

    function updatePreview(file) {
        if (previewUrl) {
            URL.revokeObjectURL(previewUrl);
            previewUrl = null;
        }

        if (!file) {
            preview.removeAttribute("src");
            preview.hidden = true;
            emptyPreview.hidden = false;
            editButton.disabled = true;
            return;
        }

        previewUrl = URL.createObjectURL(file);
        preview.src = previewUrl;
        preview.hidden = false;
        emptyPreview.hidden = true;
        editButton.disabled = false;
    }

    function cropSourceDimensions() {
        const transform = photoTransform();
        return {
            width: crop.width / transform.scaleX,
            height: crop.height / transform.scaleY,
        };
    }

    function photoTransform() {
        const scaleX = (canvas.width * zoom) / sourceBitmap.width;
        const scaleY = (canvas.height * zoom) / sourceBitmap.height;
        return {
            scaleX,
            scaleY,
            offsetX: photoOffsetX,
            offsetY: photoOffsetY,
        };
    }

    function constrainPhotoPosition() {
        photoOffsetX = Math.max(canvas.width * (1 - zoom), Math.min(0, photoOffsetX));
        photoOffsetY = Math.max(canvas.height * (1 - zoom), Math.min(0, photoOffsetY));
    }

    function setZoom(value, focus) {
        const nextZoom = Math.round(Math.max(1, Math.min(3, value)) * 10) / 10;
        const scale = nextZoom / zoom;
        photoOffsetX = focus.x - (focus.x - photoOffsetX) * scale;
        photoOffsetY = focus.y - (focus.y - photoOffsetY) * scale;
        zoom = nextZoom;
        constrainPhotoPosition();
        zoomInput.value = String(zoom);
        zoomValue.value = `${zoom.toFixed(1)}x`;
        zoomValue.textContent = zoomValue.value;
        updateCropSize();
        drawCrop();
    }

    function setEditorMode(mode, showStatus = true) {
        editorMode = mode;
        const cropModeSelected = mode === "crop";
        selectCropModeButton.classList.toggle("button-primary", cropModeSelected);
        selectCropModeButton.classList.toggle("button-secondary", !cropModeSelected);
        selectCropModeButton.setAttribute("aria-pressed", String(cropModeSelected));
        movePhotoModeButton.classList.toggle("button-primary", !cropModeSelected);
        movePhotoModeButton.classList.toggle("button-secondary", cropModeSelected);
        movePhotoModeButton.setAttribute("aria-pressed", String(!cropModeSelected));
        canvas.classList.toggle("is-pan-mode", !cropModeSelected);
        canvas.setAttribute(
            "aria-label",
            cropModeSelected
                ? "Pilih area crop dengan menyeret pada foto"
                : "Geser foto di dalam area crop",
        );
        if (showStatus && sourceBitmap) {
            setStatus(
                editorStatus,
                cropModeSelected
                    ? "Seret pada foto untuk memilih area crop."
                    : "Seret foto untuk mengatur posisinya. Scroll untuk zoom.",
            );
        }
    }

    function setOutputSize(width, height) {
        const scale = Math.min(1, MAX_EDITED_IMAGE_DIMENSION / Math.max(width, height));
        widthInput.value = String(Math.max(1, Math.round(width * scale)));
        heightInput.value = String(Math.max(1, Math.round(height * scale)));
    }

    function updateCropSize() {
        const dimensions = cropSourceDimensions();
        setOutputSize(dimensions.width, dimensions.height);
    }

    function drawCrop() {
        context.clearRect(0, 0, canvas.width, canvas.height);
        const transform = photoTransform();
        context.drawImage(
            sourceBitmap,
            transform.offsetX,
            transform.offsetY,
            canvas.width * zoom,
            canvas.height * zoom,
        );
        if (!crop) {
            return;
        }

        context.fillStyle = "rgba(15, 23, 42, 0.58)";
        context.fillRect(0, 0, canvas.width, crop.y);
        context.fillRect(0, crop.y, crop.x, crop.height);
        context.fillRect(
            crop.x + crop.width,
            crop.y,
            canvas.width - crop.x - crop.width,
            crop.height,
        );
        context.fillRect(
            0,
            crop.y + crop.height,
            canvas.width,
            canvas.height - crop.y - crop.height,
        );
        context.strokeStyle = "#ffffff";
        context.lineWidth = Math.max(1, canvas.width / 800);
        context.strokeRect(crop.x, crop.y, crop.width, crop.height);
    }

    function canvasPoint(event) {
        const bounds = canvas.getBoundingClientRect();
        return {
            x: Math.max(
                0,
                Math.min(
                    canvas.width,
                    ((event.clientX - bounds.left) * canvas.width) / bounds.width,
                ),
            ),
            y: Math.max(
                0,
                Math.min(
                    canvas.height,
                    ((event.clientY - bounds.top) * canvas.height) / bounds.height,
                ),
            ),
        };
    }

    function closeEditor() {
        if (sourceBitmap) {
            sourceBitmap.close();
            sourceBitmap = null;
        }
        crop = null;
        dragStart = null;
        dragOffsetStart = null;
        activeDragMode = null;
    }

    fileInput.addEventListener("change", () => {
        const file = fileInput.files[0];
        if (!file) {
            updatePreview(null);
            return;
        }
        if (!ALLOWED_IMAGE_TYPES.has(file.type) || file.size > MAX_EDIT_SOURCE_SIZE) {
            fileInput.value = "";
            updatePreview(null);
            setStatus(
                dashboardStatus,
                file.size > MAX_EDIT_SOURCE_SIZE
                    ? "Ukuran foto sumber maksimal 50 MB."
                    : "Pilih foto dalam format JPEG, PNG, atau WebP.",
                true,
            );
            return;
        }
        updatePreview(file);
        setStatus(
            dashboardStatus,
            file.size > MAX_IMAGE_SIZE
                ? "Foto lebih dari 10 MB. Edit, crop, dan resize sebelum menyimpan."
                : "",
        );
    });

    form.addEventListener("reset", () => {
        setTimeout(() => updatePreview(fileInput.files[0] || null), 0);
    });

    editButton.addEventListener("click", async () => {
        const file = fileInput.files[0];
        if (!file) {
            return;
        }
        editButton.disabled = true;
        setStatus(editorStatus, "Memuat foto...");
        try {
            sourceBitmap = await createImageBitmap(file);
            const previewScale = Math.min(
                1,
                1200 / Math.max(sourceBitmap.width, sourceBitmap.height),
            );
            canvas.width = Math.max(1, Math.round(sourceBitmap.width * previewScale));
            canvas.height = Math.max(1, Math.round(sourceBitmap.height * previewScale));
            crop = { x: 0, y: 0, width: canvas.width, height: canvas.height };
            zoom = 1;
            zoomInput.value = "1";
            photoOffsetX = 0;
            photoOffsetY = 0;
            zoomValue.value = "1.0x";
            zoomValue.textContent = "1.0x";
            setEditorMode("crop", false);
            drawCrop();
            updateCropSize();
            setStatus(
                editorStatus,
                "Pilih area crop, lalu pilih Geser foto untuk mengatur posisi. Scroll atau gunakan slider untuk zoom.",
            );
            dialog.showModal();
        } catch (error) {
            console.error("Foto tidak dapat dibuka untuk diedit.", error);
            closeEditor();
            setStatus(
                dashboardStatus,
                "Foto tidak dapat dibuka untuk diedit. Coba pilih file gambar lain.",
                true,
            );
        } finally {
            editButton.disabled = false;
        }
    });

    canvas.addEventListener("pointerdown", (event) => {
        if (!sourceBitmap) {
            return;
        }
        event.preventDefault();
        dragStart = canvasPoint(event);
        activeDragMode = editorMode;
        if (activeDragMode === "move") {
            dragOffsetStart = { x: photoOffsetX, y: photoOffsetY };
        } else {
            crop = { x: dragStart.x, y: dragStart.y, width: 0, height: 0 };
        }
        canvas.setPointerCapture(event.pointerId);
        drawCrop();
    });

    canvas.addEventListener("pointermove", (event) => {
        if (!dragStart) {
            return;
        }
        const point = canvasPoint(event);
        if (activeDragMode === "move") {
            photoOffsetX = dragOffsetStart.x + point.x - dragStart.x;
            photoOffsetY = dragOffsetStart.y + point.y - dragStart.y;
            constrainPhotoPosition();
            drawCrop();
            return;
        }
        crop = {
            x: Math.min(dragStart.x, point.x),
            y: Math.min(dragStart.y, point.y),
            width: Math.abs(point.x - dragStart.x),
            height: Math.abs(point.y - dragStart.y),
        };
        drawCrop();
    });

    canvas.addEventListener("pointerup", () => {
        if (!dragStart) {
            return;
        }
        const completedMode = activeDragMode;
        dragStart = null;
        dragOffsetStart = null;
        activeDragMode = null;
        if (completedMode === "move") {
            return;
        }
        if (crop.width < 4 || crop.height < 4) {
            crop = { x: 0, y: 0, width: canvas.width, height: canvas.height };
        }
        updateCropSize();
        drawCrop();
    });
    canvas.addEventListener("pointercancel", () => {
        const cancelledMode = activeDragMode;
        dragStart = null;
        dragOffsetStart = null;
        activeDragMode = null;
        if (cancelledMode === "crop") {
            crop = { x: 0, y: 0, width: canvas.width, height: canvas.height };
            updateCropSize();
        }
        drawCrop();
    });

    document.getElementById("resetPhotoCropButton").addEventListener("click", () => {
        crop = { x: 0, y: 0, width: canvas.width, height: canvas.height };
        zoom = 1;
        zoomInput.value = "1";
        photoOffsetX = 0;
        photoOffsetY = 0;
        zoomValue.value = "1.0x";
        zoomValue.textContent = "1.0x";
        setEditorMode("crop", false);
        updateCropSize();
        drawCrop();
        setStatus(editorStatus, "Crop dan zoom diatur ulang ke seluruh foto.");
    });

    zoomInput.addEventListener("input", () => {
        const focus = crop
            ? { x: crop.x + crop.width / 2, y: crop.y + crop.height / 2 }
            : { x: canvas.width / 2, y: canvas.height / 2 };
        setZoom(Number(zoomInput.value), focus);
        setStatus(editorStatus, `Zoom ${zoom.toFixed(1)}x. Sesuaikan crop dan ukuran hasil.`);
    });

    canvas.addEventListener("wheel", (event) => {
        if (!sourceBitmap) {
            return;
        }
        event.preventDefault();
        const nextZoom = zoom + (event.deltaY < 0 ? 0.1 : -0.1);
        setZoom(nextZoom, canvasPoint(event));
        setStatus(editorStatus, `Zoom ${zoom.toFixed(1)}x. Geser foto atau sesuaikan area crop.`);
    });

    selectCropModeButton.addEventListener("click", () => setEditorMode("crop"));
    movePhotoModeButton.addEventListener("click", () => setEditorMode("move"));

    widthInput.addEventListener("input", () => {
        if (keepAspect.checked && Number(widthInput.value) > 0) {
            const dimensions = cropSourceDimensions();
            heightInput.value = String(
                Math.max(
                    1,
                    Math.round((Number(widthInput.value) * dimensions.height) / dimensions.width),
                ),
            );
        }
    });
    heightInput.addEventListener("input", () => {
        if (keepAspect.checked && Number(heightInput.value) > 0) {
            const dimensions = cropSourceDimensions();
            widthInput.value = String(
                Math.max(
                    1,
                    Math.round((Number(heightInput.value) * dimensions.width) / dimensions.height),
                ),
            );
        }
    });
    keepAspect.addEventListener("change", () => {
        if (keepAspect.checked) {
            const dimensions = cropSourceDimensions();
            const width = Number(widthInput.value) || dimensions.width;
            setOutputSize(width, (width * dimensions.height) / dimensions.width);
        }
    });

    document.getElementById("applyPhotoEditButton").addEventListener("click", async () => {
        if (!sourceBitmap || !crop || crop.width < 1 || crop.height < 1) {
            setStatus(editorStatus, "Pilih area crop yang valid.", true);
            return;
        }
        const outputWidth = Number(widthInput.value);
        const outputHeight = Number(heightInput.value);
        if (
            !Number.isInteger(outputWidth) ||
            !Number.isInteger(outputHeight) ||
            outputWidth < 1 ||
            outputHeight < 1 ||
            outputWidth > MAX_EDITED_IMAGE_DIMENSION ||
            outputHeight > MAX_EDITED_IMAGE_DIMENSION ||
            outputWidth * outputHeight > MAX_EDITED_IMAGE_DIMENSION * MAX_EDITED_IMAGE_DIMENSION
        ) {
            setStatus(
                editorStatus,
                `Ukuran hasil harus 1-${MAX_EDITED_IMAGE_DIMENSION} px pada tiap sisi.`,
                true,
            );
            return;
        }

        const button = document.getElementById("applyPhotoEditButton");
        button.disabled = true;
        setStatus(editorStatus, "Memproses foto...");
        try {
            const outputCanvas = document.createElement("canvas");
            outputCanvas.width = outputWidth;
            outputCanvas.height = outputHeight;
            const outputContext = outputCanvas.getContext("2d");
            const transform = photoTransform();
            const sourceX = (crop.x - transform.offsetX) / transform.scaleX;
            const sourceY = (crop.y - transform.offsetY) / transform.scaleY;
            const sourceWidth = crop.width / transform.scaleX;
            const sourceHeight = crop.height / transform.scaleY;
            outputContext.drawImage(
                sourceBitmap,
                sourceX,
                sourceY,
                sourceWidth,
                sourceHeight,
                0,
                0,
                outputWidth,
                outputHeight,
            );
            const blob = await new Promise((resolve) =>
                outputCanvas.toBlob(resolve, "image/webp", 0.9),
            );
            if (!blob || !ALLOWED_IMAGE_TYPES.has(blob.type)) {
                throw new Error("Browser tidak dapat membuat file foto hasil edit.");
            }
            if (blob.size > MAX_IMAGE_SIZE) {
                throw new Error("Ukuran hasil melebihi 10 MB. Kurangi ukuran lebar atau tinggi.");
            }

            const extension = ALLOWED_IMAGE_TYPES.get(blob.type);
            const baseName = fileInput.files[0].name.replace(/\.[^.]+$/, "") || "foto";
            const editedFile = new File([blob], `${baseName}-edit.${extension}`, {
                type: blob.type,
                lastModified: Date.now(),
            });
            const transfer = new DataTransfer();
            transfer.items.add(editedFile);
            fileInput.files = transfer.files;
            fileInput.dispatchEvent(new Event("change", { bubbles: true }));
            setStatus(
                dashboardStatus,
                "Foto sudah diedit. Simpan anggota untuk menerapkan perubahan.",
            );
            dialog.close();
        } catch (error) {
            console.error("Foto gagal diproses.", error);
            setStatus(editorStatus, error.message || "Foto gagal diproses.", true);
        } finally {
            button.disabled = false;
        }
    });

    document
        .getElementById("closePhotoEditorButton")
        .addEventListener("click", () => dialog.close());
    dialog.addEventListener("close", closeEditor);
}

async function saveEntity(form, table, fields, folder, fileField) {
    const formData = new FormData(form);
    const id = formData.get("id") || null;
    const payload = {};
    if (
        table === "activities" &&
        activityRegistrationSchemaAvailable &&
        form.elements.namedItem("registration_enabled").checked
    ) {
        const isFree = form.elements.namedItem("registration_is_free").checked;
        if (!form.elements.namedItem("registration_terms").value.trim()) {
            throw new Error("Isi syarat dan ketentuan sebelum membuka pendaftaran.");
        }
        if (!isFree) {
            const fee = Number(form.elements.namedItem("registration_fee").value);
            const deadline = new Date(
                form.elements.namedItem("registration_payment_deadline").value,
            );
            const groupLink = form.elements
                .namedItem("registration_whatsapp_group_link")
                .value.trim();
            if (!Number.isInteger(fee) || fee < 1000 || fee > 10000000) {
                throw new Error("Biaya pendaftaran harus antara Rp1.000 dan Rp10.000.000.");
            }
            if (Number.isNaN(deadline.getTime()) || deadline <= new Date()) {
                throw new Error(
                    "Batas pembayaran harus berupa tanggal dan waktu yang akan datang.",
                );
            }
            if (!isValidActivityGroupInviteUrl(groupLink)) {
                throw new Error(
                    "Masukkan tautan undangan grup WhatsApp, Telegram, atau Discord yang valid.",
                );
            }
        }
    }
    const privateActivityFields =
        table === "activities" ? ["registration_whatsapp_group_link"] : [];
    const activeFields = fields.filter((field) => {
        if (privateActivityFields.includes(field)) {
            return false;
        }
        return (
            table !== "activities" ||
            activityRegistrationSchemaAvailable ||
            ![
                "registration_enabled",
                "registration_capacity",
                "registration_terms",
                "registration_is_free",
                "registration_fee",
                "registration_payment_deadline",
            ].includes(field)
        );
    });
    activeFields.forEach((field) => {
        const input = form.elements.namedItem(field);
        if (input.type === "checkbox") {
            payload[field] = input.checked;
        } else if (input.type === "number") {
            payload[field] =
                field === "registration_capacity" && !input.value ? null : Number(input.value || 0);
        } else if (input.type === "date" && !input.value) {
            payload[field] = null;
        } else if (input.type === "datetime-local") {
            payload[field] = input.value ? new Date(input.value).toISOString() : null;
        } else {
            payload[field] = input.value.trim();
        }
    });
    const whatsappGroupLink =
        table === "activities" && activityRegistrationSchemaAvailable
            ? form.elements.namedItem("registration_whatsapp_group_link").value.trim()
            : "";
    if (whatsappGroupLink && !isValidActivityGroupInviteUrl(whatsappGroupLink)) {
        throw new Error(
            "Masukkan tautan undangan grup WhatsApp, Telegram, atau Discord yang valid.",
        );
    }

    if (table === "members") {
        await validateMemberPosition(payload, id);
    }

    let uploadedPath = null;
    const filePathField = fileField === "photo" ? "photo_path" : "cover_path";
    let oldPath = fileField ? formData.get(filePathField) : null;
    if (fileField) {
        const file = form.elements.namedItem(fileField).files[0];
        if (file) {
            uploadedPath = await uploadImage(file, folder);
            payload[filePathField] = uploadedPath;
        } else {
            payload[filePathField] = oldPath || null;
        }
    }

    payload.updated_at = new Date().toISOString();
    let result = id
        ? await client.from(table).update(payload).eq("id", id).select("id").single()
        : await client.from(table).insert(payload).select("id").single();
    if (result.error) {
        if (uploadedPath) {
            await client.storage.from(MEDIA_BUCKET).remove([uploadedPath]);
        }
        if (table === "members" && result.error.code === "23505") {
            throw new Error(
                memberPositionConflictMessage(payload.position, payload.division, result.error),
            );
        }
        throw result.error;
    }

    if (table === "activities" && activityRegistrationSchemaAvailable) {
        const activityId = result.data.id;
        const privateSettingsResult = whatsappGroupLink
            ? await client.from("activity_registration_private_settings").upsert(
                  {
                      activity_id: activityId,
                      whatsapp_group_link: whatsappGroupLink,
                      updated_at: new Date().toISOString(),
                  },
                  { onConflict: "activity_id" },
              )
            : await client
                  .from("activity_registration_private_settings")
                  .delete()
                  .eq("activity_id", activityId);
        if (privateSettingsResult.error) {
            console.error("Tautan grup kegiatan gagal disimpan.", privateSettingsResult.error);
            throw new Error(
                "Kegiatan tersimpan, tetapi tautan grup peserta belum berhasil disimpan. Edit kegiatan lalu coba lagi.",
            );
        }
    }

    let photoCleanupWarning = "";
    if (uploadedPath && oldPath && uploadedPath !== oldPath) {
        const removal = await client.storage.from(MEDIA_BUCKET).remove([oldPath]);
        if (removal.error) {
            console.error("Foto lama belum dapat dihapus dari Storage.", removal.error);
            photoCleanupWarning = "Data tersimpan, tetapi foto lama belum terhapus dari Storage.";
        }
    }

    form.reset();
    form.elements.namedItem("id").value = "";
    if (form.elements.namedItem("photo_path")) {
        form.elements.namedItem("photo_path").value = "";
    }
    await refreshAfterMutation(photoCleanupWarning || "Data tersimpan.");
}

async function uploadActivityMedia(form) {
    const files = Array.from(form.elements.namedItem("files").files);
    const activityId = form.elements.namedItem("activity_id").value;
    const documentedOn = form.elements.namedItem("documented_on").value;
    const caption = form.elements.namedItem("caption").value.trim();
    const published = form.elements.namedItem("published").checked;

    if (
        !activityId ||
        !cachedActivities.some((activity) => activity.id === activityId && !activity.archived_at)
    ) {
        throw new Error("Pilih kegiatan yang masih aktif.");
    }
    if (!documentedOn || !/^\d{4}-\d{2}-\d{2}$/.test(documentedOn)) {
        throw new Error("Isi tanggal dokumentasi yang valid.");
    }
    if (!files.length || files.length > MAX_ACTIVITY_MEDIA_FILES) {
        throw new Error(`Pilih 1 sampai ${MAX_ACTIVITY_MEDIA_FILES} file untuk satu kali unggah.`);
    }
    if (caption.length > 500) {
        throw new Error("Keterangan maksimal 500 karakter.");
    }

    const invalidFile = files.find(
        (file) =>
            !ALLOWED_ACTIVITY_MEDIA_TYPES.has(file.type) ||
            file.size === 0 ||
            file.size > MAX_ACTIVITY_MEDIA_SIZE,
    );
    if (invalidFile) {
        throw new Error(
            `"${invalidFile.name}" memiliki format yang tidak didukung atau melebihi 10 MB.`,
        );
    }

    const uploadedPaths = [];
    try {
        const records = [];
        for (const file of files) {
            const extension = ALLOWED_ACTIVITY_MEDIA_TYPES.get(file.type);
            const path = activityMediaPath(
                activityId,
                documentedOn,
                crypto.randomUUID(),
                extension,
            );
            const uploadResult = await client.storage.from(MEDIA_BUCKET).upload(path, file, {
                contentType: file.type,
                cacheControl: "3600",
                upsert: false,
            });
            if (uploadResult.error) {
                throw uploadResult.error;
            }
            uploadedPaths.push(path);
            records.push({
                activity_id: activityId,
                storage_path: path,
                file_name:
                    file.name.trim().replace(/[\\/]/g, "_").slice(0, 255) ||
                    `dokumentasi.${extension}`,
                content_type: file.type,
                documented_on: documentedOn,
                caption,
                published,
            });
        }

        const result = await client.from("activity_media").insert(records);
        if (result.error) {
            throw result.error;
        }
    } catch (error) {
        if (uploadedPaths.length) {
            const cleanup = await client.storage.from(MEDIA_BUCKET).remove(uploadedPaths);
            if (cleanup.error) {
                console.error(
                    "Sebagian dokumentasi gagal dibersihkan setelah batch unggah gagal.",
                    cleanup.error,
                );
                throw new Error(
                    "Unggah gagal dan sebagian file perlu dibersihkan dari Supabase Storage.",
                );
            }
        }
        throw error;
    }

    form.reset();
    form.elements.namedItem("documented_on").value = getLocalDateInputValue();
    await refreshAfterMutation(`Data tersimpan. ${files.length} file berhasil diunggah.`);
}

async function deletePhoto(photo) {
    await deleteRecord(
        "gallery_photos",
        photo.id,
        "Foto galeri",
        photo.storage_path,
        photo.caption || photo.alt_text || "Foto galeri",
    );
}

async function deleteRecord(table, id, label, storagePath = null, recordName = "") {
    const dialog = document.getElementById("deleteConfirmDialog");
    document.getElementById("deleteConfirmName").textContent = recordName || label;
    document.getElementById("deleteConfirmMessage").textContent =
        table === "activities"
            ? `${label} dan seluruh catatan dokumentasinya akan dihapus secara permanen.`
            : `${label} ini akan dihapus secara permanen.`;
    document.getElementById("deleteConfirmWarning").textContent = storagePath
        ? "Tindakan ini tidak dapat dibatalkan. File terkait juga akan dihapus dari penyimpanan."
        : "Tindakan ini tidak dapat dibatalkan dan data tidak dapat dipulihkan.";
    dialog.returnValue = "";
    const confirmed = await new Promise((resolve) => {
        dialog.addEventListener("close", () => resolve(dialog.returnValue === "confirm"), {
            once: true,
        });
        dialog.showModal();
    });
    if (!confirmed) {
        return;
    }

    let relatedMediaPaths = [];
    if (table === "activities") {
        const mediaResult = await client
            .from("activity_media")
            .select("storage_path")
            .eq("activity_id", id);
        if (mediaResult.error && !isActivityMediaTableUnavailable(mediaResult.error)) {
            throw mediaResult.error;
        }
        relatedMediaPaths = mediaResult.data?.map((media) => media.storage_path) || [];
    }

    const result = await client.from(table).delete().eq("id", id).select("id").single();
    if (result.error) {
        throw result.error;
    }
    let storageCleanupFailed = false;
    if (storagePath) {
        try {
            const storageResult = await client.storage.from(MEDIA_BUCKET).remove([storagePath]);
            if (storageResult.error) {
                throw storageResult.error;
            }
        } catch (error) {
            console.error(
                `${label} dihapus, tetapi file terkait belum terhapus dari Storage.`,
                error,
            );
            storageCleanupFailed = true;
        }
    }
    if (relatedMediaPaths.length) {
        try {
            const storageResult = await client.storage.from(MEDIA_BUCKET).remove(relatedMediaPaths);
            if (storageResult.error) {
                throw storageResult.error;
            }
        } catch (error) {
            console.error(
                "Kegiatan dihapus, tetapi sebagian dokumentasi belum terhapus dari Storage.",
                error,
            );
            storageCleanupFailed = true;
        }
    }
    await refreshAfterMutation(
        storageCleanupFailed
            ? `${label} dihapus, tetapi file terkait perlu dibersihkan dari Supabase Storage.`
            : `${label} berhasil dihapus.`,
    );
    if (storageCleanupFailed) {
        setStatus(
            dashboardStatus,
            `${label} dihapus, tetapi file terkait perlu dibersihkan dari Supabase Storage.`,
            true,
        );
    }
}

function connectForm(formId, table, fields, folder, fileField) {
    const form = document.getElementById(formId);
    form.addEventListener("reset", () => {
        setTimeout(() => {
            const id = form.elements.namedItem("id");
            if (id) {
                id.value = "";
            }
            const photoPath = form.elements.namedItem("photo_path");
            if (photoPath) {
                photoPath.value = "";
            }
        }, 0);
    });
    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const selectedFile = fileField && form.elements.namedItem(fileField).files.length > 0;
        setStatus(
            dashboardStatus,
            selectedFile ? "Mengunggah foto dan menyimpan data..." : "Menyimpan data...",
        );
        setFormBusy(form, true);
        try {
            await saveEntity(form, table, fields, folder, fileField);
        } catch (error) {
            console.error(`Penyimpanan ${table} gagal.`, error);
            const detail = typeof error?.message === "string" ? ` ${error.message}` : "";
            setStatus(
                dashboardStatus,
                `Perubahan gagal disimpan.${detail || " Periksa isian dan izin Supabase."}`,
                true,
            );
        } finally {
            setFormBusy(form, false);
        }
    });
}

function connectActivityMediaForm() {
    const form = document.getElementById("activityMediaForm");
    form.elements.namedItem("documented_on").value = getLocalDateInputValue();
    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        setStatus(dashboardStatus, "Mengunggah dokumentasi...");
        setFormBusy(form, true);
        try {
            await uploadActivityMedia(form);
        } catch (error) {
            console.error("Unggah dokumentasi kegiatan gagal.", error);
            setStatus(dashboardStatus, error.message || "Dokumentasi gagal diunggah.", true);
        } finally {
            setFormBusy(form, false);
        }
    });
}

function syncActivityRegistrationDateRequirement() {
    const form = document.getElementById("activityForm");
    const enabled = form.elements.namedItem("registration_enabled").checked;
    const isFree = form.elements.namedItem("registration_is_free").checked;
    const paidFields = document.getElementById("activityRegistrationPaidFields");
    form.elements.namedItem("event_date").required = enabled;
    form.elements.namedItem("registration_terms").required = enabled;
    form.elements.namedItem("registration_fee").required = enabled && !isFree;
    form.elements.namedItem("registration_payment_deadline").required = enabled && !isFree;
    form.elements.namedItem("registration_whatsapp_group_link").required = enabled && !isFree;
    paidFields.hidden = isFree;
}

function connectActivityRegistrationSettings() {
    const form = document.getElementById("activityForm");
    form.elements
        .namedItem("registration_enabled")
        .addEventListener("change", syncActivityRegistrationDateRequirement);
    form.elements
        .namedItem("registration_is_free")
        .addEventListener("change", syncActivityRegistrationDateRequirement);
    form.addEventListener("reset", () => {
        setTimeout(syncActivityRegistrationDateRequirement, 0);
    });
}

function connectPaymentGatewaySettings() {
    const form = document.getElementById("paymentGatewaySettingsForm");
    const status = document.getElementById("paymentGatewayStatus");
    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const mode = form.elements.namedItem("mode").value;
        if (!paymentGatewaySettingsAvailable || !["live", "sandbox"].includes(mode)) {
            setStatus(status, "Konfigurasi pembayaran belum tersedia atau tidak valid.", true);
            return;
        }

        setFormBusy(form, true);
        try {
            const result = await client
                .from("payment_gateway_settings")
                .update({ mode, updated_at: new Date().toISOString() })
                .eq("singleton", true)
                .select("mode")
                .single();
            if (result.error) {
                throw result.error;
            }

            const message =
                result.data.mode === "sandbox"
                    ? "Mode Sandbox aktif. Transaksi baru tidak memanggil Zapay."
                    : "Mode Live aktif. Pastikan API key live tersedia di Environment Variables Vercel.";
            setStatus(status, message);
            await refreshAfterMutation(`Mode pembayaran ${result.data.mode} berhasil disimpan.`);
        } catch (error) {
            console.error("Konfigurasi mode pembayaran gagal disimpan.", error);
            setStatus(
                status,
                "Mode pembayaran gagal disimpan. Periksa koneksi dan izin admin.",
                true,
            );
        } finally {
            setFormBusy(form, false);
        }
    });
}

function connectLogin() {
    const form = document.getElementById("loginForm");
    const status = document.getElementById("loginStatus");
    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        setStatus(status, "");
        setFormBusy(form, true);
        try {
            const identifier = form.elements.namedItem("username").value.trim();
            const email = identifier.includes("@")
                ? identifier
                : `${identifier.toLowerCase()}@${ADMIN_LOGIN_EMAIL_DOMAIN}`;
            const result = await client.auth.signInWithPassword({
                email,
                password: form.elements.namedItem("password").value,
            });
            if (result.error) {
                throw result.error;
            }
            await showDashboard();
        } catch (error) {
            console.error("Login admin gagal.", error);
            setStatus(
                status,
                "Login gagal. Periksa email, kata sandi, dan status undangan admin.",
                true,
            );
        } finally {
            setFormBusy(form, false);
        }
    });
}

function connectAdminAccountForm() {
    const form = document.getElementById("adminAccountForm");
    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const username = form.elements.namedItem("username").value.trim().toLowerCase();
        const password = form.elements.namedItem("password").value;
        if (!/^[a-z0-9](?:[a-z0-9._-]{1,30}[a-z0-9])$/.test(username) || username.includes("..")) {
            setStatus(
                dashboardStatus,
                "Username harus 3–32 karakter, diawali dan diakhiri huruf atau angka.",
                true,
            );
            return;
        }
        if (password.length < 6 || password.length > 128) {
            setStatus(
                dashboardStatus,
                "Kata sandi harus terdiri dari 6 hingga 128 karakter.",
                true,
            );
            return;
        }

        setFormBusy(form, true);
        setStatus(dashboardStatus, "Membuat akun admin...");
        try {
            const sessionResult = await client.auth.getSession();
            if (sessionResult.error) {
                throw sessionResult.error;
            }
            const accessToken = sessionResult.data.session?.access_token;
            if (!accessToken) {
                throw new Error("Sesi admin sudah berakhir. Silakan masuk kembali.");
            }

            const response = await fetch("/api/admin-users", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${accessToken}`,
                },
                body: JSON.stringify({ username, password }),
            });
            let payload;
            try {
                payload = await response.json();
            } catch {
                payload = null;
            }
            if (!response.ok) {
                const messages = {
                    username_taken: "Username tersebut sudah digunakan.",
                    forbidden: "Hanya admin utama yang diizinkan dapat membuat akun admin.",
                    invalid_admin_details: "Username atau kata sandi tidak memenuhi ketentuan.",
                };
                throw new Error(
                    messages[payload?.error] ||
                        "Akun admin gagal dibuat. Periksa konfigurasi server dan coba lagi.",
                );
            }

            form.reset();
            setStatus(dashboardStatus, `Akun admin "${username}" berhasil dibuat.`);
        } catch (error) {
            console.error("Pembuatan akun admin gagal.", error);
            setStatus(
                dashboardStatus,
                error.message || "Akun admin gagal dibuat. Silakan coba lagi.",
                true,
            );
        } finally {
            setFormBusy(form, false);
        }
    });
}

function connectDashboard() {
    dashboardStatus = document.getElementById("dashboardStatus");
    connectMemberPositionFields();
    document.querySelectorAll(".tab-button").forEach((button) => {
        button.addEventListener("click", () => setTab(button.dataset.tab));
    });
    document.getElementById("signOutButton").addEventListener("click", async () => {
        const result = await client.auth.signOut();
        if (result.error) {
            console.error("Logout admin gagal.", result.error);
            setStatus(dashboardStatus, "Tidak dapat keluar. Silakan coba lagi.", true);
            return;
        }
        await showLogin();
    });
    document.getElementById("passwordForm").addEventListener("submit", async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const password = form.elements.namedItem("password").value;
        if (password.length < 6 || password.length > 128) {
            setStatus(
                dashboardStatus,
                "Kata sandi harus terdiri dari 6 hingga 128 karakter.",
                true,
            );
            return;
        }

        setFormBusy(form, true);
        try {
            const result = await client.auth.updateUser({ password });
            if (result.error) {
                throw result.error;
            }
            form.reset();
            setStatus(dashboardStatus, "Kata sandi berhasil diperbarui.");
        } catch (error) {
            console.error("Pembaruan kata sandi admin gagal.", error);
            setStatus(
                dashboardStatus,
                "Kata sandi belum dapat diperbarui. Silakan coba lagi.",
                true,
            );
        } finally {
            setFormBusy(form, false);
        }
    });
    connectAdminAccountForm();
    document.getElementById("siteMode").addEventListener("change", (event) => {
        updateSiteModeDescription(event.currentTarget.value);
    });
    document.getElementById("siteModeForm").addEventListener("submit", async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const mode = form.elements.namedItem("setting_value").value;
        const maintenanceNote = form.elements.namedItem("maintenance_note").value.trim();
        if (mode !== "public" && mode !== "maintenance") {
            setStatus(dashboardStatus, "Pilih mode website yang valid.", true);
            return;
        }
        if (maintenanceNote.length > 500) {
            setStatus(dashboardStatus, "Catatan maintenance maksimal 500 karakter.", true);
            return;
        }

        setFormBusy(form, true);
        try {
            const result = await client
                .from("site_settings")
                .update({
                    setting_value: mode,
                    maintenance_note: maintenanceNote,
                    updated_at: new Date().toISOString(),
                })
                .eq("setting_key", "website_mode")
                .select("setting_value, maintenance_note")
                .single();
            if (result.error) {
                throw result.error;
            }

            updateSiteModeDescription(result.data.setting_value);
            document.getElementById("maintenanceNote").value = result.data.maintenance_note || "";
            setStatus(
                dashboardStatus,
                result.data.setting_value === "maintenance"
                    ? "Mode maintenance aktif dan catatan ditampilkan kepada pengunjung."
                    : "Mode public aktif. Website dapat diakses pengunjung.",
            );
        } catch (error) {
            console.error("Perubahan mode website gagal.", error);
            setStatus(
                dashboardStatus,
                "Mode website gagal diubah. Periksa koneksi dan izin admin.",
                true,
            );
        } finally {
            setFormBusy(form, false);
        }
    });

    connectForm(
        "memberForm",
        "members",
        [
            "name",
            "position",
            "division",
            "duties",
            "period",
            "sort_order",
            "is_featured",
            "published",
        ],
        "members",
        "photo",
    );
    connectMemberPhotoEditor();
    connectForm("programForm", "programs", [
        "title",
        "description",
        "period",
        "sort_order",
        "published",
    ]);
    connectForm(
        "activityForm",
        "activities",
        [
            "title",
            "description",
            "category",
            "event_date",
            "sort_order",
            "published",
            "registration_enabled",
            "registration_capacity",
            "registration_terms",
            "registration_is_free",
            "registration_fee",
            "registration_payment_deadline",
            "registration_whatsapp_group_link",
        ],
        "activities",
        "cover",
    );
    connectActivityRegistrationSettings();
    connectPaymentGatewaySettings();
    connectActivityMediaForm();
}

async function startAdmin() {
    const loginStatus = document.getElementById("loginStatus");
    try {
        client = await window.hmpssiSupabaseReady;
        connectLogin();
        connectDashboard();
        const result = await client.auth.getSession();
        if (result.error) {
            throw result.error;
        }
        if (result.data.session) {
            try {
                await showDashboard();
            } catch (error) {
                console.error("Dashboard belum dapat dimuat.", error);
                setStatus(
                    loginStatus,
                    "Tidak dapat memeriksa sesi admin. Periksa koneksi lalu muat ulang halaman.",
                    true,
                );
            }
        }
        client.auth.onAuthStateChange((event) => {
            if (event === "SIGNED_OUT") {
                showLogin();
            }
        });
    } catch (error) {
        console.error("Dashboard belum dapat terhubung.", error);
        setStatus(
            loginStatus,
            "Konfigurasi Supabase belum tersedia. Dashboard belum dapat digunakan.",
            true,
        );
        document.querySelectorAll("#loginForm input, #loginForm button").forEach((input) => {
            input.disabled = true;
        });
    }
}

startAdmin();
