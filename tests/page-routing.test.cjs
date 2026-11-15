const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const root = path.join(__dirname, "..");

test("Vercel routes the homepage to /page and keeps page-specific files organized", () => {
    const vercelConfig = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));
    const redirects = new Map(vercelConfig.redirects.map((redirect) => [redirect.source, redirect.destination]));
    const rewrites = new Map(vercelConfig.rewrites.map((rewrite) => [rewrite.source, rewrite.destination]));

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
                `${stylesheet} should exist`
            );
        }

        const scripts = [...html.matchAll(/<script src="(\/js\/[^"]+\.js)"><\/script>/g)];
        assert.ok(scripts.length > 0, `${page} should load JavaScript from js/`);
        for (const [, script] of scripts) {
            assert.equal(
                fs.existsSync(path.join(root, script.slice(1).split("/").join(path.sep))),
                true,
                `${script} should exist`
            );
        }
    }

    for (const page of ["beranda.html", "pedoman.html", "pengurus.html"]) {
        const html = fs.readFileSync(path.join(root, "page", page), "utf8");
        assert.match(html, /<script src="\/js\/site-mode\.js"><\/script>/, `${page} should respect maintenance mode`);
    }

    const adminPage = fs.readFileSync(path.join(root, "page", "admin.html"), "utf8");
    assert.doesNotMatch(adminPage, /<script src="\/js\/site-mode\.js"><\/script>/);

    const homepage = fs.readFileSync(path.join(root, "page", "beranda.html"), "utf8");
    assert.match(homepage, /id="upcomingAgenda"/);
    assert.match(homepage, /id="activityMediaFolders"/);
});
