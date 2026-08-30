/**
 * Builds one extension into the module Sync loads.
 *
 * The whole of the interesting part is what happens to two imports. An author
 * writes `import { useState } from "react"` and
 * `import { Button } from "@sync-buzz/extension-api"`, which is the point — an
 * extension should read like the application it extends. Neither can be
 * bundled:
 *
 * - **React must be the window's.** Two copies in one document means the first
 *   hook an extension calls throws, because the copy holding the dispatcher is
 *   not the copy being called.
 * - **The surface must be the window's objects**, not a second implementation
 *   of them. A bundled copy of the component library would be a second set of
 *   portals, focus traps and scroll locks in one window, and "the same styles"
 *   would quietly become "the same as of the last time both were published".
 *
 * So both are replaced with shims that read what the host published on the
 * global before it fetched the module. The names are not invented here:
 * React's come from React itself, and the surface's from the list generated
 * beside the declarations — so a shim cannot claim an export the contract does
 * not have.
 *
 * `lucide-react` is bundled rather than shimmed, and that is a deliberate
 * exception to "one copy". An icon is a pure SVG component with no identity to
 * preserve — no hooks, no context — so a second copy of the six an extension
 * uses costs a couple of kilobytes, where serving the library from the host
 * would mean the application bundling fifteen hundred icon modules so that an
 * extension can pick six.
 *
 * JSX is compiled in the classic style — `React.createElement` — rather than
 * the automatic one. Automatic JSX imports from `react/jsx-runtime`, which is a
 * second module the host would have to publish; classic needs only the React
 * the host already has.
 */

import { build as esbuild, context } from "esbuild";
import { createRequire } from "node:module";
import { join } from "node:path";

import {
  PACKAGE_NAME,
  RUNTIME_GLOBAL,
  SERVICE_ENTRY,
  SERVICE_GLOBAL,
  SERVICE_SURFACE,
  manifestOf,
  root,
  runtime,
} from "./contract.mjs";
import { styles } from "./styles.mjs";

const require = createRequire(import.meta.url);

/**
 * A module whose every export is a member of one object on the global.
 *
 * Read at evaluation rather than at call: the host writes the object before it
 * fetches the module, so by the time this runs it is there — and a value read
 * once cannot become a different value later, because it is written once and
 * never again.
 */
function shim(member, names, withDefault) {
  const lines = [
    `const host = globalThis.${RUNTIME_GLOBAL};`,
    `if (host === undefined) {`,
    `  throw new Error("This module was loaded outside Sync, or before the host published its runtime.");`,
    `}`,
    `const bound = host.${member};`,
  ];
  if (withDefault) lines.push("export default bound;");
  for (const name of names) {
    if (name === "default") continue;
    lines.push(`export const ${name} = bound[${JSON.stringify(name)}];`);
  }
  return lines.join("\n");
}

/** Replaces the two imports that must be the window's, and only those two. */
function hostRuntime(values) {
  return {
    name: "sync-host-runtime",
    setup(builder) {
      // Built from the package's own name rather than written out: an author
      // imports it by that name, and two spellings of one name is how a rename
      // goes half done.
      const injected = new RegExp(
        `^(react|${PACKAGE_NAME.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})$`,
      );

      builder.onResolve({ filter: injected }, (argument) => ({
        path: argument.path,
        namespace: "sync-host",
      }));

      builder.onLoad({ filter: /.*/, namespace: "sync-host" }, (argument) => ({
        contents:
          argument.path === "react"
            ? shim("React", Object.keys(require("react")), true)
            : shim("api", values, false),
        loader: "js",
      }));
    },
  };
}

/**
 * The service surface, as calls on the one function the isolate is given.
 *
 * Written out rather than bundled from a real module, for the reason the UI
 * shim is: the names then cannot drift from the contract, because they *are*
 * the contract — [`SERVICE_SURFACE`] is the same table the declarations
 * describe.
 *
 * Every member is `async`, which is not decoration. The host answers
 * synchronously today, so the promise settles on the first turn of the job
 * queue and nothing waits — but a refusal from the host arrives as a rejection
 * rather than as a synchronous throw, which is the same thing an author will
 * catch on the day one of these genuinely waits. Write `await`.
 */
