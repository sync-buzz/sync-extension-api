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
 * The one function a handler's isolate is given, and the whole of its reach.
 *
 * Named here for the same reason [`RUNTIME_GLOBAL`] is: both sides name it, so
 * it is part of the contract rather than a detail of either. It takes a
 * function name and a JSON string and answers a JSON string, and it throws when
 * the host refuses — which is a refusal the handler can catch.
 */
export const SERVICE_GLOBAL = "__syncHost__";

/** Where a package's handlers are written, before the CLI builds them. */
export const SERVICE_ENTRY = "src/service.ts";

/**
 * What `@sync-buzz/extension-api/service` binds to, and what each name calls.
 *
 * **Sync is the authority.** Its `handlers.rs` decides what a handler may reach
 * and answers a catchable refusal — naming what *is* offered — for anything
 * else. This table is a second statement of that list, exactly as the manifest
 * schema in this package is a second statement of Sync's manifest reader: where
 * the two disagree, Sync is right and this is behind, and that is a bug in this
 * file rather than a difference of opinion. The cost of the drift is bounded by
 * that refusal: an author hears a sentence naming what exists, in their own
 * terminal, from `sync-ext check`.
 *
 * `takes` names the arguments the member is written with, in order, and they
 * become the members of the object the host is called with. A `null` means the
 * member takes the payload itself and it crosses as it stands.
 */
export const SERVICE_SURFACE = {
  memory: {
    record: { calls: "memory.record", takes: ["key"] },
    list: { calls: "memory.list", takes: null },
    content: { calls: "memory.content", takes: ["key"] },
  },
  work: {
    order: { calls: "work.order", takes: null },
  },
  vault: {
    read: { calls: "vault.read", takes: ["name"] },
    write: { calls: "vault.write", takes: ["name", "secret"] },
    forget: { calls: "vault.forget", takes: ["name"] },
  },
  net: {
    fetch: { calls: "net.fetch", takes: null },
  },
};

/**
 * What a package must ask for before a handler of it may open one of the doors
 * that leaves the machine.
 *
 * Sync's `handlers.rs` is the authority for every one of these and this is a
 * second statement of the names, on the same terms as the rest of this package:
 * where the two disagree Sync is right and this is behind.
 *
 * Each is checked by looking for the call in the built module, so each entry is
 * a capability and the calls that need it. `net.write` is deliberately not
 * here: which verb a request uses is computed, so a scan would pass the package
 * that builds its method from a variable — and a check that catches one of two
 * spellings is worse than none, because it is read as a check.
 */
export const SERVICE_CAPABILITIES = [
  {
    capability: "work.agent",
    calls: [SERVICE_SURFACE.work.order.calls],
    because:
      "Ordering work spends somebody's tokens while they are asleep, and the card they install from has to say so.",
  },
  {
    capability: "vault",
    calls: [
      SERVICE_SURFACE.vault.read.calls,
      SERVICE_SURFACE.vault.write.calls,
      SERVICE_SURFACE.vault.forget.calls,
    ],
    because:
      "Holding somebody's secrets is something they agree to on the card, before anything of yours runs.",
  },
  {
    capability: "net",
    calls: [SERVICE_SURFACE.net.fetch.calls],
    because:
      "The hosts your manifest names are the whole of what you may reach, and a manifest that names none reaches nowhere.",
  },
];

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

/**
 * Every path a manifest points at, in the order Sync lists them.
 *
 * One list, because everything that walks a manifest for its files wants the
 * same answer: packing copies them, checking asserts they are there, and Sync
 * refuses an archive that is missing one. It was three walks in this package
 * until `styles` was added to the manifest, to the schema and to Sync — and to
 * none of the three. That shipped two packages which download, hash correctly,
 * and then will not open, because the one file they declare was never packed.
 *
 * Mirrors `Manifest::files` in Sync's `sync-extensions` crate. The two lists
 * are still two, in two languages; what holds them together is that Sync's own
 * tests open the archives a release ships. A field added there and not here
 * fails there, loudly, rather than in somebody's marketplace.
 */
/**
 * Every global a handler's isolate provides, and nothing else.
 *
 * Taken from a live QuickJS isolate on 2026-08-25, not written from memory. The
 * counterpart is `ISOLATE_GLOBALS` in Sync's `sync-handlers`, and a test there
 * compares it against a running isolate — so a newer QuickJS that adds or drops
 * one fails in that repository, where somebody can come and update this.
 *
 * It is much narrower than Node or a browser, and that is the point: this list
 * is what a service module is really written against. There is no `console`
 * either — the host provides one over its own bridge, so it is allowed here
 * while not being in this list.
 */
export const ISOLATE_GLOBALS = [
  "AggregateError", "Array", "ArrayBuffer", "Atomics", "BigInt", "BigInt64Array",
  "BigUint64Array", "Boolean", "DataView", "Date", "Error", "EvalError",
  "FinalizationRegistry", "Float16Array", "Float32Array", "Float64Array", "Function",
  "Infinity", "Int16Array", "Int32Array", "Int8Array", "InternalError", "Iterator", "JSON",
  "Map", "Math", "NaN", "Number", "Object", "Promise", "Proxy", "RangeError",
  "ReferenceError", "Reflect", "RegExp", "Set", "SharedArrayBuffer", "String", "Symbol",
  "SyntaxError", "TypeError", "URIError", "Uint16Array", "Uint32Array", "Uint8Array",
  "Uint8ClampedArray", "WeakMap", "WeakRef", "WeakSet", "decodeURI", "decodeURIComponent",
  "encodeURI", "encodeURIComponent", "escape", "eval", "globalThis", "isFinite", "isNaN",
  "parseFloat", "parseInt", "performance", "queueMicrotask", "undefined", "unescape",
];

/** The global a service module reaches its host through. */
export const SERVICE_HOST_GLOBAL = "__syncHost__";

export function filesOf(manifest) {
  return [
    ...(manifest.ui ? [manifest.ui] : []),
    ...(manifest.styles ? [manifest.styles] : []),
    ...(manifest.service ? [manifest.service] : []),
    ...(manifest.types ?? []),
    ...(manifest.prompt ? [manifest.prompt] : []),
  ];
}

/**
 * Every handler the manifest names, in the order the occasions are read.
 *
 * The counterpart of `Manifest::handlers` in Rust, and the same rule: there is
 * no `handlers` list to read from, because every name arrives attached to an
 * occasion that will call it. A second list of the same names would disagree
 * with the first the day somebody renamed one.
 */
export function handlersOf(manifest) {
  const named = [];
  if (manifest.lifecycle?.installed) named.push(manifest.lifecycle.installed);
  for (const scheduled of manifest.schedule ?? []) {
    if (scheduled?.handler) named.push(scheduled.handler);
  }
  // The third occasion, and the one whose caller is not the application: an
  // agent says the name. Left out of this list, a tool's handler reads as a
  // function nothing calls — which is what `check` says about it, in the one
  // place an author would believe it.
  for (const tool of manifest.tools ?? []) {
    if (tool?.handler) named.push(tool.handler);
  }
  return named;
}

/** Reads an extension's manifest, or says which folder had none. */
export function manifestOf(folder) {
  try {
    return JSON.parse(readFileSync(join(folder, "manifest.json"), "utf8"));
  } catch (refused) {
    throw new Error(`${folder} holds no readable manifest.json: ${refused.message}`);
  }
}
