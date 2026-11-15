const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const root = path.join(__dirname, "..");

function createNode(tagName) {
    return {
        tagName: tagName.toUpperCase(),
        className: "",
        textContent: "",
        children: [],
        append(...children) {
            this.children.push(...children);
        },
    };
}

function contrastRatio(first, second) {
    function luminance(color) {
        const channels = color.match(/[a-f\d]{2}/gi).map((channel) => parseInt(channel, 16) / 255);
        const linear = channels.map((channel) => channel <= 0.04045
            ? channel / 12.92
            : ((channel + 0.055) / 1.055) ** 2.4);
        return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
    }

    const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
    return (values[0] + 0.05) / (values[1] + 0.05);
}

test("maintenance notice has readable contrast and no admin dashboard link", async () => {
    const script = fs.readFileSync(path.join(root, "js", "site-mode.js"), "utf8");
    const body = createNode("body");
    body.replaceChildren = function (...children) {
        this.children = children;
    };
    const styles = [];
    const document = {
        documentElement: { dataset: {} },
        body,
        head: { append: (style) => styles.push(style) },
        createElement: createNode,
        addEventListener() {},
    };

    vm.runInNewContext(script, {
        document,
        fetch: async () => ({ ok: true, json: async () => ({ mode: "maintenance", maintenanceNote: "Pemeliharaan terjadwal hari ini." }) }),
        console: { error() {} },
    });
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(body.children.length, 1);
    assert.deepEqual(body.children[0].children.map((child) => child.tagName), ["P", "H1", "P"]);
    assert.equal(body.children[0].children[2].textContent, "Pemeliharaan terjadwal hari ini.");
    assert.doesNotMatch(script, /\/page\/admin\.html|Masuk admin/);

    const css = styles[0].textContent;
    const background = css.match(/background:\s*(#[a-f\d]{6})/i)[1];
    const textColors = [
        css.match(/color:\s*(#[a-f\d]{6})/i)[1],
        css.match(/maintenance-notice p\s*\{\s*color:\s*(#[a-f\d]{6})/i)[1],
        css.match(/maintenance-notice \.eyebrow\s*\{\s*color:\s*(#[a-f\d]{6})/i)[1],
        css.match(/maintenance-notice h1\s*\{[^}]*color:\s*(#[a-f\d]{6})/i)[1],
    ];
    for (const color of textColors) {
        assert.ok(contrastRatio(color, background) >= 4.5, `${color} should meet WCAG AA contrast`);
    }
});

test("maintenance notice uses a default message when no custom note is saved", async () => {
    const script = fs.readFileSync(path.join(root, "js", "site-mode.js"), "utf8");
    const body = createNode("body");
    body.replaceChildren = function (...children) {
        this.children = children;
    };
    const document = {
        documentElement: { dataset: {} },
        body,
        head: { append() {} },
        createElement: createNode,
        addEventListener() {},
    };

    vm.runInNewContext(script, {
        document,
        fetch: async () => ({ ok: true, json: async () => ({ mode: "maintenance", maintenanceNote: "" }) }),
        console: { error() {} },
    });
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(body.children[0].children[2].textContent, "Kami sedang melakukan pembaruan. Silakan kembali beberapa saat lagi.");
});