function serviceShim() {
  const lines = [
    `const host = globalThis.${SERVICE_GLOBAL};`,
    `if (host === undefined) {`,
    `  throw new Error("This module was loaded outside Sync, or outside a handler's isolate.");`,
    `}`,
    `const call = async (name, argument) => JSON.parse(host(name, JSON.stringify(argument ?? {})));`,
  ];
  for (const [member, functions] of Object.entries(SERVICE_SURFACE)) {
    const entries = Object.entries(functions).map(([name, { calls, takes }]) => {
      // A member that takes the payload itself passes it on; one written with
      // named arguments builds the object out of them, in the order the table
      // states — which is the order the declarations state, because both are
      // read from this one table.
      const written = takes === null ? "given" : takes.join(", ");
      const argument = takes === null ? "given" : `{ ${takes.join(", ")} }`;
      return `  ${name}: (${written}) => call(${JSON.stringify(calls)}, ${argument}),`;
    });
    lines.push(`export const ${member} = {`, ...entries, `};`);
  }
  return lines.join("\n");
}

/** Replaces the one import a service module may make. */
function serviceRuntime() {
  const subpath = `${PACKAGE_NAME}/service`;
  return {
    name: "sync-service-surface",
    setup(builder) {
      const injected = new RegExp(
        `^${subpath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
      );
      builder.onResolve({ filter: injected }, (argument) => ({
        path: argument.path,
        namespace: "sync-service",
      }));
      builder.onLoad({ filter: /.*/, namespace: "sync-service" }, () => ({
        contents: serviceShim(),
        loader: "js",
      }));
    },
  };
}

/**
 * Builds a package's handlers, when it has any.
 *
 * A second build rather than a second entry point of the first, because the two
 * are different runtimes and nothing about them lines up: no React, no JSX, no
 * stylesheet, no DOM, and a target chosen for an isolate rather than for
 * Safari. `platform: "neutral"` is what says so — it stops esbuild reaching for
 * a Node or a browser shim for anything, which in this isolate would be a
 * module that resolves at build time and throws at three in the morning.
 *
 * `es2020` is the floor rather than a guess: `async`, `await`, optional
 * chaining and nullish coalescing are what an author writing a handler
 * actually uses, and every one of them is in it.
 */
async function buildService(folder, manifest, { watch }) {
  const options = {
    entryPoints: [join(folder, SERVICE_ENTRY)],
    outfile: join(folder, manifest.service),
    bundle: true,
    format: "esm",
    target: "es2020",
    platform: "neutral",
    logLevel: "info",
    minify: !watch,
    sourcemap: false,
    plugins: [serviceRuntime()],
  };
  if (watch) {
    const watcher = await context(options);
    await watcher.watch();
    return;
  }
  await esbuild(options);
}

/**
 * @param folder The extension's own directory, holding `manifest.json`.
 * @returns What was built, or `null` for a package that ships neither module.
 *
 * **Two modules, either or both.** A package may have a screen and no handlers,
 * handlers and no screen, or both — `docs/background.md` §3.1 — so what is
 * built is what the manifest declares. The service module used to be built by
 * nothing at all, which made §3.2's promise that "the same CLI builds it"
 * false: handlers were written as JavaScript by hand, against a bare global.
 */
export async function build(folder, { watch = false } = {}) {
  const manifest = manifestOf(folder);
  if (manifest.service !== undefined) await buildService(folder, manifest, { watch });
  if (manifest.ui === undefined) {
    return manifest.service === undefined
      ? null
      : { watching: watch, version: runtime().version, styles: null };
  }

  const contract = runtime();
  const options = {
    entryPoints: [join(folder, "src/index.tsx")],
    outfile: join(folder, manifest.ui),
    bundle: true,
    format: "esm",
    target: "safari17",
    platform: "browser",
    jsx: "transform",
    jsxFactory: "React.createElement",
    jsxFragment: "React.Fragment",
    // Every module gets `React` in scope without importing it, which is what
    // the classic transform above needs and what an author should not have to
    // write.
    inject: [join(root, "src/react-inject.js")],
    logLevel: "info",
    minify: !watch,
    sourcemap: false,
    plugins: [hostRuntime(contract.values)],
  };

  // The stylesheet is built beside the module and named by the manifest, so a
  // package that draws nothing has neither and a package that draws carries
  // both. `styles` is optional in the manifest for the same reason `ui` is:
  // what is declared is what the package contains.
  const sheet = manifest.styles;

  if (watch) {
    const watcher = await context(options);
    await watcher.watch();
    if (sheet !== undefined) void styles(folder, sheet, { watch: true });
    return { watching: true, version: contract.version, styles: sheet ?? null };
  }

  await esbuild(options);
  if (sheet !== undefined) await styles(folder, sheet, { minify: true });
  return { watching: false, version: contract.version, styles: sheet ?? null };
}
