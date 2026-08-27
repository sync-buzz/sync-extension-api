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
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

import {
  ISOLATE_GLOBALS,
  RUNTIME_GLOBAL,
  SERVICE_HOST_GLOBAL,
  SERVICE_SURFACE,
  filesOf,
  handlersOf,
  manifestOf,
  manifestSchema,
  runtime,
} from "./contract.mjs";

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
/**
 * The namespaces a package may use and may never declare.
 *
 * An extension writes `bg-panel` and `gap-1.5` freely — that is the point, and
 * the whole of its own stylesheet is rules built from names like these. What it
 * must not do is say what one of them is *worth*. A package declaring
 * `--surface-panel` would not restyle itself; it would restyle the window
 * around it, because these are the variables every column, every sheet and
 * every menu in the application reads. One package would be repainting a
 * neighbour's furniture.
 *
 * This is the one thing that stays closed, and it is closed narrowly and on
 * purpose. Everything else an author writes — their own class, their own
 * variable under their own name, plain CSS, a keyframe, a media query — is
 * theirs. A vocabulary of permitted utilities was considered and rejected: an
 * author who needs a panel the shell has no equivalent for has to be able to
 * build one, and a list of what we thought of in advance is a wall in front of
 * exactly that person.
 */
const OWNED = [
  "--surface-",
  "--text-",
  "--separator",
  "--state-",
  "--status-",
  "--focus-",
  "--scrim",
  "--spacing",
  "--radius-",
  "--control-height",
  "--panel-header-height",
  "--motion-",
  "--prose-",
  "--tint-",
  "--color-",
  "--font-",
];

/** Every `--name:` a package declares that belongs to the window. */
function redefinedTokens(folder) {
  const wrong = [];
  const source = join(folder, "src");
  if (!existsSync(source)) return wrong;

  for (const file of stylesheets(source)) {
    const text = readFileSync(file, "utf8");
    for (const [, , name] of text.matchAll(/(^|[;{\s])(--[a-z0-9-]+)\s*:/gi)) {
      if (!OWNED.some((owned) => name.startsWith(owned))) continue;
      wrong.push(
        `${relative(folder, file)} declares ${name}, which is the window's. ` +
          "Refer to it, never set it: a package that sets one repaints the " +
          "application around itself rather than styling its own section.",
      );
    }
  }
  return [...new Set(wrong)];
}

function stylesheets(from) {
  const found = [];
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const at = join(from, entry.name);
    if (entry.isDirectory()) found.push(...stylesheets(at));
    else if (entry.name.endsWith(".css")) found.push(at);
  }
  return found;
}

