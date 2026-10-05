/**
 * Builds the index the application reads, and the ledger each extension keeps.
 *
 * **Two files, because they answer two questions asked at two moments.**
 *
 * `registry.json` is the whole marketplace, and the window reads it to draw
 * cards and to search. That is the whole of the search: one file, fetched with
 * an ETag and cached, so opening the catalogue usually costs a 304 — no GitHub
 * API, therefore no rate limit and no token. It carries what a *card* says and
 * what a search matches on, and it carries the latest version's artefact, so
 * installing from a card is not a second round trip to find out where the file
 * is.
 *
 * `registry/<id>.json` is one extension's ledger: every version ever published,
 * with its `syncApi` range, its artefact, its description and its changelog. It
 * is read when a page is opened, which is also when a person is deciding, and
 * it is what a downgrade reads — a project pinned to an older version because
 * the newer one needs a Sync this machine does not have is the case that makes
 * older versions worth keeping at all.
 *
 * Splitting them is what keeps the index small as the registry grows. A
 * description is a paragraph and a changelog is a history; carried per version
 * in one file, the thing every window fetches on every launch would grow with
 * everything anyone had ever published.
 *
 * **Nobody edits either by hand.** The index is generated from the manifests
 * and the ledger is appended to from the same source, so the registry cannot
 * come to disagree with the packages it indexes. The one thing that is not
 * derived is the changelog, which is prose somebody writes: it is read from the
 * extension's own `CHANGELOG.md`, by version heading.
 *
 * The ledger is **read and appended to**, never rebuilt: versions that are
 * already published are facts about what people have installed, and a
 * regenerated ledger that dropped one would strand every project pinned to it.
 * Republishing a version that is already there is refused rather than
 * overwritten — a released artefact is immutable, and the integrity in a
 * project's record is what would notice.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

import { manifestOf } from "./contract.mjs";

/**
 * The format the window reads. Bumped when the shape changes incompatibly.
 *
 * Format 2 made `artefact`, `version` and `syncApi` optional and added
 * `transport`, so an entry can name an **MCP server** rather than a package
 * anybody downloads: what such an entry is, is a way to reach a server plus what
 * a card says about it. A build that reads only format 1 cannot parse an entry
 * with no artefact, so the number is what tells it to refuse rather than fail
 * halfway. `SUPPORTED_REGISTRY_FORMAT` in Sync's `sync-extensions` crate is the
 * other half of it.
 */
export const REGISTRY_FORMAT = 2;

/**
 * What a card says and what a search matches on, and nothing else.
 *
 * Every field here is either drawn on a card or searched. `description` is
 * neither — it is the page, and the page fetches the ledger — so it is not in
 * the index however tempting it is to have everything in one place.
 */
function indexed(folder, manifest, artefact) {
  return {
    id: manifest.id,
    name: manifest.name,
    summary: manifest.summary ?? "",
    icon: manifest.icon ?? null,
    version: manifest.version,
    // What a build has to be able to do before this is worth offering, and the
    // two things a card refuses with: *needs a newer Sync*, and *this build
    // cannot do what it asks for*. Both are answerable without downloading it.
    syncApi: manifest.engines.syncApi,
    capabilities: manifest.capabilities ?? [],
    requires: manifest.requires?.extensions ?? [],
    // What a project would be agreeing to, at the length a card has room for.
    // The kinds are here rather than counted because they are what somebody
    // searching for "decision" is looking for.
    publishes: kindsOf(folder, manifest),
    areas: (manifest.areas ?? []).map((area) => ({ id: area.id, label: area.label })),
    // Whether it says anything to an agent at all. What it says is the package's
    // own file and arrives with it.
    prompt: manifest.prompt !== undefined,
    npm: manifest.dependencies?.npm ?? [],
    author: manifest.author ?? null,
    license: manifest.license ?? null,
    repository: manifest.repository ?? null,
    artefact,
  };
}

/**
 * The kinds a package publishes, read out of the type files it names.
 *
 * Read rather than derived from the id, because a kind is what its definition
 * says it is; the prefix rule makes them all begin with the id and says nothing
 * about the rest.
 */
function kindsOf(folder, manifest) {
  return (manifest.types ?? [])
    .map((path) => {
      const at = join(folder, path);
      if (!existsSync(at)) return null;
      return JSON.parse(readFileSync(at, "utf8")).kind ?? null;
    })
    .filter((kind) => kind !== null);
}

/**
 * Where an artefact can be fetched from, and what it must hash to.
 *
 * The digest is taken from the file rather than passed in, so the index cannot
 * name a hash the artefact does not have. The URL is composed from a base and
 * the file's own name: what the base is depends on where the release went, and
 * that is the release's business rather than this file's.
 */
function artefactOf(archive, baseUrl) {
  const bytes = readFileSync(archive);
  return {
    url: `${baseUrl.replace(/\/$/, "")}/${basename(archive)}`,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    bytes: bytes.length,
  };
}

/** The `.syncext` built for this exact id and version, or `null`. */
function archiveFor(manifest, from) {
  if (!existsSync(from)) return null;
  const wanted = `${manifest.id}-${manifest.version}.syncext`;
  const found = readdirSync(from).find((name) => name === wanted);
  return found === undefined ? null : join(from, found);
}

/**
 * What somebody wrote about this version, from the extension's own changelog.
 *
 * Read by heading rather than parsed: a `## 1.2.0` line and everything under it
 * until the next heading. A version with no entry gets none — an empty string
 * rather than an invented sentence, because a changelog nobody wrote is not a
 * changelog and a card that made one up would be worse than a card that had
 * nothing to show.
 */
