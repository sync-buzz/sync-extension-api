/**
 * Builds one extension into the module Sync loads.
 *
 * The whole of the interesting part is what happens to two imports. An author
 * writes `import { useState } from "react"` and
 * `import { Button } from "@sync/extension-api"`, which is the point — an
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

import { RUNTIME_GLOBAL, manifestOf, root, runtime } from "./contract.mjs";

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
      const injected = /^(react|@sync\/extension-api)$/;

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
 * @param folder The extension's own directory, holding `manifest.json`.
 * @returns What was built, or `null` for a package that ships no module.
 */
export async function build(folder, { watch = false } = {}) {
  const manifest = manifestOf(folder);
  if (manifest.ui === undefined) return null;

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

  if (watch) {
    const watcher = await context(options);
    await watcher.watch();
    return { watching: true, version: contract.version };
  }

  await esbuild(options);
  return { watching: false, version: contract.version };
}
