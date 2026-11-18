const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const root = path.join(__dirname, "..");

test("Vercel routes the homepage to /page and keeps page-specific files organized", () => {
    const vercelConfig = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));
    const redirects = new Map(
        vercelConfig.redirects.map((redirect) => [redirect.source, redirect.destination]),
    );
    const rewrites = new Map(
        vercelConfig.rewrites.map((rewrite) => [rewrite.source, rewrite.destination]),
    );

    assert.equal(redirects.get("/"), "/page");
    assert.equal(redirects.get("/index.html"), "/page");
    assert.equal(rewrites.get("/page"), "/page/beranda.html");
    assert.equal(redirects.get("/admin.html"), "/page/admin.html");
    assert.equal(redirects.get("/pedoman.html"), "/page/pedoman.html");

    for (const page of ["beranda.html", "pedoman.html", "pengurus.html", "admin.html"]) {
        const pagePath = path.join(root, "page", page);
        assert.equal(fs.existsSync(pagePath), true, `${page} should be in page/`);

        const html = fs.readFileSync(pagePath, "utf8");
        const stylesheets = [...html.matchAll(/href="(\/style\/[^"]+\.css)"/g)];
        assert.ok(stylesheets.length > 0, `${page} should load its stylesheet from style/`);
        for (const [, stylesheet] of stylesheets) {
            assert.equal(
                fs.existsSync(path.join(root, stylesheet.slice(1).split("/").join(path.sep))),
                true,
                `${stylesheet} should exist`,
            );
        }

        const scripts = [...html.matchAll(/<script src="(\/js\/[^"]+\.js)"><\/script>/g)];
        assert.ok(scripts.length > 0, `${page} should load JavaScript from js/`);
        for (const [, script] of scripts) {
            assert.equal(
                fs.existsSync(path.join(root, script.slice(1).split("/").join(path.sep))),
                true,
                `${script} should exist`,
            );
        }
    }

    for (const page of ["beranda.html", "pedoman.html", "pengurus.html"]) {
        const html = fs.readFileSync(path.join(root, "page", page), "utf8");
        assert.match(
            html,
            /<script src="\/js\/site-mode\.js"><\/script>/,
            `${page} should respect maintenance mode`,
        );
    }

    const adminPage = fs.readFileSync(path.join(root, "page", "admin.html"), "utf8");
    assert.doesNotMatch(adminPage, /<script src="\/js\/site-mode\.js"><\/script>/);

    const homepage = fs.readFileSync(path.join(root, "page", "beranda.html"), "utf8");
    assert.match(homepage, /id="upcomingAgenda"/);
    assert.match(homepage, /id="activityMediaFolders"/);
    const navigation = homepage.match(/<nav aria-label="Navigasi utama">([\s\S]*?)<\/nav>/);
    assert.ok(navigation, "primary navigation should exist");
    assert.match(navigation[0], /<details class="nav-dropdown">/);
    assert.match(navigation[0], /<summary>HIMSI Information<\/summary>/);
    assert.match(navigation[0], /href="#activities">Kegiatan &amp; Agenda<\/a>/);
    assert.match(navigation[0], /href="#gallery">Galeri &amp; Dokumentasi<\/a>/);
    assert.match(navigation[0], /href="#faq">Informasi Umum<\/a>/);
    assert.doesNotMatch(navigation[0], /<li><a href="#activities">Kegiatan<\/a><\/li>/);

    const stylesheet = fs.readFileSync(path.join(root, "style", "style-hmps.css"), "utf8");
    assert.match(
        stylesheet,
        /#primaryNav > li > a,\s*\.nav-dropdown summary\s*\{[^}]*display: flex;[^}]*align-items: center;/,
    );
    assert.match(
        stylesheet,
        /@media \(max-width: 920px\) \{[\s\S]*?#primaryNav \{[\s\S]*?position: fixed;/,
    );
    assert.match(stylesheet, /@media \(max-width: 768px\) \{[\s\S]*?\.activities-grid/);
});

test("activity banners can be uploaded by admins and are preferred on public cards", () => {
    const adminPage = fs.readFileSync(path.join(root, "page", "admin.html"), "utf8");
    const adminScript = fs.readFileSync(path.join(root, "js", "admin.js"), "utf8");
    const publicScript = fs.readFileSync(path.join(root, "js", "all-komponen.js"), "utf8");

    assert.match(adminPage, /name="cover_path"/);
    assert.match(
        adminPage,
        /<input\b(?=[^>]*\bname="cover")(?=[^>]*\btype="file")(?=[^>]*\baccept="image\/jpeg,image\/png,image\/webp")[^>]*>/,
    );
    assert.match(
        adminScript,
        /connectForm\s*\(\s*"activityForm"[\s\S]*?"activities"\s*,\s*"cover"\s*,?\s*\)/,
    );
    assert.match(
        adminScript,
        /const filePathField = fileField === "photo" \? "photo_path" : "cover_path"/,
    );
    assert.match(publicScript, /activity\.cover_path \|\| photo\?\.storage_path/);
    assert.match(publicScript, /event_date,cover_path,sort_order/);
});
