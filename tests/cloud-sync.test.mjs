import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

async function createCloudSync(fetchImplementation) {
  const storage = new Map();
  const download = { clicked: false, href: "", name: "" };
  const recoveryButton = { hidden: true };
  const statusNode = { textContent: "" };
  const context = {
    Blob,
    URL: {
      createObjectURL: () => "blob:recovery",
      revokeObjectURL() {},
    },
    document: {
      querySelector(selector) {
        if (selector === "#recover-edits") return recoveryButton;
        if (selector === "#save-status") return statusNode;
        return null;
      },
      createElement() {
        return {
          set href(value) { download.href = value; },
          set download(value) { download.name = value; },
          click() { download.clicked = true; },
        };
      },
    },
    fetch: fetchImplementation,
    localStorage: {
      getItem(key) { return storage.get(key) || null; },
      setItem(key, value) { storage.set(key, value); },
      removeItem(key) { storage.delete(key); },
    },
    setInterval() {},
    setTimeout() {},
    window: {},
  };
  vm.runInNewContext(await readFile(new URL("../cloud-sync.js", import.meta.url), "utf8"), context);
  return { api: context.window.breadCloud, download, recoveryButton, statusNode, storage };
}

function jsonResponse(value) {
  return { ok: true, async json() { return value; } };
}

test("queues the latest workspace while an earlier save is in flight", async () => {
  let releaseFirstPut;
  const submitted = [];
  let revision = 4;
  const cloud = await createCloudSync(async (url, options = {}) => {
    if (options.method === "GET") {
      return jsonResponse({ state: { recipes: [], lots: [], orders: [] }, revision });
    }
    submitted.push(JSON.parse(options.body));
    if (submitted.length === 1) {
      await new Promise((resolve) => { releaseFirstPut = resolve; });
    }
    revision += 1;
    return jsonResponse({ revision });
  });

  let state = { recipes: [], lots: [], orders: [] };
  await cloud.api.start(() => state, (next) => { state = next; });
  const first = { recipes: [{ id: "recipe", name: "First character" }], lots: [], orders: [] };
  const latest = { recipes: [{ id: "recipe", name: "Latest text" }], lots: [], orders: [] };
  const firstSave = cloud.api.save(first);
  await new Promise((resolve) => setImmediate(resolve));
  const latestSave = cloud.api.save(latest);
  releaseFirstPut();
  await Promise.all([firstSave, latestSave]);

  assert.deepEqual(submitted.map((body) => body.state.recipes[0].name), ["First character", "Latest text"]);
  assert.deepEqual(submitted.map((body) => body.revision), [4, 5]);
  assert.equal(cloud.storage.has("bread-lab-unsynced-backup"), false);
  assert.equal(cloud.recoveryButton.hidden, true);
  assert.equal(cloud.statusNode.textContent, "Synced across devices");
});

test("exposes failed unsynced state through a recovery download", async () => {
  const cloud = await createCloudSync(async (url, options = {}) => {
    if (options.method === "GET") {
      return jsonResponse({ state: { recipes: [], lots: [], orders: [] }, revision: 1 });
    }
    return { ok: false, status: 503, async json() { return {}; } };
  });

  let state = { recipes: [], lots: [], orders: [] };
  await cloud.api.start(() => state, (next) => { state = next; });
  const unsynced = { recipes: [{ id: "local", name: "Needs recovery" }], lots: [], orders: [] };
  await cloud.api.save(unsynced);

  assert.equal(cloud.recoveryButton.hidden, false);
  assert.match(cloud.statusNode.textContent, /saved on this device/);
  cloud.api.recover();
  assert.equal(cloud.download.clicked, true);
  assert.equal(cloud.download.name, "bread-lab-recovered-edits.json");
  assert.match(cloud.statusNode.textContent, /downloaded/);
});

test("the built app exposes and wires the hidden recovery control", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
  const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");

  assert.match(html, /id="recover-edits"[^>]*hidden/);
  assert.match(app, /case "recover-edits":[\s\S]*window\.breadCloud\?\.recover\(\)/);
  assert.match(app, /hasDairyButter\(recipe\.ingredients\)\) detected\.set\("milk"/);
  assert.match(readme, /py -m http\.server 8000/);
  assert.match(readme, /separate browser storage/);
});
