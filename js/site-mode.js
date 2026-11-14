(() => {
    const root = document.documentElement;
    const style = document.createElement("style");
    style.textContent = `
        html[data-site-mode-loading] body { visibility: hidden; }
        html[data-site-mode="maintenance"] body {
            display: grid;
            min-height: 100vh;
            margin: 0;
            padding: 1.5rem;
            place-items: center;
            background: #0f172a;
            color: #f8fafc;
            font-family: Inter, Arial, sans-serif;
        }
        .maintenance-notice { max-width: 42rem; text-align: center; }
        .maintenance-notice .eyebrow {
            color: #fbbf24;
            font-family: monospace;
            letter-spacing: 0.12em;
            text-transform: uppercase;
        }
        .maintenance-notice h1 {
            margin: 1rem 0;
            color: #f8fafc;
            font-size: clamp(2rem, 6vw, 3.5rem);
        }
        .maintenance-notice p { color: #e2e8f0; line-height: 1.7; }
    `;
    document.head.append(style);
    root.dataset.siteModeLoading = "";

    async function applySiteMode() {
        const response = await fetch("/api/site-mode", { cache: "no-store" });
        if (!response.ok) {
            throw new Error(`Mode situs gagal diperiksa (HTTP ${response.status}).`);
        }

        const result = await response.json();
        if (result.mode !== "maintenance" && result.mode !== "public") {
            throw new Error("Mode situs yang diterima tidak valid.");
        }
        if (result.mode !== "maintenance") {
            return;
        }

        if (!document.body) {
            await new Promise((resolve) => {
                document.addEventListener("DOMContentLoaded", resolve, { once: true });
            });
        }

        root.dataset.siteMode = "maintenance";
        const notice = document.createElement("main");
        notice.className = "maintenance-notice";
        const eyebrow = document.createElement("p");
        eyebrow.className = "eyebrow";
        eyebrow.textContent = "HMPS Sistem Informasi";
        const heading = document.createElement("h1");
        heading.textContent = "Website sedang dalam pemeliharaan";
        const message = document.createElement("p");
        message.textContent = "Kami sedang melakukan pembaruan. Silakan kembali beberapa saat lagi.";
        notice.append(eyebrow, heading, message);
        document.body.replaceChildren(notice);
    }

    applySiteMode()
        .catch((error) => {
            console.error("Mode situs tidak dapat diperiksa; halaman publik tetap ditampilkan.", error);
        })
        .finally(() => {
            delete root.dataset.siteModeLoading;
        });
})();
