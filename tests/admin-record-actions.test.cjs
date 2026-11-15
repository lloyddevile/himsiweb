const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const root = path.join(__dirname, "..");
const adminScript = fs.readFileSync(path.join(root, "js", "admin.js"), "utf8");
const adminHtml = fs.readFileSync(path.join(root, "page", "admin.html"), "utf8");

test("all admin data lists expose archive, restore, and permanent delete actions", () => {
    for (const [table, actionLabel] of [
        ["members", "anggota"],
        ["programs", "program"],
        ["activities", "kegiatan"],
        ["gallery_photos", "foto"],
        ["contact_messages", "pesan"],
    ]) {
        assert.match(adminScript, new RegExp(`archiveRecord\\("${table}"`));
        if (table === "gallery_photos") {
            assert.match(adminScript, /deleteRecord\(\s*"gallery_photos"/);
        } else {
            assert.match(adminScript, new RegExp(`deleteRecord\\("${table}"`));
        }
        assert.match(adminScript, new RegExp(`createAction\\("Hapus ${actionLabel}`));
    }

    assert.match(adminScript, /async function deleteRecord\(table, id, label, storagePath = null, recordName = ""\)/);
    assert.doesNotMatch(adminScript, /window\.confirm/);
    assert.match(adminScript, /\.delete\(\)\.eq\("id", id\)\.select\("id"\)\.single\(\)/);
    assert.match(adminScript, /dialog\.showModal\(\)/);
    assert.match(adminHtml, /value="cancel"[^>]*>Batalkan<\/button>/);
    assert.match(adminHtml, /value="confirm"[^>]*>Hapus permanen<\/button>/);
    assert.match(adminScript, /archiveRecord\("activity_media"/);
    assert.match(adminScript, /deleteRecord\(\s*"activity_media"/);
    assert.match(adminScript, /createSignedUrls\(mediaItems\.map/);
});

test("contact messages permit permanent deletion by admins only", () => {
    const migration = fs.readFileSync(
        path.join(root, "supabase", "migrations", "20261114040000_admin_delete_contact_messages.sql"),
        "utf8"
    );

    assert.match(migration, /grant delete on table public\.contact_messages to authenticated/i);
    assert.match(migration, /for delete to authenticated\s+using \(public\.is_admin\(\)\)/i);
});

test("maintenance mode form supports a bounded public-facing maintenance note", () => {
    assert.match(adminHtml, /id="maintenanceNote" name="maintenance_note" rows="3" maxlength="500"/);
    assert.match(adminScript, /\.select\("setting_value, maintenance_note"\)/);
    assert.match(adminScript, /maintenance_note: maintenanceNote/);
    assert.match(adminScript, /maintenanceNoteField\.hidden = mode !== "maintenance"/);
});

test("member photo editor supports crop selection, dragging, and wheel zoom", () => {
    assert.match(adminHtml, /id="selectPhotoCropMode"/);
    assert.match(adminHtml, /id="movePhotoMode"/);
    assert.match(adminScript, /if \(activeDragMode === "move"\)/);
    assert.match(adminScript, /canvas\.addEventListener\("wheel"/);
    assert.match(adminScript, /sourceX = \(crop\.x - transform\.offsetX\) \/ transform\.scaleX/);
});
