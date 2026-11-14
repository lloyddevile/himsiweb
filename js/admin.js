const MEDIA_BUCKET = "hmpssi-media";
const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
const MAX_EDIT_SOURCE_SIZE = 50 * 1024 * 1024;
const MAX_EDITED_IMAGE_DIMENSION = 4096;
const ALLOWED_IMAGE_TYPES = new Map([
    ["image/jpeg", "jpg"],
    ["image/png", "png"],
    ["image/webp", "webp"],
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
    contact_messages: "Pesan masuk",
    site_settings: "Mode website",
};

let client;
let dashboardStatus;
let activeTab = "members";
let cachedActivities = [];

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
            setStatus(dashboardStatus, `Aksi gagal.${detail || " Periksa koneksi dan izin admin, lalu coba lagi."}`, true);
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
    if (result.error || result.data !== true) {
        await client.auth.signOut();
        await showLogin();
        setStatus(document.getElementById("loginStatus"), "Akun ini belum diberi akses admin.", true);
        return;
    }

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
    } else if (tab === "gallery") {
        await Promise.all([loadActivities(), loadGallery()]);
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
    description.textContent = mode === "maintenance"
        ? "Halaman publik akan menampilkan pemberitahuan maintenance. Dashboard admin tetap tersedia."
        : "Website dapat diakses pengunjung seperti biasa.";
}

async function loadSiteMode() {
    const result = await client.from("site_settings")
        .select("setting_value")
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
    updateSiteModeDescription(mode);
}

async function refreshAfterMutation(successMessage) {
    try {
        await loadTab(activeTab);
        setStatus(dashboardStatus, successMessage);
    } catch (error) {
        console.error("Perubahan tersimpan, tetapi data dashboard gagal dimuat ulang.", error);
        setStatus(dashboardStatus, `${successMessage} Data tersimpan, tetapi tampilan belum dapat diperbarui.`, true);
    }
}

async function loadMembers() {
    const result = await client.from("members")
        .select("id,name,position,division,duties,period,photo_path,sort_order,is_featured,published,archived_at")
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
            [member.period, statusLabel(member), member.is_featured ? "Tampil di beranda" : ""].filter(Boolean).join(" · ")
        );
        actions.append(
            createAction("Edit", () => editMember(member)),
            createAction(member.archived_at ? "Pulihkan" : "Arsipkan", () => archiveRecord("members", member.id, member.archived_at)),
            createAction("Hapus anggota", () => deleteRecord("members", member.id, "Anggota", member.photo_path, member.name), "button button-danger")
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
    form.elements.namedItem("position").value = member.position;
    form.elements.namedItem("division").value = member.division;
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
    const result = await client.from("programs")
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
            [program.period, statusLabel(program)].filter(Boolean).join(" · ")
        );
        actions.append(
            createAction("Edit", () => editProgram(program)),
            createAction(program.archived_at ? "Pulihkan" : "Arsipkan", () => archiveRecord("programs", program.id, program.archived_at)),
            createAction("Hapus program", () => deleteRecord("programs", program.id, "Program kerja", null, program.title), "button button-danger")
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
    const result = await client.from("activities")
        .select("id,title,description,category,event_date,cover_path,sort_order,published,archived_at")
        .order("event_date", { ascending: false })
        .limit(300);
    if (result.error) {
        throw result.error;
    }

    cachedActivities = result.data;
    const activitySelect = document.querySelector('#galleryForm select[name="activity_id"]');
    if (activitySelect) {
        activitySelect.replaceChildren(new Option("Tanpa kegiatan terkait", ""));
        cachedActivities.filter((activity) => !activity.archived_at).forEach((activity) => {
            activitySelect.add(new Option(activity.title, activity.id));
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
            [activity.category, activity.event_date, statusLabel(activity)].filter(Boolean).join(" · ")
        );
        actions.append(
            createAction("Edit", () => editActivity(activity)),
            createAction(activity.archived_at ? "Pulihkan" : "Arsipkan", () => archiveRecord("activities", activity.id, activity.archived_at)),
            createAction("Hapus kegiatan", () => deleteRecord("activities", activity.id, "Kegiatan", activity.cover_path, activity.title), "button button-danger")
        );
        list.append(card);
    });
}

