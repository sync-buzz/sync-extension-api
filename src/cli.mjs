#!/usr/bin/env node
/**
 * `sync-ext` — what an extension's author runs.
 *
 *   sync-ext build [folder…] [--watch]
 *   sync-ext check [folder…]
 *   sync-ext pack  [folder…] [--out <dir>]
 *
 * A folder is one extension: the directory holding its `manifest.json`. Several
 * may be named, and naming none means the working directory — a repository of
 * extensions passes them all and gets one line each.
 *
 * `init` is deliberately absent. It scaffolds from a template, the template has
 * to reflect what actually works rather than what was intended, and the honest
 * way to get one is to write it after the first extensions exist. It arrives
 * with the template, in the registry's repository.
 */

import { resolve } from "node:path";

import { build } from "./build.mjs";
import { check } from "./check.mjs";
import { pack } from "./pack.mjs";
import { runtime } from "./contract.mjs";

const argv = process.argv.slice(2);
const command = argv[0];

function flag(name) {
  return argv.includes(`--${name}`);
}

function option(name, fallback) {
  const at = argv.indexOf(`--${name}`);
  return at === -1 ? fallback : argv[at + 1];
}

/** Every folder named, or the working directory when none was. */
function folders() {
  const named = argv
    .slice(1)
    .filter((one) => !one.startsWith("--"))
    .filter((one, at, all) => all.indexOf(one) === at);
  // The value of `--out` is not a folder to operate on.
  const out = option("out", null);
  const chosen = named.filter((one) => one !== out);
  return (chosen.length === 0 ? ["."] : chosen).map((one) => resolve(one));
}

function usage(code) {
  process.stderr.write(
    [
      "sync-ext — build, check and pack an extension for Sync.",
      "",
      "  sync-ext build [folder…] [--watch]",
      "  sync-ext check [folder…]",
      "  sync-ext pack  [folder…] [--out <dir>]",
      "",
      `contract ${runtime().version}`,
      "",
    ].join("\n"),
  );
  process.exit(code);
}

if (command === undefined || flag("help") || command === "help") usage(0);

let failed = false;

try {
  for (const folder of folders()) {
    switch (command) {
      case "build": {
        const built = await build(folder, { watch: flag("watch") });
        process.stdout.write(
          built === null
            ? `${folder}: no ui to build — point Sync at the folder\n`
            : built.watching
              ? `${folder}: watching — reload the extension in Sync to see a change\n`
              : `${folder}: built against contract ${built.version}\n`,
        );
        break;
      }
      case "check": {
        const { manifest, problems } = await check(folder);
        const brings = [
          ...(manifest.areas ?? []).map((area) => area.label),
          ...((manifest.types ?? []).length > 0 ? [`${manifest.types.length} types`] : []),
        ];
        // Said before the verdict rather than after it, so that a package which
        // fails a check is still listed as having been looked at. A silent id
        // reads as an id nobody read, which is what a checker must never be.
        process.stdout.write(
          `${manifest.id} ${manifest.version} — ${brings.join(", ") || "a prompt and nothing else"}\n`,
        );
        for (const problem of problems) {
          failed = true;
          process.stderr.write(`  ${manifest.id}: ${problem}\n`);
        }
        break;
      }
      case "pack": {
        const { archive, digest } = pack(folder, resolve(option("out", process.cwd())));
        process.stdout.write(`${archive}\nsha256 ${digest}\n`);
        break;
      }
      default:
        usage(2);
    }
  }
} catch (refused) {
  process.stderr.write(`${refused.message}\n`);
  process.exit(1);
}

process.exit(failed ? 1 : 0);
