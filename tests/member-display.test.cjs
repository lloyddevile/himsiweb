const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const root = path.join(__dirname, "..");
const publicScript = fs.readFileSync(path.join(root, "js", "all-komponen.js"), "utf8");

test("homepage shows featured program leadership above executive roles", () => {
    const functionSource = publicScript.match(/function getHomepageLeaders\(members\) \{[\s\S]*?\n\}/);
    assert.ok(functionSource, "homepage leadership filter should exist");
    const getHomepageLeaders = vm.runInNewContext(`(${functionSource[0]})`);
    const members = [
        { position: "Ketua Umum", is_featured: true },
        { position: "Sekretaris Umum", is_featured: true },
        { position: "Bendahara UMUM", is_featured: true },
        { position: "Kepala Program Studi", is_featured: true },
        { position: "Sekretaris Program Studi", is_featured: true },
        { position: "Kepala Program Studi", is_featured: false },
        { position: "Kepala Divisi", is_featured: true },
        { position: "Ketua Umum", is_featured: false },
    ];

    assert.deepEqual(
        Array.from(getHomepageLeaders(members), (member) => member.position),
        [
            "Kepala Program Studi",
            "Sekretaris Program Studi",
            "Ketua Umum",
            "Sekretaris Umum",
            "Bendahara UMUM",
        ]
    );
    assert.match(
        fs.readFileSync(path.join(root, "page", "beranda.html"), "utf8"),
        /Kepala Program Studi,\s*Sekretaris Program Studi/
    );
    assert.match(publicScript, /renderDirectory\(directory, members, client\)/);
});

test("member directory displays Pengurus Inti before Program Studi and Pengurus Harian", () => {
    assert.match(publicScript, /title: "Pengurus Inti"/);
    assert.match(publicScript, /title: "Program Studi"/);
    assert.match(publicScript, /title: "Pengurus Harian"/);
    assert.match(publicScript, /getDirectorySections\(members\)/);
    assert.match(publicScript, /node\("h3", "", division\.division\)/);
});