function editActivity(activity) {
    const form = document.getElementById("activityForm");
    form.elements.namedItem("id").value = activity.id;
    form.elements.namedItem("title").value = activity.title;
    form.elements.namedItem("description").value = activity.description || "";
    form.elements.namedItem("category").value = activity.category;
    form.elements.namedItem("event_date").value = activity.event_date || "";
    form.elements.namedItem("sort_order").value = activity.sort_order;
    form.elements.namedItem("published").checked = activity.published;
    form.scrollIntoView({ behavior: "smooth", block: "start" });
    form.elements.namedItem("title").focus();
}

async function loadGallery() {
    const result = await client.from("gallery_photos")
        .select("id,activity_id,storage_path,image_url,alt_text,caption,sort_order,published,archived_at")
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
        image.src = photo.storage_path ? await storageUrl(photo.storage_path) : photo.image_url;
        image.alt = photo.alt_text;
        image.loading = "lazy";
        const activity = cachedActivities.find((item) => item.id === photo.activity_id);
        const title = element("h3", "", photo.caption || activity?.title || "Foto galeri");
        const meta = element("p", "", `${statusLabel(photo)}${activity ? ` · ${activity.title}` : ""}`);
        const actions = element("div", "record-actions");
        actions.append(
            createAction(photo.published ? "Sembunyikan" : "Publikasikan", () => togglePublished("gallery_photos", photo.id, photo.published)),
            createAction(photo.archived_at ? "Pulihkan" : "Arsipkan", () => archiveRecord("gallery_photos", photo.id, photo.archived_at)),
            createAction("Hapus foto", () => deletePhoto(photo), "button button-danger")
        );
        card.append(image, title, meta, actions);
        list.append(card);
    }
}

async function loadMessages() {
    const result = await client.from("contact_messages")
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
            `${new Date(message.created_at).toLocaleString("id-ID")}${message.is_read ? " · Dibaca" : " · Baru"}${message.archived_at ? " · Diarsipkan" : ""}`
        );
        card.firstElementChild.append(element("p", "", message.message));
        const email = element("a", "button button-secondary", "Balas via email");
        email.href = `mailto:${encodeURIComponent(message.email)}?subject=${encodeURIComponent(`Re: ${message.subject}`)}`;
        actions.append(
            email,
            createAction(message.is_read ? "Tandai belum dibaca" : "Tandai dibaca", () => updateMessage(message.id, { is_read: !message.is_read })),
            createAction(message.archived_at ? "Pulihkan" : "Arsipkan", () => archiveRecord("contact_messages", message.id, message.archived_at)),
            createAction("Hapus pesan", () => deleteRecord("contact_messages", message.id, "Pesan masuk", null, message.subject), "button button-danger")
        );
        list.append(card);
    });
}

