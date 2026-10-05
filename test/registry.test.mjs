/**
 * What the index holds, held against the release that used to empty it.
 *
 * The failure these are written from: a repository whose marketplace listed MCP
 * servers as well as its own packages kept those entries in `registry.json`
 * alone, and this command rewrites that file from the manifests it is given. So
 * releasing any one package dropped the whole catalogue, silently, in a commit
 * whose message said it was indexing a release.
 *
 * The descriptors are therefore an input rather than something to preserve, and
 * the first test is the one that says so.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { registry, REGISTRY_FORMAT } from "../src/registry.mjs";

/** A repository with one extension, its archive, and a folder of descriptors. */
function repository({ servers = {}, manifest = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), "sync-registry-"));
  const extension = join(root, "extensions/one");
  mkdirSync(extension, { recursive: true });
  writeFileSync(
    join(extension, "manifest.json"),
    JSON.stringify({
      manifestVersion: 1,
      id: "one",
      version: "1.0.0",
      name: "One",
      summary: "An extension.",
      engines: { syncApi: "^3.26" },
      capabilities: [],
      ui: "ui/index.js",
      license: "MIT",
      ...manifest,
    }),
  );
  mkdirSync(join(extension, "ui"), { recursive: true });
  writeFileSync(join(extension, "ui/index.js"), "export default () => ({});\n");

  const archives = join(root, "dist");
  mkdirSync(archives, { recursive: true });
  writeFileSync(join(archives, "one-1.0.0.syncext"), "not really an archive");

  const folder = join(root, "servers");
  mkdirSync(folder, { recursive: true });
  for (const [name, body] of Object.entries(servers)) {
    writeFileSync(join(folder, name), JSON.stringify(body));
  }

  return {
    root,
    folders: [extension],
    options: {
      archives,
      baseUrl: "https://example.test/download",
      out: join(root, "registry.json"),
      ledgers: join(root, "registry"),
      servers: folder,
    },
  };
}

const GITHUB = {
  id: "github",
  name: "GitHub",
  summary: "Issues and pull requests.",
  category: "MCP Servers",
  transport: { type: "stdio", command: "github-mcp-server" },
};

test("a release of a package keeps the servers nobody packages", () => {
  const repo = repository({ servers: { "github.json": GITHUB } });
  const { index } = registry(repo.folders, repo.options);

  assert.equal(index.formatVersion, REGISTRY_FORMAT);
  assert.deepEqual(
    index.extensions.map((one) => one.id),
    ["github", "one"],
  );
  // The written file is the one the window reads, so it is what is asserted on.
  const written = JSON.parse(readFileSync(repo.options.out, "utf8"));
  assert.equal(written.extensions.length, 2);
  // A server carries no artefact, which is what format 2 exists to allow.
  assert.equal(written.extensions[0].artefact, undefined);
  assert.equal(written.extensions[1].artefact.sha256.length, 64);
});

test("the index is format 2, because an entry may have no archive at all", () => {
  assert.equal(REGISTRY_FORMAT, 2);
});

test("a repository with no descriptors is a repository of packages, not an error", () => {
  const repo = repository();
  const { index, described } = registry(repo.folders, {
    ...repo.options,
    servers: join(repo.root, "nothing-here"),
  });
  assert.deepEqual(described, []);
  assert.deepEqual(
    index.extensions.map((one) => one.id),
    ["one"],
  );
});

test("a descriptor with no transport is refused, because nothing could reach it", () => {
  const repo = repository({
    servers: { "github.json": { id: "github", name: "GitHub" } },
  });
  assert.throws(() => registry(repo.folders, repo.options), /names no transport/);
});

test("a descriptor carrying an artefact is refused as a package in the wrong place", () => {
  const repo = repository({
    servers: {
      "github.json": { ...GITHUB, artefact: { url: "https://example.test/x", sha256: "0" } },
    },
  });
  assert.throws(() => registry(repo.folders, repo.options), /rather than a server/);
});

test("a descriptor filed under another id is refused, so a file says what it is", () => {
  const repo = repository({ servers: { "gh.json": GITHUB } });
  assert.throws(() => registry(repo.folders, repo.options), /named wrongly/);
});

test("one id is one card, so a package and a descriptor of the same name is refused", () => {
  const repo = repository({ servers: { "one.json": { ...GITHUB, id: "one" } } });
  assert.throws(() => registry(repo.folders, repo.options), /one id is one card/);
});
