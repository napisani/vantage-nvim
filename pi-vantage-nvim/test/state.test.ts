import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyState, reduce, ReviewError, type QuestionThread, type ReviewState } from "../state.ts";
import { replay } from "../store.ts";

const at = "2026-11-10T00:00:00.000Z";

function question(state: ReviewState): ReviewState {
  const thread: QuestionThread = {
    id: "Q1",
    kind: "question",
    status: "sent",
    messages: [{ role: "user", text: "why?", at }],
    resolved: false,
    createdAt: at,
    updatedAt: at,
  };
  return reduce(state, { type: "thread.created", thread, at });
}

test("creating a thread adds it, bumps the revision and the next id", () => {
  const state = question(emptyState());
  assert.equal(state.revision, 1);
  assert.equal(state.threads[0].status, "sent");
  assert.equal(state.nextId.Q, 2);
});

test("reduce leaves the input untouched", () => {
  const before = emptyState();
  question(before);
  assert.equal(before.threads.length, 0);
  assert.equal(before.revision, 0);
});

test("a follow-up reopens an answered question but not a sent one", () => {
  let state = question(emptyState());
  assert.throws(() => reduce(state, { type: "thread.followUp", id: "Q1", text: "more", at }), ReviewError);
  state = reduce(state, { type: "answer.posted", id: "Q1", text: "because", refs: [], at });
  assert.equal(state.threads[0].status, "answered");
  state = reduce(state, { type: "thread.resolved", id: "Q1", resolved: true, at });
  state = reduce(state, { type: "thread.followUp", id: "Q1", text: "more", at });
  assert.equal(state.threads[0].status, "sent");
  assert.equal(state.threads[0].resolved, false);
  assert.deepEqual(
    state.threads[0].messages.map((m) => m.role),
    ["user", "agent", "user"],
  );
});

test("a change request moves pending, sent, working, done; a follow-up returns it to pending", () => {
  let state = reduce(emptyState(), {
    type: "thread.created",
    thread: { id: "R1", kind: "change", status: "pending", messages: [{ role: "user", text: "fix", at }], resolved: false, createdAt: at, updatedAt: at },
    at,
  });
  state = reduce(state, { type: "thread.edited", id: "R1", text: "fix it better", at });
  assert.equal(state.threads[0].messages[0].text, "fix it better");
  state = reduce(state, { type: "round.sent", round: 1, ids: ["R1"], at });
  assert.throws(() => reduce(state, { type: "thread.edited", id: "R1", text: "x", at }), /only pending/);
  state = reduce(state, { type: "message.queued", messageId: "m1", ids: ["R1"] });
  state = reduce(state, { type: "message.delivered", messageId: "m1", at });
  assert.equal(state.threads[0].status, "working");
  assert.equal(state.outbox.length, 0);
  state = reduce(state, {
    type: "requests.updated",
    updates: [{ requestId: "R1", status: "declined", reply: "breaks callers", anchor: { path: "src/a.ts", startLine: 3, endLine: 4, side: "current" } }],
    at,
  });
  assert.equal(state.threads[0].status, "declined");
  assert.equal(state.threads[0].anchor?.path, "src/a.ts");
  state = reduce(state, { type: "thread.followUp", id: "R1", text: "do it anyway", at });
  assert.equal(state.threads[0].status, "pending");
});

test("recall moves only sent requests back to pending", () => {
  let state = reduce(emptyState(), {
    type: "thread.created",
    thread: { id: "R1", kind: "change", status: "pending", messages: [{ role: "user", text: "fix", at }], resolved: false, createdAt: at, updatedAt: at },
    at,
  });
  state = reduce(state, { type: "round.sent", round: 1, ids: ["R1"], at });
  state = reduce(state, { type: "round.recalled", ids: ["R1"], at });
  assert.equal(state.threads[0].status, "pending");
  assert.equal(state.threads[0].kind === "change" && state.threads[0].round, undefined);
});

test("a withdrawn id stays sent-not-working when its message is delivered", () => {
  let state = question(emptyState());
  state = reduce(state, { type: "message.queued", messageId: "m1", ids: ["Q1"] });
  state = reduce(state, { type: "thread.cancelled", id: "Q1", at });
  state = reduce(state, { type: "message.withdrawn", messageId: "m1", ids: ["Q1"] });
  state = reduce(state, { type: "message.delivered", messageId: "m1", at });
  assert.equal(state.threads[0].status, "cancelled");
  assert.deepEqual(state.outbox[0].withdrawn, ["Q1"]);
});

test("publishing a tour completes its request and keeps one tour per kind", () => {
  let state = reduce(emptyState(), {
    type: "thread.created",
    thread: { id: "W1", kind: "walkthrough", status: "sent", messages: [{ role: "user", text: "tour", at }], resolved: false, createdAt: at, updatedAt: at },
    at,
  });
  const stop = { ref: { path: "a.ts", startLine: 1, endLine: 2, side: "current" as const }, title: "t", note: "n" };
  state = reduce(state, { type: "tour.published", tour: { id: "tour-1", kind: "walkthrough", title: "A", summary: "s", stops: [stop], requestId: "W1", createdAt: at }, at });
  state = reduce(state, { type: "tour.published", tour: { id: "tour-2", kind: "walkthrough", title: "B", summary: "s", stops: [stop], createdAt: at }, at });
  assert.equal(state.threads[0].status, "done");
  assert.deepEqual(
    state.tours.map((t) => t.id),
    ["tour-2"],
  );
  assert.equal(state.nextId.tour, 3);
});

test("replay rebuilds the same state and skips events the reducer rejects", () => {
  const events = [
    { type: "base.set" as const, base: { ref: "main", mergeBase: "c".repeat(40), target: { kind: "worktree" as const } }, at },
    { type: "thread.deleted" as const, id: "R9" as const },
    { type: "base.cleared" as const, at },
  ];
  const state = replay(events, "s");
  assert.equal(state.base, null);
  assert.equal(state.revision, 2);
  assert.equal(state.agent.sessionId, "s");
});