async function loadAuditLog() {
    const result = await client.from("admin_audit_logs")
        .select("id,actor_user_id,actor_email,action,entity_name,record_label,changed_fields,details,created_at")
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
            `${entity} · ${timestamp}`
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
        throw new Error(folder === "members"
            ? "Foto melebihi 10 MB. Gunakan fitur Edit, crop, dan resize sebelum menyimpan."
            : "Foto galeri melebihi batas 10 MB per file.");
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
        const scaleX = canvas.width * zoom / sourceBitmap.width;
        const scaleY = canvas.height * zoom / sourceBitmap.height;
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
            cropModeSelected ? "Pilih area crop dengan menyeret pada foto" : "Geser foto di dalam area crop"
        );
        if (showStatus && sourceBitmap) {
            setStatus(
                editorStatus,
                cropModeSelected
                    ? "Seret pada foto untuk memilih area crop."
                    : "Seret foto untuk mengatur posisinya. Scroll untuk zoom."
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
            canvas.height * zoom
        );
        if (!crop) {
            return;
        }

        context.fillStyle = "rgba(15, 23, 42, 0.58)";
        context.fillRect(0, 0, canvas.width, crop.y);
        context.fillRect(0, crop.y, crop.x, crop.height);
        context.fillRect(crop.x + crop.width, crop.y, canvas.width - crop.x - crop.width, crop.height);
        context.fillRect(0, crop.y + crop.height, canvas.width, canvas.height - crop.y - crop.height);
        context.strokeStyle = "#ffffff";
        context.lineWidth = Math.max(1, canvas.width / 800);
        context.strokeRect(crop.x, crop.y, crop.width, crop.height);
    }

    function canvasPoint(event) {
        const bounds = canvas.getBoundingClientRect();
        return {
            x: Math.max(0, Math.min(canvas.width, (event.clientX - bounds.left) * canvas.width / bounds.width)),
            y: Math.max(0, Math.min(canvas.height, (event.clientY - bounds.top) * canvas.height / bounds.height)),
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
                true
            );
            return;
        }
        updatePreview(file);
        setStatus(
            dashboardStatus,
            file.size > MAX_IMAGE_SIZE
                ? "Foto lebih dari 10 MB. Edit, crop, dan resize sebelum menyimpan."
                : ""
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
            const previewScale = Math.min(1, 1200 / Math.max(sourceBitmap.width, sourceBitmap.height));
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
            setStatus(editorStatus, "Pilih area crop, lalu pilih Geser foto untuk mengatur posisi. Scroll atau gunakan slider untuk zoom.");
            dialog.showModal();
        } catch (error) {
            console.error("Foto tidak dapat dibuka untuk diedit.", error);
            closeEditor();
            setStatus(dashboardStatus, "Foto tidak dapat dibuka untuk diedit. Coba pilih file gambar lain.", true);
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
            heightInput.value = String(Math.max(1, Math.round(Number(widthInput.value) * dimensions.height / dimensions.width)));
        }
    });
    heightInput.addEventListener("input", () => {
        if (keepAspect.checked && Number(heightInput.value) > 0) {
            const dimensions = cropSourceDimensions();
            widthInput.value = String(Math.max(1, Math.round(Number(heightInput.value) * dimensions.width / dimensions.height)));
        }
    });
    keepAspect.addEventListener("change", () => {
        if (keepAspect.checked) {
            const dimensions = cropSourceDimensions();
            const width = Number(widthInput.value) || dimensions.width;
            setOutputSize(width, width * dimensions.height / dimensions.width);
        }
    });

    document.getElementById("applyPhotoEditButton").addEventListener("click", async () => {
        if (!sourceBitmap || !crop || crop.width < 1 || crop.height < 1) {
            setStatus(editorStatus, "Pilih area crop yang valid.", true);
            return;
        }
        const outputWidth = Number(widthInput.value);
        const outputHeight = Number(heightInput.value);
        if (!Number.isInteger(outputWidth) || !Number.isInteger(outputHeight)
            || outputWidth < 1 || outputHeight < 1
            || outputWidth > MAX_EDITED_IMAGE_DIMENSION || outputHeight > MAX_EDITED_IMAGE_DIMENSION
            || outputWidth * outputHeight > MAX_EDITED_IMAGE_DIMENSION * MAX_EDITED_IMAGE_DIMENSION) {
            setStatus(editorStatus, `Ukuran hasil harus 1-${MAX_EDITED_IMAGE_DIMENSION} px pada tiap sisi.`, true);
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
                outputHeight
            );
            const blob = await new Promise((resolve) => outputCanvas.toBlob(resolve, "image/webp", 0.9));
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
            setStatus(dashboardStatus, "Foto sudah diedit. Simpan anggota untuk menerapkan perubahan.");
            dialog.close();
        } catch (error) {
            console.error("Foto gagal diproses.", error);
            setStatus(editorStatus, error.message || "Foto gagal diproses.", true);
        } finally {
            button.disabled = false;
        }
    });

    document.getElementById("closePhotoEditorButton").addEventListener("click", () => dialog.close());
    dialog.addEventListener("close", closeEditor);
}

