const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const root = path.join(__dirname, "..");
const publicScript = fs.readFileSync(path.join(root, "js", "all-komponen.js"), "utf8");

test("homepage shows only featured executive roles while directory keeps every published member", () => {
    const functionSource = publicScript.match(/function getHomepageLeaders\(members\) \{[\s\S]*?\n\}/);
    assert.ok(functionSource, "homepage leadership filter should exist");
    const getHomepageLeaders = vm.runInNewContext(`(${functionSource[0]})`);
    const members = [
        { position: "Ketua Umum", is_featured: true },
        { position: "Sekretaris Umum", is_featured: true },
        { position: "Bendahara UMUM", is_featured: true },
        { position: "Kepala Divisi", is_featured: true },
        { position: "Ketua Umum", is_featured: false },
    ];

    assert.deepEqual(
        Array.from(getHomepageLeaders(members), (member) => member.position),
        ["Ketua Umum", "Sekretaris Umum", "Bendahara UMUM"]
    );
    assert.match(publicScript, /renderDirectory\(directory, members, client\)/);
});
