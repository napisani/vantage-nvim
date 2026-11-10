// The extension's behavior with Pi behind a port: client actions in, events and
// agent messages out, reply tools validated and applied. index.ts wires Pi to it.
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import type { AnnotateRequest, ClientAction } from "./actions.ts";
import * as messages from "./messages.ts";
import type { ServerMessage } from "./protocol.ts";
import {
  changeOf,
  isOpen,
  prefixOf,
  ReviewError,
  threadOf,
  undeliveredFor,
  type ChangeRequest,
  type CodeRef,
  type Iso,
  type RequestUpdate,
  type ReviewEvent,
  type ReviewState,
  type Thread,
  type ThreadId,
  type ThreadKind,
  type Tour,
  type TourRequest,
  type TourStop,
} from "./state.ts";
import { Store } from "./store.ts";

export const MESSAGE_TYPE = "vantage";

const DetailsSchema = Type.Object({
  messageId: Type.Optional(Type.String()),
  ids: Type.Array(Type.String()),
  annotateId: Type.Optional(Type.String()),
});
/** Rides on every agent message so delivery and withdrawal can be traced back to threads. */
export type VantageDetails = Static<typeof DetailsSchema>;

/** What an accepted action reports back to the client that sent it. */
export interface ActionResult {
  threadId?: ThreadId;
  annotateId?: `A${number}`;
}

/** Everything the review needs from Pi; tests supply a fake. */
export interface PiPort {
  /** Starts a turn when idle; queued after the current run otherwise. */
  sendMessage(content: string, details: VantageDetails): void;
  /** Seen on the agent's next turn without starting one. */
  inform(content: string, details: VantageDetails): void;
  appendEntry(event: ReviewEvent): void;
  /** Switches on the reply tools that only make sense once Vantage has asked something. */
  activateTools(): void;
  session(): { id: string; name?: string };
  skills(): { name: string; description?: string }[];
  now(): Iso;
  /** Runs git in the workspace and returns trimmed stdout; rejects on failure. */
  git(args: string[]): Promise<string>;
}

export interface Client {
  send(message: ServerMessage): void;
}

interface PendingAnnotate {
  id: `A${number}`;
  client: Client;
  request: AnnotateRequest;
  /** The agent has seen the message, so cancelling needs a notice rather than a rewrite. */
  delivered: boolean;
}

/** A custom message as Pi hands it to a `context` handler. */
export interface ContextMessage {
  role: string;
  customType?: string;
  content?: unknown;
  details?: unknown;
}

/** A tour stop as the agent sends it; the side defaults to current code. */
type StopInput = { ref: CodeRef & { side?: "current" | "base" }; title: string; note: string };

const SAFE_PATH = /^(?!\/)(?!.*(^|\/)\.\.?(\/|$))[^\0\n\\]+$/;

function checkRef(ref: CodeRef, label: string): void {
  if (!SAFE_PATH.test(ref.path)) {
    throw new ReviewError("invalid", `${label}: path must be workspace-relative without . or .. segments`);
  }
  if (ref.endLine < ref.startLine) {
    throw new ReviewError("invalid", `${label}: endLine is before startLine`);
  }
}

/** The Vantage details on a transcript message, or undefined for every other message. */
export function detailsOf(message: ContextMessage): VantageDetails | undefined {
  if (message.role !== "custom" || message.customType !== MESSAGE_TYPE) {
    return undefined;
  }
  const { details } = message;
  return Value.Check(DetailsSchema, details) ? details : undefined;
}

export class Review {
  readonly store: Store;
  readonly #port: PiPort;
  readonly #clients = new Set<Client>();
  readonly #annotations = new Map<string, PendingAnnotate>();
  /** Annotate requests the user dropped: withdrawn messages are rewritten in context, and a late reply is refused. */
  readonly #closedAnnotates = new Map<string, "withdrawn" | "cancelled">();
  #nextAnnotate = 1;
  #activated = false;

