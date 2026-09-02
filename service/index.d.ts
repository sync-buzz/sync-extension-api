/**
 * What a handler may reach, and nothing else.
 *
 * This is the other half of `@sync-buzz/extension-api`. That one is the screen —
 * React components, panels, hooks — and none of it means anything without a
 * document. This one is functions over data, for the half of an extension that
 * runs with no screen mounted: `service/index.js`, called by the clock, by an
 * install, and later by another extension.
 *
 * **It is a different runtime, not a smaller one.** A handler is evaluated in
 * QuickJS embedded in Sync — not in Node, not in a webview. There is no `fetch`,
 * no `setTimeout`, no `TextDecoder`, no `Intl` and no `WebAssembly`. `console`
 * is there, and what it writes is the host's to place. Everything else arrives
 * through this surface, one function at a time and with a declared permission
 * behind it where it needs one.
 *
 * **Everything answers a promise, and one of them waits.** `net.fetch` sits
 * until the other end answers or the door's timeout stops it; the rest settle
 * by the time the job queue turns once, because they are synchronous inside
 * Sync. All of them are typed as promises regardless, so a member that comes to
 * wait later breaks nothing. Write `await`.
 *
 * The names are Sync's own: its host answers them, and it is the authority.
 * This file is a second statement of the same list, for the same reason the
 * manifest schema in this package is — where the two disagree, Sync is right
 * and this is behind. Asking for a name Sync does not answer is a refusal you
 * can catch, naming what is offered.
 */

/**
 * A record as the engine keeps it.
 *
 * Deliberately open. The members of an envelope are the engine's, they differ
 * by the type of the record, and a package may publish types of its own — so a
 * fixed shape here would be a second vocabulary going out of date at its own
 * rate. `sync_project` and `memory_list_types` are where the shape of a kind is
 * answered.
 */
export interface Envelope {
  readonly [member: string]: unknown;
}

/** One record as of a revision. `record` is `null` when the key is not there. */
export interface RecordView {
  readonly revision: string;
  readonly record: Envelope | null;
}

/**
 * A page of records, plus counts over everything the filters selected.
 *
 * `has_more` is spelled as the engine spells it. It crosses this boundary as
 * JSON and nothing renames it on the way, so a camel-cased reading of it is
 * `undefined` — which is the shape of bug that costs an afternoon.
 */
