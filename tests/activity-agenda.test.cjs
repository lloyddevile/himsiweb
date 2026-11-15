const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const root = path.join(__dirname, "..");
const publicScript = fs.readFileSync(path.join(root, "js", "all-komponen.js"), "utf8");

function extractFunction(source, name) {
    const match = source.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n\\}`));
    assert.ok(match, `${name} should be defined`);
    return vm.runInNewContext(`(${match[0]})`);
}

test("upcoming agenda excludes past and undated activities and sorts the nearest first", () => {
    const getUpcomingActivities = extractFunction(publicScript, "getUpcomingActivities");
    const activities = [
        { title: "Later", event_date: "2026-12-10" },
        { title: "Past", event_date: "2026-11-01" },
        { title: "Soon", event_date: "2026-11-20" },
        { title: "Undated", event_date: null },
        { title: "Also Soon", event_date: "2026-11-20" },
    ];

    assert.deepEqual(
        Array.from(getUpcomingActivities(activities, "2026-11-15"), (activity) => activity.title),
        ["Also Soon", "Soon", "Later"]
    );
    assert.equal(getUpcomingActivities(activities, "2026-11-15", 2).length, 2);
});

test("published activity media is grouped into folders by activity", () => {
    const groupActivityMedia = extractFunction(publicScript, "groupActivityMedia");
    const groups = groupActivityMedia([
        { activity_id: "event-a", file_name: "poster.pdf" },
        { activity_id: "event-b", file_name: "video.mp4" },
        { activity_id: "event-a", file_name: "photo.webp" },
    ]);

    assert.deepEqual(Array.from(groups.keys()), ["event-a", "event-b"]);
    assert.deepEqual(
        Array.from(groups.get("event-a"), (media) => media.file_name),
        ["poster.pdf", "photo.webp"]
    );
});

test("activity media is stored in activity/date folders and supports selected file formats", () => {
    const adminScript = fs.readFileSync(path.join(root, "js", "admin.js"), "utf8");
    const activityMediaPath = extractFunction(adminScript, "activityMediaPath");
    const migration = fs.readFileSync(
        path.join(root, "supabase", "migrations", "20261115010000_activity_media.sql"),
        "utf8"
    );
    const dashboard = fs.readFileSync(path.join(root, "page", "admin.html"), "utf8");

    assert.equal(
        activityMediaPath("event-id", "2026-11-20", "file-id", "pdf"),
        "activities/event-id/2026-11-20/file-id.pdf"
    );
    for (const contentType of [
        "image/jpeg",
        "application/pdf",
        "video/mp4",
        "video/webm",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ]) {
        assert.ok(migration.includes(contentType), `${contentType} should be allowed in Storage`);
    }
    assert.match(dashboard, /name="documented_on" type="date"/);
    assert.match(dashboard, /name="files" type="file"[^>]*multiple required/);
    assert.match(adminScript, /MAX_ACTIVITY_MEDIA_SIZE = 10 \* 1024 \* 1024/);
});
