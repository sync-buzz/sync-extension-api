# @sync/extension-api

The contract an extension for [Sync](https://sync.buzz) is written against, and
the tools that hold it to it.

**Contract, not implementation.** The components an extension draws with — the
panels, the source list, the record editor, the sheets — stay in the application
and arrive at runtime. A package carrying its own copies would be a second set
of portals, focus traps and scroll locks in one window, and "the same styles"
would quietly become "the same as of the last time both were published". What is
published here is the shape of them, and the tools that make a package which
expects the real ones.

```
types/index.d.ts             what an extension may name
runtime.json                 the surface's version, and which of its names exist at runtime
schema/manifest.schema.json  what a manifest may say
src/                         the sync-ext CLI
```

Two of those are generated from Sync's own surface by `pnpm api:publish` in that
repository, and committed here. Writing either by hand would make this package a
second description of the surface, going out of date at a different rate from
the first. The schema is written here, and is the exception on purpose: Sync's
manifest reader is the authority, and this is the same rules stated for
everything that is not Sync.

## The CLI

```
sync-ext build [folder…] [--watch]   the module Sync loads
sync-ext check [folder…]             the schema, the kind prefixes, and the module against its manifest
sync-ext pack  [folder…] [--out d]   the reproducible .syncext
```

A folder is one extension: the directory holding its `manifest.json`. Several
may be named and naming none means the working directory, so a repository of
extensions passes them all and gets one line each.

`init` is deliberately absent. It scaffolds from a template, a template has to
reflect what actually works rather than what was intended, and that is only
knowable once something has been built with it.

### What `build` does to two imports

An author writes `import { useState } from "react"` and
`import { Button } from "@sync/extension-api"` — the point of the whole design
is that an extension reads like the application it extends. Neither import can
be bundled, so both are replaced with shims that read an object Sync publishes
on the global *before* it fetches the module. That ordering is the mechanism:
imports are resolved while a module is being evaluated, and there is no way to
hand anything to a module during its own evaluation.

`lucide-react` is bundled normally, which is a deliberate exception to "one
copy". One copy matters where identity does — React because of the dispatcher,
the component library because of portals and focus traps. An icon is a pure SVG
component with neither.

### What `check` does that a type-checker cannot

It runs the module. `activate` is ordinary code, its return value is decided at
runtime, and the manifest is JSON — nothing in the type system relates the two,
so an area renamed in one and not the other type-checks perfectly and installs
as an empty column. Sync makes the same checks and refuses the package; the
value of making them here is *when*, in the terminal of the person who caused it
rather than in front of somebody opening a project.

## The version is the surface's

`2.0.0` here is `SYNC_API_VERSION` there, and there is nothing else it could
be: what this package publishes is that surface, and a second number beside the
first would be one more thing to keep in step. A manifest states the range it
was written for — `"engines": { "syncApi": "^2.0" }` — and Sync checks it before
executing a line of the package.

| Change to the surface | Bump |
| --- | --- |
| An export removed, renamed or narrowed; a field dropped from something returned | **major** |
| An export added; an optional field added; an accepted type widened | **minor** |
| Nothing in the surface changed | nothing |

## Writing one

Everything an extension may import comes from `@sync/extension-api`, and there
is nothing else to import: it has no access to Sync's source, so an import that
reaches past the contract does not resolve. What it exports is a default
function, and one entry per area its manifest declared:

```tsx
import type { ActivationResult, ExtensionHost } from "@sync/extension-api";

export default function activate({ id }: ExtensionHost): ActivationResult {
  return { memory: { Provider, Navigator, Workspace, Inspector } };
}
```

Which columns to return is decided by the frame the manifest declared —
`browse` has a navigator and an inspector, `list` a navigator, `detail` an
inspector, `single` neither. Returning one the frame does not have fails to
install rather than being quietly dropped: a panel that is empty because a
component was discarded without a word is an hour spent looking for the wrong
bug.

The loop while writing is *edit, reload, look*: `sync-ext build --watch`, and
Sync pointed at the folder through **Extensions → From folder…**. A package read
that way is unsigned by construction and is marked *Development* on its card and
beside its section in the sidebar.
