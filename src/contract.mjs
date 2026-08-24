/**
 * What this package carries, and where each part came from.
 *
 * Two of the three are generated rather than written: the declarations and the
 * list of names that exist at runtime are produced from Sync's own surface by
 * `pnpm api:publish` in that repository. Writing either by hand would make this
 * package a second description of the surface, going out of date at a different
 * rate from the first.
 *
 * The schema is written here, and is the exception on purpose: Sync's manifest
 * reader is the authority, and this is a second statement of the same rules for
 * everything that is not Sync — the packer, the registry's CI, an editor. Where
 * the two disagree the reader is right and this is behind, which is a bug in
 * this file rather than a difference of opinion.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The version of Sync's surface these declarations describe, and its names. */
export function runtime() {
  return JSON.parse(readFileSync(join(root, "runtime.json"), "utf8"));
}

export function manifestSchema() {
  return JSON.parse(
    readFileSync(join(root, "schema/manifest.schema.json"), "utf8"),
  );
}

/**
 * Where the host publishes its objects for a module being evaluated.
 *
 * Part of the contract rather than an implementation detail: the shims this
 * package generates read it, and Sync writes it before it fetches a module.
 * Both sides name it, which is why it is named here.
 */
export const RUNTIME_GLOBAL = "__syncExtensionHost__";

/**
 * What this package is called, read from its own manifest.
 *
 * Read rather than written down, because it is matched against an author's
 * import specifier and a second spelling of it is a rename waiting to go half
 * done. It already did: the name lived in a regex with an escaped slash, a
 * rename replaced every plain occurrence and left that one, and the failure was
 * every extension refusing to build with "could not resolve" — which names the
 * import and not the stale copy.
 */
export const PACKAGE_NAME = JSON.parse(
  readFileSync(join(root, "package.json"), "utf8"),
).name;

/** Reads an extension's manifest, or says which folder had none. */
export function manifestOf(folder) {
  try {
    return JSON.parse(readFileSync(join(folder, "manifest.json"), "utf8"));
  } catch (refused) {
    throw new Error(`${folder} holds no readable manifest.json: ${refused.message}`);
  }
}
