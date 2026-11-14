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

function setStatus(container, message) {
    if (!container) {
        return;
    }

    container.replaceChildren(node("p", "content-status", message));
}

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
            const signedUrl = client.storage.from("hmpssi-media").createSignedUrl(path, 3600)
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
    image.addEventListener("error", () => {
        if (image.src.endsWith(fallback)) {
            return;
        }
        image.src = fallback;
    }, { once: true });

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
        photo.append(await createImage(
            client,
            member.photo_path,
            null,
            `Foto ${member.name}`,
            "",
            PROFILE_PLACEHOLDER
        ));

        card.append(
            photo,
            node("h3", "member-name", member.name),
            node("p", "member-position", member.position)
        );
        container.append(card);
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

    const groups = new Map();
    members.forEach((member) => {
        const division = member.division || "Pengurus Harian";
        if (!groups.has(division)) {
            groups.set(division, []);
        }
        groups.get(division).push(member);
    });

    for (const [division, divisionMembers] of groups) {
        const section = node("section", "directory-division");
        section.append(node("h2", "", division));
        const grid = node("div", "division-members");

        for (const member of divisionMembers) {
            const card = node("article", "directory-member");
            const photo = node("div", "directory-photo");
            photo.append(await createImage(
                client,
                member.photo_path,
                null,
                `Foto ${member.name}`,
                "",
                PROFILE_PLACEHOLDER
            ));

            const details = node("div", "directory-details");
            details.append(
                node("h3", "", member.name),
                node("p", "directory-position", member.position)
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

        section.append(grid);
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
        const card = node("article", "activity-card");
        const imageArea = node("div", "activity-image");
        imageArea.append(await createImage(
            client,
            photo?.storage_path,
            photo?.image_url,
            photo?.alt_text || `Ilustrasi ${activity.title}`,
            "",
            EVENT_PLACEHOLDER
        ));
        imageArea.append(node("span", "activity-date", formatDate(activity.event_date)));

        const content = node("div", "activity-content");
        content.append(
            node("div", "activity-category", activity.category),
            node("h3", "activity-title", activity.title),
            node("p", "activity-description", activity.description || "Informasi kegiatan.")
        );
        card.append(imageArea, content);
        container.append(card);
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
            node("p", "", program.description || "Informasi program kerja.")
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
    const categories = [...new Set(photos.map((photo) => activityById.get(photo.activity_id)?.category || "Lainnya"))];
    const filterValues = ["Semua", ...categories];

    const renderForCategory = async (category) => {
        container.replaceChildren();
        const visiblePhotos = category === "Semua"
            ? photos
            : photos.filter((photo) => (activityById.get(photo.activity_id)?.category || "Lainnya") === category);

        for (const photo of visiblePhotos) {
            const activity = activityById.get(photo.activity_id);
            const item = node("article", "gallery-item");
            item.append(await createImage(
                client,
                photo.storage_path,
                photo.image_url,
                photo.alt_text,
                "",
                EVENT_PLACEHOLDER
            ));

            const overlay = node("div", "gallery-overlay");
            const info = node("div", "gallery-info");
            info.append(
                node("h3", "", photo.caption || activity?.title || "Dokumentasi kegiatan"),
                node("p", "", activity?.title || "HMPS Sistem Informasi")
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
                EVENT_PLACEHOLDER
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
        menuButton.setAttribute("aria-expanded", "false");
        menuButton.setAttribute("aria-label", "Buka menu navigasi");
    };

    menuButton.addEventListener("click", () => {
        const isOpen = menuButton.getAttribute("aria-expanded") === "true";
        navMenu.classList.toggle("active", !isOpen);
        menuButton.setAttribute("aria-expanded", String(!isOpen));
        menuButton.setAttribute("aria-label", isOpen ? "Buka menu navigasi" : "Tutup menu navigasi");
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
            fields.map((field) => [field, form.elements.namedItem(field).value.trim()])
        );
        payload.consent = form.elements.namedItem("consent").checked;

        try {
            const response = await fetch("/api/contact", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
            const result = await response.json();

            if (!response.ok) {
                const messages = {
                    rate_limited: "Terlalu banyak pesan dikirim. Silakan coba lagi nanti.",
                    service_unavailable: "Layanan kontak belum siap. Silakan coba lagi nanti.",
                };
                throw new Error(messages[result.error] || "Pesan belum tersimpan. Periksa koneksi lalu coba lagi.");
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
    const leadershipPositions = new Set([
        "ketua umum",
        "sekretaris umum",
        "bendahara umum",
    ]);

    return members.filter((member) => {
        const position = String(member.position || "").replace(/\s+/g, " ").trim().toLowerCase();
        return member.is_featured && leadershipPositions.has(position);
    });
}

async function loadPublicContent() {
    const activityGrid = document.getElementById("activitiesGrid");
    const programGrid = document.getElementById("programsGrid");
    const featuredMembers = document.getElementById("featuredMembers");
    const galleryGrid = document.getElementById("galleryGrid");
    const galleryFilters = document.getElementById("galleryFilters");
    const galleryMarquee = document.getElementById("galleryMarquee");
    const directory = document.getElementById("directoryGrid");

    [activityGrid, programGrid, featuredMembers, galleryGrid, galleryMarquee, directory].forEach((container) => {
        if (container) {
            setStatus(container, "Memuat konten...");
        }
    });
    if (galleryFilters) {
        galleryFilters.replaceChildren();
    }

    try {
        const client = await window.hmpssiSupabaseReady;
        const [membersResult, programsResult, activitiesResult, photosResult] = await Promise.all([
            client.from("members").select("id,name,position,division,duties,period,photo_path,sort_order,is_featured")
                .eq("published", true).is("archived_at", null).order("sort_order").limit(200),
            client.from("programs").select("id,title,description,period,sort_order")
                .eq("published", true).is("archived_at", null).order("sort_order").limit(100),
            client.from("activities").select("id,title,description,category,event_date,sort_order")
                .eq("published", true).is("archived_at", null).order("event_date", { ascending: false }).limit(100),
            client.from("gallery_photos").select("id,activity_id,storage_path,image_url,alt_text,caption,sort_order")
                .eq("published", true).is("archived_at", null).order("sort_order").limit(300),
        ]);

        const results = [membersResult, programsResult, activitiesResult, photosResult];
        const failed = results.find((result) => result.error);
        if (failed) {
            throw failed.error;
        }

        const members = membersResult.data || [];
        const programs = programsResult.data || [];
        const activities = activitiesResult.data || [];
        const photos = photosResult.data || [];

        await renderMembers(featuredMembers, getHomepageLeaders(members), client);
        await renderDirectory(directory, members, client);
        await renderActivities(activityGrid, activities, photos, client);
        renderPrograms(programGrid, programs);
        await renderGallery(galleryGrid, galleryFilters, photos, activities, client);
        await renderGalleryMarquee(galleryMarquee, photos, client);
    } catch (error) {
        console.error("Konten publik gagal dimuat.", error);
        [activityGrid, programGrid, featuredMembers, galleryGrid, galleryMarquee, directory].forEach((container) => {
            setStatus(container, "Konten belum dapat dimuat. Silakan coba lagi nanti.");
        });
    }
}

function setupScrollEffects() {
    const header = document.querySelector("header");
    if (header) {
        window.addEventListener("scroll", () => {
            header.classList.toggle("scrolled", window.scrollY > 100);
        }, { passive: true });
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
