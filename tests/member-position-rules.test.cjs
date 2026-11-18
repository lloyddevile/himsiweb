const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const root = path.join(__dirname, "..");
const adminScript = fs.readFileSync(path.join(root, "js", "admin.js"), "utf8");
const adminHtml = fs.readFileSync(path.join(root, "page", "admin.html"), "utf8");
const migration = fs.readFileSync(
    path.join(root, "supabase", "migrations", "20261115020000_member_position_rules.sql"),
    "utf8",
);
const organizationMigration = fs.readFileSync(
    path.join(root, "supabase", "migrations", "20261115030000_member_organization_groups.sql"),
    "utf8",
);

function extractDeclaration(source, pattern, label) {
    const match = source.match(pattern);
    assert.ok(match, `${label} should be defined`);
    return match[0];
}

function loadPositionConflictHelper() {
    const positions = extractDeclaration(
        adminScript,
        /const UNIQUE_MEMBER_POSITIONS = new Set\(\[[\s\S]*?\n\]\);/,
        "unique position list",
    );
    const normalize = extractDeclaration(
        adminScript,
        /function normalizeMemberValue\(value\) \{[\s\S]*?\n\}/,
        "member value normalizer",
    );
    const conflict = extractDeclaration(
        adminScript,
        /function getMemberPositionConflict\(members, candidate, editingId = null\) \{[\s\S]*?\n\}/,
        "member position validation",
    );
    return vm.runInNewContext(
        `(() => { ${positions}; ${normalize}; ${conflict}; return getMemberPositionConflict; })()`,
    );
}

test("the member form offers the requested job and division dropdowns", () => {
    assert.match(adminHtml, /<select id="memberPosition" name="position" required>/);
    assert.doesNotMatch(adminHtml, /<input name="position"/);
    for (const position of [
        "Ketua Umum",
        "Sekretaris Umum",
        "Bendahara Umum",
        "Kepala Divisi",
        "Kepala Program Studi",
        "Sekretaris Program Studi",
        "Anggota Divisi",
    ]) {
        assert.ok(adminHtml.includes(`value="${position}"`), `${position} should be selectable`);
    }

    for (const division of [
        "Internal",
        "Eksternal",
        "Kesekretariatan",
        "Pemberdayaan Perempuan",
        "Medinfo (Media dan Informasi)",
    ]) {
        assert.ok(adminHtml.includes(`value="${division}"`), `${division} should be selectable`);
    }
});

test("single-seat leadership roles reject duplicates but allow editing the same member", () => {
    const getConflict = loadPositionConflictHelper();
    const existing = [{ id: "leader-1", position: "  KETUA   UMUM ", division: "Pengurus Inti" }];
    const candidate = { position: "Ketua Umum", division: "Pengurus Inti" };

    assert.match(getConflict(existing, candidate), /Ketua Umum hanya boleh dimiliki satu anggota/);
    assert.equal(getConflict(existing, candidate, "leader-1"), null);
    assert.equal(getConflict([{ ...existing[0], archived_at: "2026-01-01" }], candidate), null);
});

test("each division can have one head while ordinary division members can be multiple", () => {
    const getConflict = loadPositionConflictHelper();
    const existing = [
        {
            id: "head-1",
            position: "Kepala Divisi Konten & Informasi",
            division: "Medinfo (Media dan Informasi)",
        },
    ];

    assert.match(
        getConflict(existing, {
            position: "Kepala Divisi",
            division: "Medinfo (Media dan Informasi)",
        }),
        /sudah memiliki Kepala Divisi/,
    );
    assert.equal(getConflict(existing, { position: "Kepala Divisi", division: "Internal" }), null);
    assert.equal(
        getConflict(existing, {
            position: "Anggota Divisi",
            division: "Medinfo (Media dan Informasi)",
        }),
        null,
    );
});

test("database migration enforces unique leadership and one division head per division", () => {
    assert.match(migration, /create unique index if not exists members_unique_core_role_idx/i);
    assert.match(migration, /members_unique_kadiv_per_division_idx/i);
    assert.match(migration, /where archived_at is null/i);
    assert.match(migration, /members_supported_division_role_check/i);
});

test("core leadership is assigned to Pengurus Inti and harian members remain grouped under Pengurus Harian", () => {
    const directoryFunction = adminScript.match(
        /function syncMemberDivisionField\(\) \{[\s\S]*?\n\}/,
    );
    assert.ok(directoryFunction);
    assert.match(directoryFunction[0], /"Pengurus Inti"/);
    assert.match(directoryFunction[0], /"Program Studi"/);
    assert.doesNotMatch(directoryFunction[0], /"Pengurus Harian"/);
    assert.match(organizationMigration, /set\s+division\s*=\s*'Pengurus Inti'/i);
    assert.match(organizationMigration, /set\s+division\s*=\s*'Program Studi'/i);
    assert.match(organizationMigration, /members_organization_group_check/i);

    const publicScript = fs.readFileSync(path.join(root, "js", "all-komponen.js"), "utf8");
    const sections = publicScript.match(/function getDirectorySections\(members\) \{[\s\S]*?\n\}/);
    assert.ok(sections, "directory organization groups should be defined");
    const getDirectorySections = vm.runInNewContext(`(${sections[0]})`);
    const directoryGroups = getDirectorySections([
        { position: "Anggota Divisi", division: "Internal" },
        { position: "Ketua Umum", division: "Pengurus Inti" },
        { position: "Kepala Program Studi", division: "Program Studi" },
        { position: "Kepala Divisi", division: "Internal" },
    ]);

    assert.deepEqual(
        Array.from(directoryGroups, (group) => group.title),
        ["Pengurus Inti", "Program Studi", "Pengurus Harian"],
    );
    assert.deepEqual(
        Array.from(directoryGroups[2].divisions[0].members, (member) => member.position),
        ["Kepala Divisi", "Anggota Divisi"],
    );
});