  constructor(port: PiPort, initial: ReviewState) {
    this.#port = port;
    this.store = new Store({ persist: (event) => port.appendEntry(event), broadcast: (state) => this.#broadcast({ kind: "state", state }) }, initial);
    if (initial.threads.length) {
      this.#activate();
    }
  }

  get state(): ReviewState {
    return this.store.state;
  }

  addClient(client: Client): void {
    this.#clients.add(client);
    client.send({ kind: "state", state: this.state });
  }

  #broadcast(message: ServerMessage): void {
    for (const client of this.#clients) {
      client.send(message);
    }
  }

  #activate(): void {
    if (!this.#activated) {
      this.#activated = true;
      this.#port.activateTools();
    }
  }

  #messageId(): string {
    return `m${this.state.nextId.message}`;
  }

  #newId(kind: ThreadKind): ThreadId {
    const prefix = prefixOf(kind);
    return `${prefix}${this.state.nextId[prefix]}`;
  }

  /** Dispatches the events plus a queued-message record, then wakes the agent with the text built from the new state. */
  #send(events: ReviewEvent[], ids: ThreadId[], build: (state: ReviewState) => string): void {
    const messageId = this.#messageId();
    const state = this.store.dispatch(...events, { type: "message.queued", messageId, ids });
    this.#activate();
    this.#port.sendMessage(build(state), { messageId, ids });
  }

  #messageFor(thread: Thread): (state: ReviewState) => string {
    return (state) => {
      const current = threadOf(state, thread.id);
      if (current.kind === "question") {
        return messages.question(state, current);
      }
      if (current.kind === "change") {
        return messages.round(state, current.round ?? state.round, [current]);
      }
      return current.kind === "walkthrough" ? messages.walkthrough(state, current) : messages.diffTour(state, current);
    };
  }

  /** Runs one client action. Returns what the ack carries; throws ReviewError for a rejected action. */
  handleAction(client: Client, action: ClientAction): ActionResult {
    const at = this.#port.now();
    switch (action.type) {
      case "ask":
      case "walkthrough":
      case "diffTour":
        return { threadId: this.#create(action, at) };
      case "request":
        return { threadId: this.#request(action, at) };
      case "edit":
        this.store.dispatch({ type: "thread.edited", id: this.#id(action.threadId), text: action.text, at });
        return {};
      case "delete":
        this.store.dispatch({ type: "thread.deleted", id: this.#id(action.threadId) });
        return {};
      case "followUp":
        this.#followUp(action.threadId, action.text, action.lens, at);
        return { threadId: this.#id(action.threadId) };
      case "sendRound":
        this.#sendRound(at);
        return {};
      case "recallRound":
        this.#recall(at);
        return {};
      case "cancel":
        this.#cancel(this.#id(action.threadId), at);
        return {};
      case "resolve":
        this.store.dispatch({ type: "thread.resolved", id: this.#id(action.threadId), resolved: action.resolved, at });
        return {};
      case "clearResolved":
        this.store.dispatch({ type: "threads.clearResolved", at });
        return {};
      case "clearTours":
        this.store.dispatch({ type: "tours.cleared", kind: action.kind, at });
        return {};
      case "setBase":
        this.store.dispatch({ type: "base.set", base: action.base, at });
        return {};
      case "clearBase":
        this.store.dispatch({ type: "base.cleared", at });
        return {};
      case "annotate":
        return { annotateId: this.#annotate(client, action.request) };
      case "cancelAnnotate":
        this.#cancelAnnotate(action.annotateId);
        return {};
    }
  }

  #id(id: string): ThreadId {
    return threadOf(this.state, id).id;
  }

  #create(action: Extract<ClientAction, { type: "ask" | "walkthrough" | "diffTour" }>, at: Iso): ThreadId {
    const kind = action.type === "ask" ? "question" : action.type;
    const id = this.#newId(kind);
    const base = { id, messages: [{ role: "user" as const, text: action.text, at }], lens: action.lens, resolved: false, createdAt: at, updatedAt: at };
    let thread: Thread;
    if (action.type === "ask") {
      thread = { ...base, kind: "question", status: "sent", anchor: action.anchor, preset: action.preset };
    } else if (action.type === "walkthrough") {
      thread = { ...base, kind: "walkthrough", status: "sent", anchor: action.anchor };
    } else {
      thread = { ...base, kind: "diffTour", status: "sent", comparison: { base: action.base, target: action.target } };
    }
    this.#send([{ type: "thread.created", thread, at }], [id], this.#messageFor(thread));
    return id;
  }

  #request(action: Extract<ClientAction, { type: "request" }>, at: Iso): ThreadId {
    const id = this.#newId("change");
    const thread: ChangeRequest = {
      id,
      kind: "change",
      status: "pending",
      anchor: action.anchor,
      messages: [{ role: "user", text: action.text, at }],
      lens: action.lens,
      resolved: false,
      createdAt: at,
      updatedAt: at,
    };
    const created: ReviewEvent = { type: "thread.created", thread, at };
    if (!action.sendNow) {
      this.store.dispatch(created);
      return id;
    }
    const number = this.state.round + 1;
    this.#send([created, { type: "round.sent", round: number, ids: [id], at }], [id], (state) => messages.round(state, number, [changeOf(state, id)]));
    return id;
  }

  #followUp(threadId: string, text: string, lens: string | undefined, at: Iso): void {
    const thread = threadOf(this.state, threadId);
    const event: ReviewEvent = { type: "thread.followUp", id: thread.id, text, lens, at };
    if (thread.kind === "change") {
      this.store.dispatch(event);
      return;
    }
    this.#send([event], [thread.id], this.#messageFor(thread));
  }

  #sendRound(at: Iso): void {
    const pending = this.state.threads.filter((t): t is ChangeRequest => t.kind === "change" && t.status === "pending");
    if (!pending.length) {
      throw new ReviewError("invalid", "no pending change requests to send");
    }
    const ids = pending.map((t) => t.id);
    const number = this.state.round + 1;
    this.#send([{ type: "round.sent", round: number, ids, at }], ids, (state) =>
      messages.round(
        state,
        number,
        ids.map((id) => changeOf(state, id)),
      ),
    );
  }

  #recall(at: Iso): void {
    const sent = this.state.threads.filter((t): t is ChangeRequest => t.kind === "change" && isOpen(t));
    if (!sent.length) {
      throw new ReviewError("invalid", "no sent change requests to recall");
    }
    const working = sent.filter((t) => t.status === "working").map((t) => t.id);
    if (working.length) {
      throw new ReviewError("busy-recall", `the agent already started ${working.join(", ")}; cancel instead`);
    }
    const ids = sent.map((t) => t.id);
    this.store.dispatch({ type: "round.recalled", ids, at }, ...this.#withdrawals(ids));
  }

  #withdrawals(ids: ThreadId[]): ReviewEvent[] {
    const byMessage = new Map<string, ThreadId[]>();
    for (const id of ids) {
      for (const message of undeliveredFor(this.state, id)) {
        byMessage.set(message.messageId, [...(byMessage.get(message.messageId) ?? []), id]);
      }
    }
    return [...byMessage].map(([messageId, withdrawn]) => ({ type: "message.withdrawn", messageId, ids: withdrawn }));
  }

  #cancel(id: ThreadId, at: Iso): void {
    const thread = threadOf(this.state, id);
    const working = thread.status === "working";
    this.store.dispatch({ type: "thread.cancelled", id, at }, ...this.#withdrawals([id]));
    if (working) {
      this.#port.inform(messages.cancelled(id), { ids: [id] });
    }
  }

  #annotate(client: Client, request: AnnotateRequest): `A${number}` {
    const annotateId: `A${number}` = `A${this.#nextAnnotate++}`;
    this.#annotations.set(annotateId, { id: annotateId, client, request, delivered: false });
    this.#activate();
    this.#port.sendMessage(messages.annotate({ annotateId, ...request }), { ids: [], annotateId });
    return annotateId;
  }

  /** Withdraws an annotate message the agent has not seen, or tells it to stop one it has. Already answered: nothing to do. */
  #cancelAnnotate(annotateId: string): void {
    const pending = this.#annotations.get(annotateId);
    if (!pending) {
      return;
    }
    this.#annotations.delete(annotateId);
    if (pending.delivered) {
      this.#closedAnnotates.set(annotateId, "cancelled");
      this.#port.inform(messages.cancelled(annotateId), { ids: [], annotateId });
      return;
    }
    this.#closedAnnotates.set(annotateId, "withdrawn");
  }

  skills(): { name: string; description?: string }[] {
    return this.#port.skills();
  }

  setBusy(busy: boolean): void {
    const session = this.#port.session();
    this.store.setAgent({ busy, sessionId: session.id, sessionName: session.name });
  }

  /** Marks a Vantage message the agent has now seen; its threads become working. */
  delivered(details: VantageDetails | undefined): void {
    const pending = details?.annotateId ? this.#annotations.get(details.annotateId) : undefined;
    if (pending) {
      pending.delivered = true;
    }
    const messageId = details?.messageId;
    if (messageId && this.state.outbox.some((m) => m.messageId === messageId && !m.delivered)) {
      this.store.dispatch({ type: "message.delivered", messageId, at: this.#port.now() });
    }
  }

  /**
   * Called before every model request with the full transcript. Rewrites
   * Vantage messages whose requests were withdrawn before the agent saw them,
   * and marks every Vantage message present as delivered.
   */
  rewriteContext<M extends ContextMessage>(transcript: M[]): M[] | undefined {
    let changed = false;
    const rewritten = transcript.map((message) => {
      const details = detailsOf(message);
      if (details?.annotateId && this.#closedAnnotates.get(details.annotateId) === "withdrawn") {
        changed = true;
        return { ...message, content: messages.withdrawnAll([details.annotateId]) };
      }
      if (details?.annotateId) {
        this.delivered(details);
      }
      const outgoing = details?.messageId ? this.state.outbox.find((m) => m.messageId === details.messageId) : undefined;
      if (!outgoing) {
        return message;
      }
      this.delivered(details);
      if (!outgoing.withdrawn.length) {
        return message;
      }
      changed = true;
      const all = outgoing.ids.every((id) => outgoing.withdrawn.includes(id));
      const original = Value.Check(Type.String(), message.content) ? message.content : "";
      const content = all ? messages.withdrawnAll(outgoing.withdrawn) : `${original}${messages.withdrawnNote(outgoing.withdrawn)}`;
      return { ...message, content };
    });
    return changed ? rewritten : undefined;
  }

  // Reply tools. Each returns the text the model sees; a ReviewError becomes a tool error.

  answer(params: { threadId: string; text: string; refs?: CodeRef[] }): string {
    const refs = params.refs ?? [];
    refs.forEach((ref, i) => checkRef(ref, `refs[${i}]`));
    const thread = threadOf(this.state, params.threadId);
    this.#refuseCancelled(thread);
    this.store.dispatch({ type: "answer.posted", id: thread.id, text: params.text, refs, at: this.#port.now() });
    return `Answered ${thread.id} in Neovim.`;
  }

  #refuseCancelled(thread: Thread): void {
    if (thread.status === "cancelled") {
      throw new ReviewError("bad-transition", `${thread.id} was cancelled by the user; leave it out`);
    }
  }

  requestUpdate(params: { updates: (Omit<RequestUpdate, "requestId"> & { requestId: string })[] }): string {
    const touched = new Set<number>();
    const updates: RequestUpdate[] = params.updates.map((update) => {
      const request = changeOf(this.state, update.requestId);
      this.#refuseCancelled(request);
      if (request.round !== undefined) {
        touched.add(request.round);
      }
      if (update.anchor) {
        checkRef(update.anchor, `${update.requestId}.anchor`);
      }
      return { ...update, requestId: request.id };
    });
    const named = new Set<string>(updates.map((u) => u.requestId));
    const missing = this.state.threads.filter((t) => t.kind === "change" && isOpen(t) && t.round !== undefined && touched.has(t.round) && !named.has(t.id)).map((t) => t.id);
    if (missing.length) {
      throw new ReviewError("invalid", `report every request of the round in one call; missing ${missing.join(", ")}`);
    }
    this.store.dispatch({ type: "requests.updated", updates, at: this.#port.now() });
    return `Updated ${updates.map((u) => `${u.requestId} ${u.status}`).join(", ")}.`;
  }

  #requestFor(requestId: string | undefined, kind: TourRequest["kind"]): ThreadId | undefined {
    if (!requestId) {
      return undefined;
    }
    const request = threadOf(this.state, requestId);
    this.#refuseCancelled(request);
    if (request.kind !== kind) {
      throw new ReviewError("invalid", `${requestId} asked for a ${request.kind}`);
    }
    return request.id;
  }

  #publish(tour: Tour): string {
    this.store.dispatch({ type: "tour.published", tour, at: tour.createdAt });
    this.#broadcast({ kind: "published", tourId: tour.id, unrequested: !tour.requestId });
    return `Published ${tour.kind === "walkthrough" ? "walkthrough" : "diff tour"} "${tour.title}" with ${tour.stops.length} stops to Neovim.`;
  }

  #stops(stops: StopInput[]): TourStop[] {
    if (!stops.length) {
      throw new ReviewError("invalid", "a tour needs at least one stop");
    }
    return stops.map((stop, i) => {
      checkRef(stop.ref, `stops[${i}].ref`);
      return { ...stop, ref: { ...stop.ref, side: stop.ref.side ?? "current" } };
    });
  }

  walkthrough(params: { requestId?: string; title: string; summary: string; stops: StopInput[] }): string {
    const requestId = this.#requestFor(params.requestId, "walkthrough");
    const tour: Tour = {
      id: `tour-${this.state.nextId.tour}`,
      kind: "walkthrough",
      title: params.title,
      summary: params.summary,
      stops: this.#stops(params.stops),
      requestId,
      createdAt: this.#port.now(),
    };
    return this.#publish(tour);
  }

  async diffTour(params: { requestId?: string; title: string; summary: string; comparison: { base: string; target: string }; stops: StopInput[] }): Promise<string> {
    const requestId = this.#requestFor(params.requestId, "diffTour");
    const stops = this.#stops(params.stops);
    const base = await this.#commit(params.comparison.base, "comparison.base");
    const target: NonNullable<Tour["comparison"]>["target"] =
      params.comparison.target === "worktree" ? { kind: "worktree", head: await this.#commit("HEAD", "HEAD") } : { kind: "commit", commit: await this.#commit(params.comparison.target, "comparison.target") };
    const tour: Tour = {
      id: `tour-${this.state.nextId.tour}`,
      kind: "diffTour",
      title: params.title,
      summary: params.summary,
      comparison: { base, target },
      stops,
      requestId,
      createdAt: this.#port.now(),
    };
    return this.#publish(tour);
  }

  async #commit(ref: string, label: string): Promise<string> {
    if (ref.startsWith("-")) {
      throw new ReviewError("invalid", `${label}: not a commit`);
    }
    try {
      return await this.#port.git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
    } catch {
      throw new ReviewError("invalid", `${label}: ${ref} does not name a commit in this repository`);
    }
  }

  annotateReply(params: { annotateId: string; blocks: { line: number; text: string }[] }): string {
    const pending = this.#annotations.get(params.annotateId);
    if (!pending) {
      if (this.#closedAnnotates.has(params.annotateId)) {
        throw new ReviewError("bad-transition", `${params.annotateId} was cancelled by the user; leave it out`);
      }
      throw new ReviewError("unknown-id", `no open annotate request ${params.annotateId}`);
    }
    const candidates = new Set(pending.request.lines.map((l) => l.line));
    const outside = params.blocks.filter((b) => !candidates.has(b.line)).map((b) => b.line);
    if (outside.length) {
      throw new ReviewError("invalid", `lines ${outside.join(", ")} are not candidate lines`);
    }
    if (params.blocks.length > pending.request.budget) {
      throw new ReviewError("invalid", `at most ${pending.request.budget} blocks`);
    }
    this.#annotations.delete(params.annotateId);
    const blocks = params.blocks.filter((b) => b.text.trim());
    pending.client.send({ kind: "annotations", annotateId: pending.id, path: pending.request.path, blocks });
    return `Sent ${blocks.length} annotation${blocks.length === 1 ? "" : "s"} to Neovim.`;
  }

  /** Detaches a closed connection and cancels its annotate requests, since nobody is left to draw them. */
  forgetClient(client: Client): void {
    this.#clients.delete(client);
    for (const [id, pending] of this.#annotations) {
      if (pending.client === client) {
        this.#cancelAnnotate(id);
      }
    }
  }
}