export async function check(folder) {
  const problems = [];
  const complain = (message) => problems.push(message);
  const manifest = manifestOf(folder);

  const ajv = new Ajv({ allErrors: true, strict: false });
  const validate = ajv.compile(manifestSchema());
  if (!validate(manifest)) {
    // One rule is worth saying in words rather than in the schema's. An
    // `if/then` failure arrives as "must match \"then\" schema", which names
    // neither the condition nor the consequence — and this is the rule an
    // author is most likely to meet, because it goes with the newest field.
    if (manifest.service !== undefined && !(manifest.capabilities ?? []).includes("background")) {
      complain(
        'it ships a service module and does not ask for the "background" capability. Running code with no screen is something a person agrees to before installing, and the card is where they agree to it.',
      );
      return { manifest, problems };
    }
    // The same translation one occasion over, and a separate sentence rather
    // than a wider one: the two capabilities are two different agreements, so
    // an author told only about the first would widen the wrong one.
    if ((manifest.schedule ?? []).length > 0 && !(manifest.capabilities ?? []).includes("schedule")) {
      complain(
        'it asks for the clock and does not ask for the "schedule" capability. Running on a clock when no window is open is a second thing a person agrees to — "background" says this package runs code, "schedule" says it runs while nobody is there.',
      );
      return { manifest, problems };
    }
    // The network, in both directions, because both are reachable by an
    // ordinary mistake: a host list added without the capability, and a
    // capability copied off another package with no list under it.
    if ((manifest.net?.hosts ?? []).length > 0 && !(manifest.capabilities ?? []).includes("net")) {
      complain(
        'it names hosts to reach and does not ask for the "net" capability. Reading something nobody in the window wrote is something a person agrees to before installing, and the card is where they agree to it.',
      );
      return { manifest, problems };
    }
    if ((manifest.capabilities ?? []).includes("net") && (manifest.net?.hosts ?? []).length === 0) {
      complain(
        'it asks for the "net" capability and names no hosts under "net". The list is the permission — without it there is nothing to check a request against, and nothing on the card for anybody to have agreed to.',
      );
      return { manifest, problems };
    }
    if ((manifest.schedule ?? []).length > 0 && manifest.service === undefined) {
      complain(
        "it schedules a handler and ships no service module. A package that says when to call a handler and has nothing to call it in has declared an intention rather than a capability.",
      );
      return { manifest, problems };
    }
    for (const error of validate.errors ?? []) {
      // An interval says what to write instead. A regular expression is a
      // better refusal than "must match \"then\" schema" and still not one an
      // author can act on without decoding it, and the host says this in words
      // already — a manifest refused in two places should not be refused twice
      // as well as it can be and once as badly.
      // The one required field whose absence a schema reports as a missing
      // key rather than as a wrong value, and the author is owed the reason
      // it is required rather than the fact that it is.
      if (
        error.keyword === "required" &&
        error.params?.missingProperty === "description" &&
        /^\/schedule\/\d+$/.test(error.instancePath ?? "")
      ) {
        const at = Number(error.instancePath.split("/")[2]);
        complain(
          `"${manifest.schedule?.[at]?.handler}" runs on a clock and does not say what it does. The page somebody installs from works out how often from "every" and cannot work out what for from anything — and the handler's own name is not shown, because it is your name for one of your own functions.`,
        );
        continue;
      }
      if (/^\/schedule\/\d+\/description$/.test(error.instancePath ?? "")) {
        const at = Number(error.instancePath.split("/")[2]);
        complain(
          `"${manifest.schedule?.[at]?.handler}" runs on a clock and says nothing about what it does. One sentence, in your own words: it is what the page somebody installs from shows beside how often.`,
        );
        continue;
      }
      if (/^\/schedule\/\d+\/every$/.test(error.instancePath ?? "")) {
        const at = Number(error.instancePath.split("/")[2]);
        complain(
          `"${manifest.schedule?.[at]?.every}" is not how often to run "${manifest.schedule?.[at]?.handler}": a count and a unit, like "30m", "6h" or "1d" — minutes, hours or days, and at least one of them.`,
        );
        continue;
      }
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

  for (const wrong of redefinedTokens(folder)) complain(wrong);

  // Everything the manifest names, asked for in one place. Scattered existence
  // checks are how `styles` came to be checked nowhere: three sites here each
  // asked about one field, a fourth field was added, and no site was about it.
  // A missing file is said once, here, and the sites below only step aside.
  const fromABuild = new Set([manifest.ui, manifest.styles].filter(Boolean));
  for (const path of filesOf(manifest)) {
    if (existsSync(join(folder, path))) continue;
    complain(
      fromABuild.has(path)
        ? `${path} is not there. Build it first.`
        : `the manifest names ${path}, and there is no such file.`,
    );
  }

  // Every kind it publishes is its own. Sync refuses the rest; this says so
  // before the package is anywhere near a project's memory.
  const published = new Set();
  for (const path of manifest.types ?? []) {
    const at = join(folder, path);
    // Said above. Here it is only a definition that cannot be read.
    if (!existsSync(at)) continue;
    const definition = JSON.parse(readFileSync(at, "utf8"));
    if (!definition.kind?.startsWith(`${manifest.id}.`)) {
      complain(
        `"${definition.kind}" in ${path} is not its to publish: a kind it publishes begins with "${manifest.id}.".`,
      );
    }
    if (definition.kind !== undefined) published.add(definition.kind);
  }

  // A badge that counts nothing is the failure this check exists for: it draws
  // no mark, raises no error and looks exactly like a section with nothing to
  // report. Sync refuses another extension's kind; only the package's own tree
  // can say whether a kind of its own is one it ever writes.
  for (const area of manifest.areas ?? []) {
    for (const kind of area.badge?.kinds ?? []) {
      if (!kind.startsWith(`${manifest.id}.`)) {
        complain(
          `the area "${area.id}" badges "${kind}", which is not its to count: a kind it publishes begins with "${manifest.id}.".`,
        );
      } else if (!published.has(kind) && !(manifest.opens?.kinds ?? []).includes(kind)) {
        complain(
          `the area "${area.id}" badges "${kind}", and the package neither publishes nor opens it — the count would be zero for ever, and a badge that never appears looks like a section with nothing to say.`,
        );
      }
    }
  }

  await checkService(folder, manifest, complain);

  const areas = manifest.areas ?? [];
  if (manifest.ui === undefined) return { manifest, problems };

  const built = join(folder, manifest.ui);
  // Said above. Here it only means there is no module to start.
  if (!existsSync(built)) return { manifest, problems };

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
 * The service module: does it exist, does it register what the manifest names,
 * and does it reach for anything the isolate will not have.
 *
 * The last question is the one this exists for. A handler runs in QuickJS
 * embedded in Sync, and **this process is Node** — which has `fetch`,
 * `setTimeout` and `TextDecoder`, none of which the isolate does. Checking a
 * module in an environment richer than the one that will run it is not
 * checking it: the module passes here, packs, publishes, and fails at three in
 * the morning when a clock fires, in a place with no terminal.
 *
 * So the built file is read for calls to everything Node has and the isolate
 * does not, and each one is named.
 *
 * **This is a scan, and its limits are stated rather than hidden.** It sees
 * `fetch(...)` and `new TextDecoder(...)`; it does not see `globalThis["fet" +
 * "ch"]`, and it cannot tell a call from a mention inside a template. The exact
 * check is to run the module in a real isolate, which means shipping QuickJS in
 * this CLI — worth doing the day a package is caught by the gap, and not
 * before.
 *
 * Taking the missing globals off Node's own `globalThis` for the length of the
 * load was tried first and is why this is a scan: `import()` uses `process`, so
 * removing it broke the CLI itself before it could read anything.
 */
/**
 * What a package must ask for before a handler of it may order work.
 *
 * Sync's `handlers.rs` is the authority and this is a second statement of the
 * name, on the same terms as everything else in this package: where the two
 * disagree Sync is right and this is behind.
 */
const WORK_AGENT = "work.agent";

async function checkService(folder, manifest, complain) {
  const named = handlersOf(manifest);
  if (manifest.service === undefined) {
    if (named.length > 0) {
      complain(`it names the handler "${named[0]}" and ships no service module.`);
    }
    return;
  }

  const built = join(folder, manifest.service);
  if (!existsSync(built)) return; // Said already, by the files check above.

  const source = readFileSync(built, "utf8");
  for (const absent of absentFromTheIsolate()) {
    // A call, not a mention: `thing.fetch(...)` is somebody's own method and
    // none of this check's business, and a name inside a string is not a call.
    if (new RegExp(String.raw`(^|[^.\w$])${absent}\s*\(`).test(source)) {
      complain(
        `its service module calls ${absent}(), which a handler does not have: handlers run in QuickJS, not in Node or a browser. Ask the host for it instead.`,
      );
    }
  }

  // The one capability a manifest cannot give away. `background` and `schedule`
  // are visible in the file and are refused when it is read; whether a handler
  // orders work is only ever visible here, in what the build produced. Sync
  // refuses the call itself, but for a handler on a clock that refusal lands at
  // three in the morning with nobody in front of it — so it is said here too,
  // where the author is.
  //
  // The name is the one the surface's shim emits, taken from the contract
  // rather than spelled again. A package that does not import `work` does not
  // carry it: the shim's unused members are dropped by the build, which was
  // measured rather than assumed before this check was written.
  const orders = SERVICE_SURFACE.work.order.calls;
  if (source.includes(orders) && !(manifest.capabilities ?? []).includes(WORK_AGENT)) {
    complain(
      `its service module calls ${orders}() and the manifest does not ask for the "${WORK_AGENT}" capability. Ordering work spends somebody's tokens while they are asleep, and the card they install from has to say so.`,
    );
  }

  globalThis[SERVICE_HOST_GLOBAL] = () => "null";
  let table;
  try {
    const module = await import(`${pathToFileURL(built).href}?service=${process.pid}-${named.length}`);
    if (typeof module.default !== "function") {
      complain("its service module exports no default function, which is what the host calls to register its handlers.");
      return;
    }
    table = module.default();
  } catch (threw) {
    complain(`its service module threw while registering: ${threw.message}`);
    return;
  }

  if (table === null || typeof table !== "object") {
    complain("its service module registered no handlers: register() answers with an object of them.");
    return;
  }
  for (const handler of named) {
    if (typeof table[handler] !== "function") {
      complain(`the manifest names the handler "${handler}" and the module registered no such function.`);
    }
  }
  for (const returned of Object.keys(table)) {
    if (!named.includes(returned)) {
      complain(
        `its service module registers "${returned}", which no occasion in the manifest calls — it would never run.`,
      );
    }
  }
}

/** What Node has and a handler's isolate does not. `console` is the host's. */
function absentFromTheIsolate() {
  return Object.getOwnPropertyNames(globalThis).filter(
    (name) => name !== "console" && !ISOLATE_GLOBALS.includes(name),
  );
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
