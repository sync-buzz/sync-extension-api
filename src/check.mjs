/**
 * Checks one extension against its own manifest, and the manifest against the
 * schema.
 *
 * Sync makes every one of these checks itself and refuses a package that fails
 * one. The reason to make them here as well is *when*: Sync makes them while
 * somebody is opening a project, and reports them as a section that did not
 * appear. Making them at the end of a build turns the same failure into a line
 * in the terminal of the person who caused it.
 *
 * The one that earns its keep is the last: it **runs the module**. `activate`
 * is ordinary code, its return value is decided at runtime, and the manifest is
 * JSON — nothing in the type system relates the two, so an area renamed in one
 * and not the other type-checks perfectly and installs as an empty column.
 *
 * The stand-in host is a proxy, so every member of the surface the module reads
 * at load answers with something. That is enough to reach `activate` and see
 * what it returns; it is deliberately not enough to render anything, which is a
 * question for the window rather than for a build.
 */

// The 2020-12 build rather than the default one: the schema declares that
// dialect, and Ajv's default export knows draft-07 and refuses the `$schema`
// it does not recognise.
import Ajv from "ajv/dist/2020.js";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { RUNTIME_GLOBAL, manifestOf, manifestSchema, runtime } from "./contract.mjs";

/**
 * Which columns each frame has.
 *
 * The contract an area is held to, stated where an author can read it. If it
 * ever disagrees with the shell, the shell is right and this is a bug here.
 */
const FRAMES = {
  browse: { Navigator: true, Inspector: true },
  list: { Navigator: true, Inspector: false },
  detail: { Navigator: false, Inspector: true },
  single: { Navigator: false, Inspector: false },
};

/**
 * @param folder The extension's own directory.
 * @returns `{ manifest, problems }` — problems is empty when it is well formed.
 */
export async function check(folder) {
  const problems = [];
  const complain = (message) => problems.push(message);
  const manifest = manifestOf(folder);

  const ajv = new Ajv({ allErrors: true, strict: false });
  const validate = ajv.compile(manifestSchema());
  if (!validate(manifest)) {
    for (const error of validate.errors ?? []) {
      // The field is named where there is one to name. A manifest is written by
      // a tool, so an unrecognised key is a typo or a newer format, and "must
      // NOT have additional properties" answers neither question.
      const named = error.params?.additionalProperty;
      complain(
        named === undefined
          ? `manifest${error.instancePath} ${error.message}`
          : `manifest${error.instancePath} has an unknown field "${named}" — a typo, or a format newer than this contract.`,
      );
    }
    // Nothing below can be trusted about a manifest the schema refused, and a
    // cascade of consequences buries the one line that says what to fix.
    return { manifest, problems };
  }

  const supported = runtime().version;
  if (!accepts(manifest.engines.syncApi, supported)) {
    complain(
      `it asks for Sync's extension API ${manifest.engines.syncApi}, and this contract is ${supported}.`,
    );
  }

  // Every kind it publishes is its own. Sync refuses the rest; this says so
  // before the package is anywhere near a project's memory.
  for (const path of manifest.types ?? []) {
    const at = join(folder, path);
    if (!existsSync(at)) {
      complain(`the manifest names ${path}, and there is no such file.`);
      continue;
    }
    const definition = JSON.parse(readFileSync(at, "utf8"));
    if (!definition.kind?.startsWith(`${manifest.id}.`)) {
      complain(
        `"${definition.kind}" in ${path} is not its to publish: a kind it publishes begins with "${manifest.id}.".`,
      );
    }
  }

  if (manifest.prompt !== undefined && !existsSync(join(folder, manifest.prompt))) {
    complain(`the manifest names ${manifest.prompt}, and there is no such file.`);
  }

  const areas = manifest.areas ?? [];
  if (manifest.ui === undefined) return { manifest, problems };

  const built = join(folder, manifest.ui);
  if (!existsSync(built)) {
    complain(`${manifest.ui} is not there. Build it first.`);
    return { manifest, problems };
  }

  const surface = new Proxy({}, { get: () => function stub() { return null; } });
  globalThis[RUNTIME_GLOBAL] = { React: await import("react").then((m) => m.default ?? m), api: surface };

  let produced;
  try {
    // The query keeps a second check in one process from reading a cached
    // module: `sync-ext check` over a directory of extensions is one process.
    const module = await import(`${pathToFileURL(built).href}?checked=${process.pid}-${areas.length}`);
    if (typeof module.default !== "function") {
      complain("its module exports no default function, which is what the host calls to start it.");
      return { manifest, problems };
    }
    produced = module.default({ id: manifest.id });
  } catch (threw) {
    complain(`it threw while starting: ${threw.message}`);
    return { manifest, problems };
  }

  // One area may be returned bare, exactly as the host reads it.
  const byArea =
    areas.length === 1 && "Workspace" in produced ? { [areas[0].id]: produced } : produced;

  for (const area of areas) {
    const module = byArea[area.id];
    if (module === undefined) {
      complain(`it declares the area "${area.id}" and returned nothing for it.`);
      continue;
    }
    if (typeof module.Workspace !== "function") {
      complain(`the area "${area.id}" returned no Workspace, and every frame has one.`);
    }
    for (const [column, wanted] of Object.entries(FRAMES[area.frame])) {
      const has = typeof module[column] === "function";
      if (wanted && !has) {
        complain(
          `the area "${area.id}" declares the "${area.frame}" frame, which has a ${column.toLowerCase()}, and returned none.`,
        );
      }
      if (!wanted && has) {
        complain(
          `the area "${area.id}" returned a ${column}, and the "${area.frame}" frame has no such column.`,
        );
      }
    }
  }

  return { manifest, problems };
}

/**
 * Whether a range accepts a version, to the depth this needs.
 *
 * Caret and tilde over `major.minor.patch`, which is what a manifest states.
 * Not a semver implementation: the host has one, and this is a courtesy check
 * that fails early rather than a second authority on compatibility.
 */
function accepts(range, version) {
  const [major, minor = 0, patch = 0] = version.split(".").map(Number);
  const match = /^([\^~]?)(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(range.trim());
  if (match === null) return true; // Not a shape this understands; leave it to the host.
  const [, operator, wantedMajor, wantedMinor, wantedPatch] = match;
  const wanted = [Number(wantedMajor), Number(wantedMinor ?? 0), Number(wantedPatch ?? 0)];
  const found = [major, minor, patch];

  if (operator === "") return wanted.every((part, at) => part === found[at]);
  if (found[0] !== wanted[0]) return false;
  if (operator === "~") return found[1] === wanted[1] && found[2] >= wanted[2];
  return found[1] > wanted[1] || (found[1] === wanted[1] && found[2] >= wanted[2]);
}
