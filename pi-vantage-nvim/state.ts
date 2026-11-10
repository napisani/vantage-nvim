// Review state and the one reducer that changes it. Pure: no Pi, no I/O.
// Every change is a ReviewEvent so the session log can replay it on resume.

export type Iso = string;
export type ThreadKind = "question" | "change" | "walkthrough" | "diffTour";
export type ThreadId = `${"Q" | "R" | "W" | "T"}${number}`;
export type AnnotateId = `A${number}`;
export type Side = "current" | "base";

/** An expected failure: a rejected action or tool call, never a crash. */
export class ReviewError extends Error {
  readonly code: "unknown-id" | "bad-transition" | "invalid" | "busy-recall";
  constructor(code: ReviewError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

export interface Anchor {
  /** Workspace-relative. */
  path: string;
  startLine: number;
  endLine: number;
  side: Side;
  /** The lines when anchored, so the anchor can be found again after edits. */
  text: string;
}

export interface ReviewBase {
  ref: string;
  mergeBase: string;
  target: { kind: "worktree" } | { kind: "commit"; commit: string };
}

export interface CodeRef {
  path: string;
  startLine: number;
  endLine: number;
  side?: Side;
  note?: string;
}

export interface Message {
  role: "user" | "agent";
  text: string;
  at: Iso;
  refs?: CodeRef[];
}

export type QuestionStatus = "sent" | "working" | "answered" | "cancelled";
export type ChangeStatus = "pending" | "sent" | "working" | "done" | "declined" | "needs-input" | "cancelled";
export type TourRequestStatus = "sent" | "working" | "done" | "failed" | "cancelled";

interface ThreadBase {
  id: ThreadId;
  /** Absent: the workspace as a whole. */
  anchor?: Anchor;
  /** The last user message is what to do now. */
  messages: Message[];
  lens?: string;
  /** Hides the thread's sign; a follow-up clears it. */
  resolved: boolean;
  createdAt: Iso;
  updatedAt: Iso;
}

export interface QuestionThread extends ThreadBase {
  kind: "question";
  status: QuestionStatus;
  preset?: "explain";
}

export interface ChangeRequest extends ThreadBase {
  kind: "change";
  status: ChangeStatus;
  round?: number;
}

export interface TourRequest extends ThreadBase {
  kind: "walkthrough" | "diffTour";
  status: TourRequestStatus;
  /** Diff tour refs as the user typed them. */
  comparison?: { base?: string; target?: string };
  tourId?: string;
}

export type Thread = QuestionThread | ChangeRequest | TourRequest;

export interface TourStop {
  ref: CodeRef & { side: Side };
  title: string;
  note: string;
}

export interface Tour {
  id: string;
  kind: "walkthrough" | "diffTour";
  title: string;
  summary: string;
  /** Diff tours only: resolved commits. */
  comparison?: { base: string; target: { kind: "worktree"; head: string } | { kind: "commit"; commit: string } };
  stops: TourStop[];
  /** Absent when the agent published it unasked. */
  requestId?: ThreadId;
  createdAt: Iso;
}

/** A message the extension queued for the agent, until the agent has seen it. */
export interface Outgoing {
  messageId: string;
  ids: ThreadId[];
  delivered: boolean;
  /** Ids the user withdrew before the agent saw the message. */
  withdrawn: ThreadId[];
}

export interface ReviewState {
  version: 1;
  revision: number;
  base: ReviewBase | null;
  threads: Thread[];
  /** Newest last; at most one of each kind. */
  tours: Tour[];
  nextId: { Q: number; R: number; W: number; T: number; tour: number; message: number };
  round: number;
  outbox: Outgoing[];
  /** Not persisted; set from Pi events. */
  agent: { busy: boolean; sessionId: string; sessionName?: string };
}

export interface RequestUpdate {
  requestId: ThreadId;
  status: "done" | "declined" | "needs-input";
  reply: string;
  anchor?: Omit<Anchor, "text"> & { text?: string };
}

export type ReviewEvent =
  | { type: "thread.created"; thread: Thread; at: Iso }
  | { type: "thread.followUp"; id: ThreadId; text: string; lens?: string; at: Iso }
  | { type: "thread.edited"; id: ThreadId; text: string; at: Iso }
  | { type: "thread.deleted"; id: ThreadId }
  | { type: "thread.resolved"; id: ThreadId; resolved: boolean; at: Iso }
  | { type: "threads.clearResolved"; at: Iso }
  | { type: "round.sent"; round: number; ids: ThreadId[]; at: Iso }
  | { type: "round.recalled"; ids: ThreadId[]; at: Iso }
  | { type: "thread.cancelled"; id: ThreadId; at: Iso }
  | { type: "message.queued"; messageId: string; ids: ThreadId[] }
  | { type: "message.delivered"; messageId: string; at: Iso }
  | { type: "message.withdrawn"; messageId: string; ids: ThreadId[] }
  | { type: "answer.posted"; id: ThreadId; text: string; refs: CodeRef[]; at: Iso }
  | { type: "requests.updated"; updates: RequestUpdate[]; at: Iso }
  | { type: "tour.published"; tour: Tour; at: Iso }
  | { type: "tours.cleared"; kind?: Tour["kind"]; at: Iso }
  | { type: "base.set"; base: ReviewBase; at: Iso }
  | { type: "base.cleared"; at: Iso };

export function emptyState(sessionId = ""): ReviewState {
  return {
    version: 1,
    revision: 0,
    base: null,
    threads: [],
    tours: [],
    nextId: { Q: 1, R: 1, W: 1, T: 1, tour: 1, message: 1 },
    round: 0,
    outbox: [],
    agent: { busy: false, sessionId },
  };
}

const PREFIX = { question: "Q", change: "R", walkthrough: "W", diffTour: "T" } as const satisfies Record<ThreadKind, string>;

export function prefixOf(kind: ThreadKind): "Q" | "R" | "W" | "T" {
  return PREFIX[kind];
}

export function threadOf(state: ReviewState, id: string): Thread {
  const thread = state.threads.find((t) => t.id === id);
  if (!thread) {
    throw new ReviewError("unknown-id", `no thread ${id}`);
  }
  return thread;
}

/** Statuses where the agent owes nothing and the user has nothing queued. */
const SETTLED = new Set(["answered", "done", "declined", "needs-input", "failed", "cancelled"]);

export function isOpen(thread: Thread): boolean {
  return thread.status === "sent" || thread.status === "working";
}

export function isSettled(thread: Thread): boolean {
  return SETTLED.has(thread.status);
}

export function changeOf(state: ReviewState, id: string): ChangeRequest {
  const thread = threadOf(state, id);
  if (thread.kind !== "change") {
    throw new ReviewError("invalid", `${id} is not a change request`);
  }
  return thread;
}

function lastUserMessage(thread: Thread): Message {
  const message = thread.messages.findLast((m) => m.role === "user");
  if (!message) {
    throw new ReviewError("invalid", `${thread.id} has no user message`);
  }
  return message;
}

function followUp(thread: Thread, text: string, lens: string | undefined, at: Iso): void {
  if (!isSettled(thread)) {
    throw new ReviewError("bad-transition", `${thread.id} is ${thread.status}; ${thread.status === "pending" ? "edit it instead" : "wait for the agent's reply"}`);
  }
  thread.messages.push({ role: "user", text, at });
  thread.lens = lens;
  thread.resolved = false;
  thread.updatedAt = at;
  if (thread.kind === "change") {
    thread.status = "pending";
    delete thread.round;
  } else {
    thread.status = "sent";
  }
}

function cancel(thread: Thread, at: Iso): void {
  if (isSettled(thread)) {
    throw new ReviewError("bad-transition", `${thread.id} is already ${thread.status}`);
  }
  thread.status = "cancelled";
  thread.updatedAt = at;
}

function applyUpdate(state: ReviewState, update: RequestUpdate, at: Iso): void {
  const request = changeOf(state, update.requestId);
  if (!isOpen(request)) {
    throw new ReviewError("bad-transition", `${request.id} is ${request.status}, not waiting for an update`);
  }
  request.status = update.status;
  request.messages.push({ role: "agent", text: update.reply, at });
  request.updatedAt = at;
  if (update.anchor) {
    request.anchor = { ...update.anchor, text: update.anchor.text ?? request.anchor?.text ?? "" };
  }
}

function postAnswer(state: ReviewState, event: Extract<ReviewEvent, { type: "answer.posted" }>): void {
  const thread = threadOf(state, event.id);
  if (thread.kind === "change") {
    throw new ReviewError("invalid", `${thread.id} is a change request; report it with vantage_request_update`);
  }
  if (!isOpen(thread)) {
    throw new ReviewError("bad-transition", `${thread.id} is ${thread.status}, not waiting for an answer`);
  }
  thread.messages.push({ role: "agent", text: event.text, at: event.at, refs: event.refs.length ? event.refs : undefined });
  thread.status = thread.kind === "question" ? "answered" : "failed";
  thread.updatedAt = event.at;
}

function publishTour(state: ReviewState, event: Extract<ReviewEvent, { type: "tour.published" }>): void {
  const { tour } = event;
  if (tour.requestId) {
    const request = threadOf(state, tour.requestId);
    if (request.kind !== tour.kind) {
      throw new ReviewError("invalid", `${request.id} asked for a ${request.kind}, not a ${tour.kind}`);
    }
    if (!isOpen(request)) {
      throw new ReviewError("bad-transition", `${request.id} is ${request.status}, not waiting for a tour`);
    }
    request.status = "done";
    request.tourId = tour.id;
    request.messages.push({ role: "agent", text: `Published "${tour.title}" (${tour.stops.length} stops).`, at: event.at });
    request.updatedAt = event.at;
  }
  state.tours = [...state.tours.filter((t) => t.kind !== tour.kind), tour];
  state.nextId.tour = Math.max(state.nextId.tour, Number(tour.id.replace(/^tour-/, "")) + 1);
}

function outgoingOf(state: ReviewState, messageId: string): Outgoing | undefined {
  return state.outbox.find((m) => m.messageId === messageId);
}

/** Delivered messages matter only while they carry a withdrawal the agent must keep seeing. */
function pruneOutbox(state: ReviewState): void {
  state.outbox = state.outbox.filter((m) => !m.delivered || m.withdrawn.length > 0);
}

type Handlers = { [T in ReviewEvent["type"]]: (state: ReviewState, event: Extract<ReviewEvent, { type: T }>) => void };

const handlers = {
  "thread.created": (state, { thread }) => {
    if (state.threads.some((t) => t.id === thread.id)) {
      throw new ReviewError("invalid", `${thread.id} already exists`);
    }
    state.threads.push(thread);
    const prefix = prefixOf(thread.kind);
    state.nextId[prefix] = Math.max(state.nextId[prefix], Number(thread.id.slice(1)) + 1);
  },
  "thread.followUp": (state, e) => followUp(threadOf(state, e.id), e.text, e.lens, e.at),
  "thread.edited": (state, e) => {
    const request = changeOf(state, e.id);
    if (request.status !== "pending") {
      throw new ReviewError("bad-transition", `${e.id} is ${request.status}; only pending requests can be edited`);
    }
    lastUserMessage(request).text = e.text;
    request.updatedAt = e.at;
  },
  "thread.deleted": (state, e) => {
    const request = changeOf(state, e.id);
    if (request.status !== "pending") {
      throw new ReviewError("bad-transition", `${e.id} is ${request.status}; only pending requests can be deleted`);
    }
    state.threads = state.threads.filter((t) => t.id !== e.id);
  },
  "thread.resolved": (state, e) => {
    const thread = threadOf(state, e.id);
    thread.resolved = e.resolved;
    thread.updatedAt = e.at;
  },
  "threads.clearResolved": (state) => {
    state.threads = state.threads.filter((t) => !t.resolved);
  },
  "round.sent": (state, e) => {
    for (const id of e.ids) {
      const request = changeOf(state, id);
      if (request.status !== "pending") {
        throw new ReviewError("bad-transition", `${id} is ${request.status}, not pending`);
      }
      request.status = "sent";
      request.round = e.round;
      request.updatedAt = e.at;
    }
    state.round = Math.max(state.round, e.round);
  },
  "round.recalled": (state, e) => {
    for (const id of e.ids) {
      const request = changeOf(state, id);
      if (request.status !== "sent") {
        throw new ReviewError("busy-recall", `${id} is ${request.status}; only requests the agent has not started can be recalled`);
      }
      request.status = "pending";
      delete request.round;
      request.updatedAt = e.at;
    }
  },
  "thread.cancelled": (state, e) => cancel(threadOf(state, e.id), e.at),
  "message.queued": (state, e) => {
    state.outbox.push({ messageId: e.messageId, ids: e.ids, delivered: false, withdrawn: [] });
    state.nextId.message = Math.max(state.nextId.message, Number(e.messageId.replace(/^m/, "")) + 1);
  },
  "message.delivered": (state, e) => {
    const message = outgoingOf(state, e.messageId);
    if (!message || message.delivered) {
      return;
    }
    message.delivered = true;
    for (const id of message.ids) {
      const thread = state.threads.find((t) => t.id === id);
      if (thread && thread.status === "sent" && !message.withdrawn.includes(id)) {
        thread.status = "working";
        thread.updatedAt = e.at;
      }
    }
    pruneOutbox(state);
  },
  "message.withdrawn": (state, e) => {
    const message = outgoingOf(state, e.messageId);
    if (message && !message.delivered) {
      message.withdrawn = [...new Set([...message.withdrawn, ...e.ids])];
    }
  },
  "answer.posted": postAnswer,
  "requests.updated": (state, e) => {
    for (const update of e.updates) {
      applyUpdate(state, update, e.at);
    }
  },
  "tour.published": publishTour,
  "tours.cleared": (state, e) => {
    state.tours = e.kind ? state.tours.filter((t) => t.kind !== e.kind) : [];
  },
  "base.set": (state, e) => {
    state.base = e.base;
  },
  "base.cleared": (state) => {
    state.base = null;
  },
} satisfies Handlers;

/** Applies one event to a copy of the state. Throws ReviewError and leaves the input untouched when the event is invalid. */
export function reduce(state: ReviewState, event: ReviewEvent): ReviewState {
  const next = structuredClone(state);
  // SAFETY: handlers is keyed by event type, so handlers[event.type] accepts this event.
  (handlers[event.type] as (s: ReviewState, e: ReviewEvent) => void)(next, event);
  next.revision = state.revision + 1;
  return next;
}

/** Outgoing messages that still carry the given thread, undelivered. */
export function undeliveredFor(state: ReviewState, id: ThreadId): Outgoing[] {
  return state.outbox.filter((m) => !m.delivered && m.ids.includes(id) && !m.withdrawn.includes(id));
}
