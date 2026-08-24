# @sync-buzz/extension-api

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

## Installing it

```
npm install --save-dev @sync-buzz/extension-api
```

**ESM only**, and both halves of it are: the CLI is an ESM entry point, and the
declarations are published under an `exports` map with no CommonJS condition. A
project consuming it therefore needs either `"type": "module"` in its own
`package.json` or `"moduleResolution": "bundler"` in its `tsconfig.json` — the
second is what the extensions in the registry use, because an extension is
bundled by `sync-ext build` rather than resolved by Node.

There is deliberately **no runtime entry point**. Importing from this package
gives an extension the *shape* of what the window will hand it; the objects
themselves arrive at runtime, from the host, and `sync-ext build` marks the
package external and points it at them. A package that shipped its own copies
would be a second set of portals, focus traps and scroll locks in one window.

## The CLI

```
sync-ext build [folder…] [--watch]   the module Sync loads
sync-ext check [folder…]             the schema, the kind prefixes, and the module against its manifest
sync-ext pack  [folder…] [--out d]   the reproducible .syncext
```

One more is the registry's own rather than an author's, and it is here because
it reads manifests and one reader of a manifest is the point of there being a
schema:

```
sync-ext registry [folder…] --archives <dir> --base-url <url>
                            [--out registry.json] [--ledgers registry]
```

A folder is one extension: the directory holding its `manifest.json`. Several
may be named and naming none means the working directory, so a repository of
extensions passes them all and gets one line each.

`init` is deliberately absent. It scaffolds from a template, a template has to
reflect what actually works rather than what was intended, and that is only
knowable once something has been built with it.

### What `build` does to two imports

An author writes `import { useState } from "react"` and
`import { Button } from "@sync-buzz/extension-api"` — the point of the whole design
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

Everything an extension may import comes from `@sync-buzz/extension-api`, and there
is nothing else to import: it has no access to Sync's source, so an import that
reaches past the contract does not resolve. What it exports is a default
function, and one entry per area its manifest declared:

```tsx
import type { ActivationResult, ExtensionHost } from "@sync-buzz/extension-api";

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
that way is unsigned by construction and is marked *Development* on its card.

## Styling: yours to write, the window's to define

**You write Tailwind classes exactly as the application does, and they work.**
`sync-ext build` compiles the ones your own source uses into the stylesheet your
manifest names, and Sync adds it to the document when it loads your module:

```json
{ "ui": "ui/index.js", "styles": "ui/index.css" }
```

That file has to exist, and it has to be your own. **Sync's stylesheet does not
contain your classes and cannot.** Tailwind generates the classes it finds in
the source files it is told to read; the application's build reads the
application's own `src`, and your package is not in it. Before this existed,
every utility a package used that the shell did not happen to use as well
produced no rule at all — no error, no warning, nothing in any file to look at.
A section mounted, held its state and answered the keyboard, and was drawn
without a single one of its own margins. It reads as somebody having redesigned
your extension. It is an empty stylesheet.

### The one rule: refer to a token, never declare one

```css
/* Yes — the window says what --surface-panel is worth, and you use it. */
.my-panel { background: var(--color-panel); gap: calc(var(--spacing) * 2); }

/* No — sync-ext check refuses this, and so it should. */
:root { --surface-panel: #222; }
```

Every colour, step, radius, control height and duration is a variable the window
defines on `:root`. Your rules refer to them, so your package ships **no values
at all** — which is what lets somebody retint the whole application and see your
extension retint with it, without you rebuilding or republishing anything.

Declare one and you are not restyling your section; you are restyling every
column, sheet and menu in the application, because those variables are what all
of them read. That is the only thing `check` closes. What is yours:

- any Tailwind utility, including ones the shell has never used;
- any class of your own, and any variable under a name of your own;
- plain CSS — keyframes, media queries, `:has()`, a grid nobody anticipated.

### When you need something we have no component for

Write it. Put your CSS in `src/index.css`, which takes over the entry `sync-ext`
would otherwise generate — keep the import and add whatever you like under it:

```css
@import "@sync-buzz/extension-api/extension.css";
@source "./";

.timeline {
  display: grid;
  grid-template-columns: max-content 1fr;
  border-inline-start: 1px solid var(--separator);
}
@keyframes settle { from { opacity: 0 } to { opacity: 1 } }
```

`@source "./"` is what tells Tailwind to read your components for classes; if
you keep source outside `src`, add a line for it. The import brings two things
and neither carries a value: the theme Sync publishes — declared `@theme
inline`, so `bg-panel` compiles straight to `var(--surface-panel)` — and
Tailwind's utilities layer alone, without preflight, because a second reset in a
document that already has one restyles the window rather than your extension.

### Why a package carries this and not React

They look like the same question and are opposite answers. React must be the
window's single copy: two of them in one document and the first hook you call
throws, because the copy holding the dispatcher is not the copy being called.
Identity is the whole of it — and the same goes for the component library, whose
portals, focus traps and scroll locks must be one set.

A CSS utility has no identity. `.gap-1\.5` compiles to the same rule wherever it
is built, so two packages carrying it cost forty identical bytes each and can
never disagree about what it means. It is the same reason `lucide-react` is
bundled into your package rather than served by the host: a pure thing with
nothing to keep in step is cheaper copied than shared.

What must not be copied is the **design** — the values. Those stay in one place,
and you refer to them.