async function saveEntity(form, table, fields, folder, fileField) {
    const formData = new FormData(form);
    const id = formData.get("id") || null;
    const payload = {};
    fields.forEach((field) => {
        const input = form.elements.namedItem(field);
        if (input.type === "checkbox") {
            payload[field] = input.checked;
        } else if (input.type === "number") {
            payload[field] = Number(input.value || 0);
        } else if (input.type === "date" && !input.value) {
            payload[field] = null;
        } else {
            payload[field] = input.value.trim();
        }
    });

    let uploadedPath = null;
    let oldPath = fileField ? formData.get("photo_path") : null;
    if (fileField) {
        const file = form.elements.namedItem(fileField).files[0];
        if (file) {
            uploadedPath = await uploadImage(file, folder);
            payload[fileField === "photo" ? "photo_path" : "cover_path"] = uploadedPath;
        } else if (fileField === "photo") {
            payload.photo_path = oldPath || null;
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
        throw result.error;
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

async function uploadGalleryPhotos(form) {
    const files = Array.from(form.elements.namedItem("photos").files);
    if (!files.length) {
        throw new Error("Pilih minimal satu foto.");
    }
    if (files.length > 10) {
        throw new Error("Unggah maksimal 10 foto dalam satu kali proses.");
    }
    const invalidFile = files.find((file) => !ALLOWED_IMAGE_TYPES.has(file.type) || file.size > MAX_IMAGE_SIZE);
    if (invalidFile) {
        throw new Error(`"${invalidFile.name}" bukan JPEG/PNG/WebP valid atau ukurannya melebihi 10 MB.`);
    }

    const activityId = form.elements.namedItem("activity_id").value || null;
    const altText = form.elements.namedItem("alt_text").value.trim();
    const caption = form.elements.namedItem("caption").value.trim();
    const published = form.elements.namedItem("published").checked;
    const uploadedPaths = [];

    try {
        for (const file of files) {
            uploadedPaths.push(await uploadImage(file, "gallery"));
        }

        const result = await client.from("gallery_photos").insert(files.map((file, index) => ({
            activity_id: activityId,
            storage_path: uploadedPaths[index],
            image_url: null,
            alt_text: altText,
            caption: files.length === 1 ? caption : `${caption} (${file.name})`,
            published,
        })));
        if (result.error) {
            throw result.error;
        }
    } catch (error) {
        if (uploadedPaths.length) {
            try {
                const cleanup = await client.storage.from(MEDIA_BUCKET).remove(uploadedPaths);
                if (cleanup.error) {
                    throw cleanup.error;
                }
            } catch (cleanupError) {
                console.error("Sebagian foto gagal dibersihkan setelah batch unggah gagal.", cleanupError);
                throw new Error("Batch foto gagal dan sebagian file perlu dibersihkan dari Supabase Storage.");
            }
        }
        throw error;
    }

    form.reset();
    await refreshAfterMutation(`Data tersimpan. ${files.length} foto berhasil diunggah.`);
}

async function deletePhoto(photo) {
    await deleteRecord(
        "gallery_photos",
        photo.id,
        "Foto galeri",
        photo.storage_path,
        photo.caption || photo.alt_text || "Foto galeri"
    );
}

async function deleteRecord(table, id, label, storagePath = null, recordName = "") {
    const dialog = document.getElementById("deleteConfirmDialog");
    document.getElementById("deleteConfirmName").textContent = recordName || label;
    document.getElementById("deleteConfirmMessage").textContent = `${label} ini akan dihapus secara permanen.`;
    document.getElementById("deleteConfirmWarning").textContent = storagePath
        ? "Tindakan ini tidak dapat dibatalkan. File foto terkait juga akan dihapus dari penyimpanan."
        : "Tindakan ini tidak dapat dibatalkan dan data tidak dapat dipulihkan.";
    dialog.returnValue = "";
    const confirmed = await new Promise((resolve) => {
        dialog.addEventListener("close", () => resolve(dialog.returnValue === "confirm"), { once: true });
        dialog.showModal();
    });
    if (!confirmed) {
        return;
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
            console.error(`${label} dihapus, tetapi file terkait belum terhapus dari Storage.`, error);
            storageCleanupFailed = true;
        }
    }
    await refreshAfterMutation(storageCleanupFailed
        ? `${label} dihapus, tetapi file terkait perlu dibersihkan dari Supabase Storage.`
        : `${label} berhasil dihapus.`);
    if (storageCleanupFailed) {
        setStatus(dashboardStatus, `${label} dihapus, tetapi file terkait perlu dibersihkan dari Supabase Storage.`, true);
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
        setStatus(dashboardStatus, selectedFile ? "Mengunggah foto dan menyimpan data..." : "Menyimpan data...");
        setFormBusy(form, true);
        try {
            await saveEntity(form, table, fields, folder, fileField);
        } catch (error) {
            console.error(`Penyimpanan ${table} gagal.`, error);
            const detail = typeof error?.message === "string" ? ` ${error.message}` : "";
            setStatus(
                dashboardStatus,
                `Perubahan gagal disimpan.${detail || " Periksa isian dan izin Supabase."}`,
                true
            );
        } finally {
            setFormBusy(form, false);
        }
    });
}

function connectGalleryForm() {
    const form = document.getElementById("galleryForm");
    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        setStatus(dashboardStatus, "");
        setFormBusy(form, true);
        try {
            await uploadGalleryPhotos(form);
        } catch (error) {
            console.error("Unggah galeri gagal.", error);
            setStatus(dashboardStatus, error.message || "Foto gagal diunggah.", true);
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
            const result = await client.auth.signInWithPassword({
                email: form.elements.namedItem("email").value.trim(),
                password: form.elements.namedItem("password").value,
            });
            if (result.error) {
                throw result.error;
            }
            await showDashboard();
        } catch (error) {
            console.error("Login admin gagal.", error);
            setStatus(status, "Login gagal. Periksa email, kata sandi, dan status undangan admin.", true);
        } finally {
            setFormBusy(form, false);
        }
    });
}

