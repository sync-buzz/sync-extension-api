// What `filesOf` must name, and what packing must therefore carry.
//
// The reason this file exists: `styles` was added to the manifest, to the
// schema and to Sync, and to none of the three walks in this package. The
// release that followed shipped two packages that download, hash correctly and
// will not open — the archive was missing the one file it declared.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { filesOf } from "../src/contract.mjs";
import { pack } from "../src/pack.mjs";

const FULL = {
  manifestVersion: 1,
  id: "probe",
  version: "1.0.0",
  name: "Probe",
  engines: { syncApi: "^2.0" },
  ui: "ui/index.js",
  styles: "ui/index.css",
  types: ["types/one.json", "types/two.json"],
  prompt: "prompt/instructions.md",
};

test("every path a manifest names is named, in Sync's order", () => {
  assert.deepEqual(filesOf(FULL), [
    "ui/index.js",
    "ui/index.css",
    "types/one.json",
    "types/two.json",
    "prompt/instructions.md",
  ]);
});

test("a manifest naming nothing names nothing", () => {
  assert.deepEqual(filesOf({ manifestVersion: 1, id: "bare", version: "1.0.0" }), []);
});

test("a stylesheet is optional, and named when it is there", () => {
  const { styles, ...without } = FULL;
  assert.ok(!filesOf(without).includes("ui/index.css"));
  assert.ok(filesOf(FULL).includes("ui/index.css"));
});

test("packing carries every file the manifest declares", () => {
  const folder = mkdtempSync(join(tmpdir(), "probe-"));
  writeFileSync(join(folder, "manifest.json"), JSON.stringify(FULL));
  for (const path of filesOf(FULL)) {
    mkdirSync(join(folder, path, ".."), { recursive: true });
    writeFileSync(join(folder, path), `/* ${path} */`);
  }

  const out = mkdtempSync(join(tmpdir(), "packed-"));
  const { archive } = pack(folder, out);
  const inside = execFileSync("unzip", ["-Z1", archive], { encoding: "utf8" })
    .split("\n")
    .filter(Boolean);

  for (const path of [...filesOf(FULL), "manifest.json", "META/hashes.json"]) {
    assert.ok(inside.includes(path), `${path} was declared and not packed`);
  }
  // And nothing else: an archive is what was declared.
  assert.equal(inside.length, filesOf(FULL).length + 2);
});
