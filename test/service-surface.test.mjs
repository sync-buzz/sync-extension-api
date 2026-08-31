// The service surface is stated twice in this package, and this is what holds
// the two together.
//
// `SERVICE_SURFACE` is what the build writes into a package's module, and
// `service/index.d.ts` is what the author writes against. A member added to one
// and not the other type-checks perfectly and fails at run time in somebody
// else's application — which is the failure this package exists to prevent, not
// to demonstrate.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { SERVICE_CAPABILITIES, SERVICE_SURFACE } from "../src/contract.mjs";

const declarations = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "service", "index.d.ts"),
  "utf8",
);

test("every member the build writes is one the declarations describe", () => {
  for (const [member, functions] of Object.entries(SERVICE_SURFACE)) {
    assert.match(
      declarations,
      new RegExp(String.raw`export declare const ${member}:`),
      `the shim exports \`${member}\` and nothing declares it`,
    );
    for (const name of Object.keys(functions)) {
      assert.match(
        declarations,
        new RegExp(String.raw`\n\s+${name}\(`),
        `\`${member}.${name}\` is written by the build and declared nowhere`,
      );
    }
  }
});

test("each capability names calls that exist", () => {
  const offered = Object.values(SERVICE_SURFACE).flatMap((functions) =>
    Object.values(functions).map((entry) => entry.calls),
  );
  for (const { capability, calls } of SERVICE_CAPABILITIES) {
    assert.ok(calls.length > 0, `"${capability}" is checked against no call at all`);
    for (const call of calls) {
      assert.ok(
        offered.includes(call),
        `"${capability}" is checked against ${call}(), which this surface does not offer`,
      );
    }
  }
});

// The door a handler knocks on is the door a screen knocks on: `net.fetch`
// parses one request type in Rust, whichever half of a package sent it. So the
// two declarations of that type in this package have to name the same members.
//
// This is not the same check as the one above, and the difference is the whole
// reason for it: that one holds the *calls* together, and it passed for as long
// as `bodyBase64` and `form` existed on one side and not the other — a handler
// that could not say it was sending a file, against a host that would have
// accepted one.
test("both halves state the same request, member for member", () => {
  const rolled = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "types", "index.d.ts"),
    "utf8",
  );
  for (const shape of ["NetRequest", "NetPart"]) {
    assert.deepEqual(
      membersOf(declarations, shape),
      membersOf(rolled, shape),
      `\`${shape}\` says one thing to a handler and another to a screen`,
    );
  }
});

/**
 * The member names one interface declares, in order, from a `.d.ts`.
 *
 * By brace depth rather than by the first `}`, because a member's own doc
 * comment may contain one and the shapes here are flat only until they are not.
 */
function membersOf(declarations, name) {
  const opened = declarations.indexOf(`interface ${name} {`);
  assert.notEqual(opened, -1, `nothing declares \`${name}\``);
  let depth = 0;
  let closed = -1;
  for (let at = declarations.indexOf("{", opened); at < declarations.length; at += 1) {
    if (declarations[at] === "{") depth += 1;
    if (declarations[at] === "}") {
      depth -= 1;
      if (depth === 0) {
        closed = at;
        break;
      }
    }
  }
  assert.notEqual(closed, -1, `\`${name}\` is never closed`);
  return [
    ...declarations.slice(opened, closed).matchAll(/^\s+readonly (\w+)\??:/gm),
  ]
    .map((match) => match[1])
    .sort();
}

// A scan finds a name in the built module. `net.write` is not a name: the verb
// a request uses is computed, so a package that builds its method from a
// variable would pass a check the package writing "POST" fails. A check that
// catches one of two spellings is worse than no check, because it is read as
// one — Sync refuses the call either way.
test("the verb capability is deliberately not scanned for", () => {
  assert.ok(
    !SERVICE_CAPABILITIES.some(({ capability }) => capability === "net.write"),
    "net.write cannot be found by looking at a built module, and pretending otherwise is the failure",
  );
});