function connectDashboard() {
    dashboardStatus = document.getElementById("dashboardStatus");
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
        if (password.length < 10) {
            setStatus(dashboardStatus, "Kata sandi minimal 10 karakter.", true);
            return;
        }

        setFormBusy(form, true);
        const result = await client.auth.updateUser({ password });
        setFormBusy(form, false);
        if (result.error) {
            console.error("Pembaruan kata sandi admin gagal.", result.error);
            setStatus(dashboardStatus, "Kata sandi belum dapat diperbarui. Silakan coba lagi.", true);
            return;
        }
        form.reset();
        setStatus(dashboardStatus, "Kata sandi berhasil diperbarui.");
    });
    document.getElementById("siteMode").addEventListener("change", (event) => {
        updateSiteModeDescription(event.currentTarget.value);
    });
    document.getElementById("siteModeForm").addEventListener("submit", async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const mode = form.elements.namedItem("setting_value").value;
        if (mode !== "public" && mode !== "maintenance") {
            setStatus(dashboardStatus, "Pilih mode website yang valid.", true);
            return;
        }

        setFormBusy(form, true);
        try {
            const result = await client.from("site_settings")
                .update({ setting_value: mode, updated_at: new Date().toISOString() })
                .eq("setting_key", "website_mode")
                .select("setting_value")
                .single();
            if (result.error) {
                throw result.error;
            }

            updateSiteModeDescription(result.data.setting_value);
            setStatus(
                dashboardStatus,
                result.data.setting_value === "maintenance"
                    ? "Mode maintenance aktif. Dashboard admin tetap dapat diakses."
                    : "Mode public aktif. Website dapat diakses pengunjung."
            );
        } catch (error) {
            console.error("Perubahan mode website gagal.", error);
            setStatus(dashboardStatus, "Mode website gagal diubah. Periksa koneksi dan izin admin.", true);
        } finally {
            setFormBusy(form, false);
        }
    });

    connectForm("memberForm", "members", [
        "name", "position", "division", "duties", "period", "sort_order", "is_featured", "published",
    ], "members", "photo");
    connectMemberPhotoEditor();
    connectForm("programForm", "programs", [
        "title", "description", "period", "sort_order", "published",
    ]);
    connectForm("activityForm", "activities", [
        "title", "description", "category", "event_date", "sort_order", "published",
    ]);
    connectGalleryForm();
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
            await showDashboard();
        }
        client.auth.onAuthStateChange((event) => {
            if (event === "SIGNED_OUT") {
                showLogin();
            }
        });
    } catch (error) {
        console.error("Dashboard belum dapat terhubung.", error);
        setStatus(loginStatus, "Konfigurasi Supabase belum tersedia. Dashboard belum dapat digunakan.", true);
        document.querySelectorAll("#loginForm input, #loginForm button").forEach((input) => {
            input.disabled = true;
        });
    }
}

startAdmin();