export interface Listing {
  readonly revision: string;
  readonly records: readonly Envelope[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
  readonly has_more: boolean;
  readonly counts: { readonly [member: string]: unknown };
}

/** What a record's body turned out to be, and whether there was one. */
export interface ContentView {
  /** `record` when the body is the record's own, `file` when it is a document. */
  readonly source: string;
  /** `null` when there was nothing to read. An empty string is a body somebody wrote. */
  readonly content: string | null;
  readonly missing: boolean;
  /** Why it is not here, in the engine's words: `not_on_branch` or `removed`. */
  readonly reason: string | null;
}

/**
 * What to list, in the engine's own vocabulary.
 *
 * Not restated here, and that is deliberate: the schema belongs to the engine,
 * it moves with it, and a copy in this package would be a copy to drift — the
 * same reason Sync's MCP server hands the engine's own schemas on rather than
 * describing them again. `memory_list_records` is where they are published.
 */
export interface RecordQuery {
  readonly [field: string]: unknown;
}

/** The project's memory, as a handler is allowed to see it: reading only. */
export declare const memory: {
  /** One record by key. */
  record(key: string): Promise<RecordView>;
  /** A page of records. */
  list(query?: RecordQuery): Promise<Listing>;
  /** A record's body, whether it is the record's own or a document. */
  content(key: string): Promise<ContentView>;
};

/**
 * What to do with work a shutdown interrupted.
 *
 * **Yours to decide, when you order it.** A nightly poll should finish without
 * anybody there; a conversation somebody started is theirs to pick up. The two
 * genuinely differ and no default is right for both, so there is no default and
 * this is required.
 */
export type OnInterrupted = "continue" | "wait";

/**
 * What the agent is to be asked.
 *
 * `text` is the message. `attachments` are **absolute paths**, and they cross to
 * the agent as resource links rather than as bytes: Sync never opens the file,
 * it names one, and the agent — already running in the project's own folder —
 * opens it itself. A scheduled handler is handed its project's path, which is
 * what an absolute path is built from.
 *
 * There are no images here, and that is not an omission. A handler has no
 * clipboard and no filesystem, so there is no way for one to be holding a
 * picture; the window's own prompt carries them.
 */
/**
 * The record a piece of work is about, as a heading can draw it.
 *
 * Three members and each is load-bearing: the key is what the list groups by
 * and what names the slot `keep: "latest"` replaces in, the kind is what
 * opening the record takes beside it, and the title is what the heading says.
 * The title is a snapshot — what the record was called when the work was
 * ordered — so a heading is drawn without reading the corpus for every row.
 */
export interface WorkAbout {
  readonly key: string;
  readonly kind: string;
  readonly title: string;
}

export interface WorkPrompt {
  readonly text: string;
  readonly attachments?: readonly string[];
}

/** What to order. */
export interface WorkOrder {
  /**
   * What kind of work. `"agent.session"` is the only one this build performs,
   * and a second arrives with a second executor rather than before it.
   */
  readonly kind: "agent.session";
  /** Which agent to raise, as Sync names them: `claude`, `codex`, `gemini`, … */
  readonly agent: string;
  /**
   * What to call the conversation, in the list a person reads.
   *
   * **Required, and nothing else can supply it.** Without one the title is
   * derived from the first words said — which your handler wrote, to an agent.
   * A sentence written *for an agent* standing in for a sentence written *for a
   * list* reads exactly like something a person typed, which is the one thing
   * that list must not say.
   *
   * A name, not a lock: somebody who does not like it can rename it.
   */
  readonly title: string;
  readonly prompt: WorkPrompt;
  readonly onInterrupted: OnInterrupted;
  /**
   * What the work is about, when it is about a record.
   *
   * Name it in full where you can. Chat groups its list by this, and a heading
   * is a name rather than an address: a key alone says which slot the work
   * belongs to and nothing a person can read or open, so a conversation ordered
   * with one carries no heading and sits with the ones about nothing in
   * particular. The kind travels with the key because opening a record takes
   * both — which section shows one is decided by its type.
   *
   * The bare key is the older spelling and is still accepted, so a handler
   * written before this goes on working unchanged.
   */
  readonly about?: string | WorkAbout;
  /**
   * How many of the conversations this order produces are kept.
   *
   * Absent is `"each"`, which is what every package built before this existed
   * already does: every run is its own conversation.
   *
   * `"latest"` is **one conversation about this record at a time** — the run
   * that starts replaces the one before it. A handler on a fifteen-minute clock
   * orders ninety-six times a day, and a project keeps a hundred conversation
   * pointers, so within a day one standing instruction has pushed out every
   * conversation its owner held themselves. Say `"latest"` when your work is
   * *the same thing, done again*, and `"each"` when each run is its own piece
   * of work somebody may want to go back to.
   *
   * It **requires `about`**: the slot is the record, and keeping the latest of
   * nothing is not a thing to ask for. Ordering `"latest"` without one is a
   * refusal you can catch.
   *
   * Two things it does not do, and both are deliberate. It does not touch a
   * conversation somebody kept as a record — that is a decision a person made
   * about it, and it outranks your arrangement of your own rows. And it takes
   * the previous run away only *after* the new one has started, so an agent
   * that will not rise leaves the last readable account standing rather than
   * clearing the slot and putting nothing in it.
   */
  readonly keep?: "each" | "latest";
  /**
   * The conversation this work is being delegated from, by the agent's own id
   * for it — `acpSession` on a `SessionRow` or on a remembered conversation.
   *
   * Absent is the ordinary answer, and it is what work on a clock says: a
   * routine comes out of nothing. Give it when you are ordering on an agent's
   * behalf, and three things follow.
   *
   * **What the work is about, and who ordered it, stop being yours to state.**
   * Both are read from the conversation you name. That is what keeps a heading
   * unforgeable: you may say what the work was delegated *from* and cannot say
   * what to file the result under, so an agent reaching this through your tool
   * cannot move its own work into somebody else's group.
   *
   * **One at a time.** A conversation has one delegated run under it, and the
   * next one's first turn waits — the work is carried out in that
   * conversation's own working tree, and two agents at once are two agents in
   * one set of files. A conversation that is waiting says `"queued"`.
   *
   * **The answer goes back on its own.** Whatever the agent says last in that
   * first turn is handed to the conversation you named, as an ordinary turn,
   * once it is up and not busy — nothing is raised to be told, and there is
   * nothing to poll. Sync tells the agent so, in the prompt, so you do not have
   * to.
   *
   * A chain is two conversations deep. Naming one that was itself delegated is
   * a refusal you can catch, as is naming one this project does not hold.
   */
  readonly parent?: string;
}

/**
 * Ordering work that outlives the handler that ordered it.
 *
 * **A handler orders; Sync performs.** Your handler runs for milliseconds and
 * the agent it asks for may run for hours, so this answers a key as soon as the
 * order is written down — before the agent has been raised, and long before it
 * has finished. Nothing here waits for the work.
 *
 * The key names the order, not the conversation: a conversation does not exist
 * yet when you are handed it, and may never exist if the agent will not start.
 *
 * **Keep it.** It comes back on every session this order produced, as
 * `source.work` on a `SessionRow` — which is how your own screen says "task 42
 * is running" rather than "three things are running", and how anything that
 * offers to take somebody back to your screen knows what to open.
 *
 * Ordering work **spends somebody's tokens while they are asleep**, so the
 * package's manifest has to ask for the `"work.agent"` capability and a person
 * has to have agreed to it before installing. Without it this refuses, and the
 * refusal is one you can catch.
 *
 * ```ts
 * const key = await work.order({
 *   kind: "agent.session",
 *   agent: "claude",
 *   title: "Summarising today's notes",
 *   prompt: { text: "Read today's notes and summarise them." },
 *   onInterrupted: "continue",
 * })
 * ```
 */
export declare const work: {
  order(order: WorkOrder): Promise<string>;
};

/**
 * The package's own secrets, in its own namespace.
 *
 * **Behind the `"vault"` capability**, which a person is shown on the card
 * before they install anything. Reading and writing are one agreement rather
 * than two, because the flow that needs either needs both: a package that signs
 * somebody in ends up holding a token nobody could have typed, and refreshes it
 * before it expires.
 *
 * The namespace is yours and there is nothing to pass that would leave it. You
 * supply a name; the owner is the id Sync resolved your package under, joined
 * on Sync's side. A name that looks like a way out — a path, another package's
 * id — is a name, and what it addresses is an oddly-named entry of your own.
 *
 * **Do not hand a value to an agent.** Not through a tool that returns it, not
 * in text you write into a record, not in a prompt. Sync does not build that
 * door and this is the reason it does not: the way to let an agent act on a
 * secret is to offer it a tool that *does the work* — signs the request, calls
 * the API — and answers with the result. You can write the other thing; the
 * recommendation against it is here so that writing it is a decision.
 *
 * **The safer path is to never hold one.** `net.secrets` in your manifest names
 * an entry and the host puts it into a header your handler never sees. Use this
 * when the secret goes somewhere a header cannot take it — a signature, an
 * assertion, an exchange — or when you have just been handed one to store.
 *
 * A value read here is kept out of the host's log for the length of the call,
 * so a `console.log` that would have printed it prints that something was taken
 * out instead. That is one accident closed, not secrecy from your own code.
 */
export declare const vault: {
  /** The secret stored under that name. Rejects when there is none. */
  read(name: string): Promise<string>;
  /** Store one, or replace what is there. */
  write(name: string, secret: string): Promise<void>;
  /** Take one out. Signing somebody out is something a package can finish. */
  forget(name: string): Promise<void>;
};

/** The verbs a request may use. Anything past `GET` needs `"net.write"`. */
export type Method = "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE";

/**
 * One request, as your package states it.
 *
 * `fetch`'s vocabulary narrowed to what crosses into Sync, and **unknown
 * members are refused rather than dropped**: `signal`, `credentials`, `mode`,
 * `cache` and `redirect` are not here, and asking for one is a sentence you can
 * act on rather than a setting you believe you made.
 *
 * Headers are a map rather than a list of pairs — a package sending one name
 * twice is saying something confused, and this makes it unsayable.
 */
export interface NetRequest {
  readonly url: string;
  /** `GET` when you do not say, which is what `fetch` does. */
  readonly method?: Method;
  /**
   * Header names and values, as you write them.
   *
   * `content-type` is refused for a request sending `form`, and only for that
   * one: the boundary is written where the parts are assembled, so a type you
   * set yourself would describe a different request from the one that goes out.
   */
  readonly headers?: { readonly [name: string]: string };
  /**
   * What you send, when it is text.
   *
   * **One of three, and a request carries one of them.** This is the spelling
   * that was here first and it means text: a picture put in it goes out as the
   * base64 you wrote it as, which is nothing any server asked for. Saying two
   * of the three is refused rather than resolved for you.
   */
  readonly body?: string;
  /**
   * What you send, when it is bytes: a picture, a signature, an archive.
   *
   * Base64, because this crosses a process boundary as JSON and JSON has no
   * bytes. The encoding is undone before the request leaves, so what the server
   * receives is the bytes — and what belongs here is the encoding on its own. A
   * `data:` URL pasted whole is refused, which is the mistake this member
   * attracts.
   */
  readonly bodyBase64?: string;
  /**
   * What you send, when the other end asked for a `multipart/form-data` form.
   *
   * The shape almost every *upload a file* API is written against, and the one
   * thing on this door you could not have composed for yourself: the boundary
   * lives in a header and repeats between the parts, so the body and the header
   * have to be written by the same code or they describe different requests.
   */
  readonly form?: readonly NetPart[];
}

/**
 * One part of a form.
 *
 * **A part is one thing.** `text` or `base64`, never both and never neither:
 * two values is a handler that has not decided what it is sending, and none is
 * a name the other end is handed with nothing under it. Both are refused by the
 * part's own name, because a form has several and a refusal about an unnamed
 * one cannot be acted on.
 *
 * `filename` is what makes a part a file rather than a field, and `contentType`
 * is what the bytes are. Both are yours to say: what a picture is called and
 * what it is are known where it came from, and nowhere after.
 */
export interface NetPart {
  /** What the other end looks this part up by. */
  readonly name: string;
  readonly text?: string;
  readonly base64?: string;
  readonly filename?: string;
  readonly contentType?: string;
}

/**
 * What came back.
 *
 * A `404` is an answer to a question you asked and it arrives as one: the door
 * does not turn a status into a failure, because *that repository has no
 * issues* reads nothing like *the network is down*. What rejects is a request
 * that could not be made or was not allowed.
 *
 * No `statusText`: HTTP/2 carries no reason phrase, so it would be a member
 * that is sometimes there — worse than one that never is.
 */
export interface NetResponse {
  /**
   * Where the response actually came from, after any redirect.
   *
   * Build your next request from this rather than from what you asked for, or
   * you will keep being redirected.
   */
  readonly url: string;
  readonly status: number;
  /** Whether the status is one of the successful ones, as `fetch` derives it. */
  readonly ok: boolean;
  /** Names in lower case; a name the server repeated arrives joined by `, `. */
  readonly headers: { readonly [name: string]: string };
  readonly body: string;
}

/**
 * Reaching a host your manifest named.
 *
 * **Behind the `"net"` capability, and the hosts you listed are the whole of
 * what you may reach.** The list is checked in Rust before anything leaves the
 * machine and again on every redirect, so a host you did not name is a
 * rejection rather than a request. A verb that changes something there —
 * anything past `GET` and `HEAD` — needs `"net.write"` as well: reading
 * somebody's tracker and filing in it are two different agreements.
 *
 * **This one genuinely waits.** Everything else on this surface settles on the
 * first turn of the job queue; this sits until the answer arrives or the door's
 * own timeout stops it, and the wait is not charged against the handler's time
 * limit. Write `await` and expect it to mean something.
 *
 * ```ts
 * const answer = await net.fetch({ url: "https://api.example.com/things" })
 * if (!answer.ok) throw new Error(`the API said ${answer.status}`)
 * const things = JSON.parse(answer.body)
 * ```
 */
export declare const net: {
  fetch(request: NetRequest): Promise<NetResponse>;
};

/**
 * One handler: what the host calls, and what it answers.
 *
 * It may be `async`, and Sync settles the promise before taking the answer. A
 * promise nothing can settle — one awaiting a timer, of which there are none —
 * is a refusal naming that, rather than a call that hangs.
 */
export type Handler = (payload: any) => unknown;

/** What `register()` answers with: the handlers this package declares. */
export type Handlers = Record<string, Handler>;
