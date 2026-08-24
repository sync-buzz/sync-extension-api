/**
 * Packs a folder into a `.syncext`.
 *
 * Two properties are cheap to build in now and impossible to add later:
 *
 * - **Reproducible.** zip stores a timestamp per entry, so the same input would
 *   otherwise produce a different file every run and "build it yourself and
 *   compare" would never become available. Every entry is stamped with the same
 *   fixed date and written in sorted order.
 * - **Covered.** `META/hashes.json` names every file in the archive. The loader
 *   refuses an archive carrying anything the hashes do not cover, which is how
 *   something rides along beside what was signed.
 *
 * Signing is not here. `META/signature` is minisign over the bytes of the
 * hashes file, and it is the registry's CI that holds the key — a local packer
 * that could sign would make the signature mean nothing.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { manifestOf } from "./contract.mjs";

/**
 * @param folder The extension's own directory.
 * @param out Where to put the archive.
 * @returns The archive's path and its sha256.
 */
export function pack(folder, out) {
  const manifest = manifestOf(folder);

  // Every path the manifest points at, in the order the Rust side lists them.
  // A file in the folder that the manifest does not name is not packed: the
  // archive is what was declared, not what happened to be lying around. `ui` is
  // optional — an extension that publishes only a vocabulary has no module, and
  // packing a stub for it would be a file whose only reader is this script.
  const files = [
    "manifest.json",
    ...(manifest.ui ? [manifest.ui] : []),
    ...(manifest.types ?? []),
    ...(manifest.prompt ? [manifest.prompt] : []),
  ].sort();

  const staging = mkdtempSync(join(tmpdir(), "syncext-"));
  const hashes = {};

  try {
    for (const path of files) {
      const bytes = readFileSync(join(folder, path));
      hashes[path] = createHash("sha256").update(bytes).digest("hex");
      const destination = join(staging, path);
      mkdirSync(dirname(destination), { recursive: true });
      cpSync(join(folder, path), destination);
    }

    // Sorted keys and a trailing newline: the hashes file is what a signature
    // covers, so its bytes have to be a function of the input and nothing else.
    const canonical = `${JSON.stringify(hashes, Object.keys(hashes).sort(), 2)}\n`;
    mkdirSync(join(staging, "META"), { recursive: true });
    writeFileSync(join(staging, "META/hashes.json"), canonical);

    // One timestamp for every entry. 1980-01-01 is the earliest a zip can hold.
    spawnSync("find", [staging, "-exec", "touch", "-t", "198001010000", "{}", ";"]);

    const archive = join(out, `${manifest.id}-${manifest.version}.syncext`);
    rmSync(archive, { force: true });
    mkdirSync(out, { recursive: true });

    // `-X` drops the extra fields holding uid, gid and high-resolution times —
    // three more ways the same input produces a different file.
    const zipped = spawnSync(
      "zip",
      ["-X", "-q", "-r", archive, ...[...files, "META/hashes.json"].sort()],
      { cwd: staging, encoding: "utf8" },
    );
    if (zipped.status !== 0) throw new Error(zipped.stderr || "zip refused");

    return {
      archive,
      digest: createHash("sha256").update(readFileSync(archive)).digest("hex"),
    };
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}