function changelogFor(folder, version) {
  const at = join(folder, "CHANGELOG.md");
  if (!existsSync(at)) return "";
  const lines = readFileSync(at, "utf8").split("\n");
  const from = lines.findIndex((line) => /^#{1,3}\s/.test(line) && line.includes(version));
  if (from === -1) return "";
  const rest = lines.slice(from + 1);
  const to = rest.findIndex((line) => /^#{1,3}\s/.test(line));
  return (to === -1 ? rest : rest.slice(0, to)).join("\n").trim();
}

/**
 * Adds this version to an extension's ledger, and answers with the whole of it.
 *
 * @throws When the version is already published with different bytes. A
 *   released artefact is immutable: re-tagging one under a version somebody has
 *   already installed is what `integrity` in a project's record exists to
 *   notice, and letting the ledger say otherwise would make that check compare
 *   against a lie.
 */
function ledgerFor(folder, manifest, artefact, ledgers) {
  const at = join(ledgers, `${manifest.id}.json`);
  const held = existsSync(at)
    ? JSON.parse(readFileSync(at, "utf8"))
    : { formatVersion: REGISTRY_FORMAT, id: manifest.id, versions: [] };

  const already = held.versions.find((one) => one.version === manifest.version);
  if (already !== undefined && already.artefact.sha256 !== artefact.sha256) {
    throw new Error(
      `${manifest.id} ${manifest.version} is already published, and this build of it is a different file. ` +
        "A released version is immutable — publish a new version instead.",
    );
  }

  const entry = {
    version: manifest.version,
    syncApi: manifest.engines.syncApi,
    description: manifest.description ?? "",
    changelog: changelogFor(folder, manifest.version),
    artefact,
  };

  held.versions = [
    entry,
    ...held.versions.filter((one) => one.version !== manifest.version),
  ];
  return { at, ledger: held };
}

/**
 * The entries that are not packages: one file per MCP server, written by hand.
 *
 * They are read rather than derived, and that is the whole reason this exists.
 * An MCP server is somebody else's program — there is no manifest of ours to
 * generate a card from, and nothing to pack — so the card is prose somebody
 * wrote, kept as a file per server so that adding one is a file rather than a
 * line in a generated index. Before this, such entries survived only inside
 * `registry.json`, which this function overwrites: the next release of any
 * package silently dropped the whole catalogue.
 *
 * What is checked is what the window cannot do without: an id, a name, and a way
 * to reach the server. An `artefact` is refused rather than ignored — an entry
 * with one is a package, and a package belongs to a folder with a manifest,
 * where its version and its archive can be checked against each other.
 */
function serversFrom(dir) {
  if (dir === null || !existsSync(dir)) return [];

  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => {
      const at = join(dir, name);
      const entry = JSON.parse(readFileSync(at, "utf8"));
      for (const required of ["id", "name"]) {
        if (typeof entry[required] !== "string" || entry[required] === "") {
          throw new Error(`${at} has no ${required}`);
        }
      }
      if (entry.transport === undefined) {
        throw new Error(`${at} names no transport, so nothing could reach it`);
      }
      if (entry.artefact !== undefined) {
        throw new Error(
          `${at} carries an artefact, which makes it a package rather than a server: give it a folder with a manifest instead`,
        );
      }
      if (basename(name, ".json") !== entry.id) {
        throw new Error(`${at} is the descriptor of ${entry.id}, so it is named wrongly`);
      }
      return entry;
    });
}

/**
 * Builds the index and the ledgers from a set of extension folders.
 *
 * @param folders Each one an extension's own directory.
 * @param options.archives Where `sync-ext pack` put the `.syncext` files.
 * @param options.baseUrl What those archives are served from.
 * @param options.out Where `registry.json` goes.
 * @param options.ledgers Where `<id>.json` goes, one per extension.
 * @param options.servers Where the hand-written server descriptors are, if any.
 * @returns What was written, for the caller to report.
 */
export function registry(folders, { archives, baseUrl, out, ledgers, servers = null }) {
  const entries = [];
  const pending = [];

  // Everything is read and decided before anything is written. A refusal on the
  // third extension would otherwise leave the first two's ledgers on disk
  // claiming a release that did not happen — and a ledger is the one file here
  // whose whole job is to be believed about what exists.
  for (const folder of folders) {
    const manifest = manifestOf(folder);
    const archive = archiveFor(manifest, archives);
    if (archive === null) {
      throw new Error(
        `${manifest.id} ${manifest.version} has no archive in ${archives}. Run sync-ext pack first.`,
      );
    }

    const artefact = artefactOf(archive, baseUrl);
    entries.push(indexed(folder, manifest, artefact));
    pending.push({
      id: manifest.id,
      version: manifest.version,
      artefact,
      ...ledgerFor(folder, manifest, artefact, ledgers),
    });
  }

  // The catalogue's own entries, beside the packages and in the same list: the
  // window reads one index, and what a card is drawn from is the entry rather
  // than which half of the file it came from.
  const described = serversFrom(servers);
  const packaged = new Set(entries.map((one) => one.id));
  for (const server of described) {
    if (packaged.has(server.id)) {
      throw new Error(
        `${server.id} is both a package here and a server descriptor, and one id is one card`,
      );
    }
    entries.push(server);
  }

  // Sorted by id rather than by whatever order the folders were named in, so
  // that the same set of extensions produces the same file — an index that
  // reshuffled itself would show a diff on every release and hide the one line
  // that changed.
  entries.sort((one, two) => one.id.localeCompare(two.id));

  mkdirSync(ledgers, { recursive: true });
  for (const one of pending) {
    writeFileSync(one.at, `${JSON.stringify(one.ledger, null, 2)}\n`);
  }

  const index = { formatVersion: REGISTRY_FORMAT, extensions: entries };
  writeFileSync(out, `${JSON.stringify(index, null, 2)}\n`);

  return { index, out, written: pending, described };
}
