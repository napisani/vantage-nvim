import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeAction } from "../actions.ts";
import { MESSAGE_TYPE } from "../review.ts";
import { ReviewError } from "../state.ts";
import { anchor, FakeClient, setup } from "./fake.ts";

test("ask creates Q1, wakes the agent once with the question, and activates reply tools", () => {
  const { pi, review, client } = setup();
  const result = review.handleAction(client, decodeAction({ type: "ask", anchor, text: "  why retried?  ", lens: "explain for a learner" }));
  assert.equal(result.threadId, "Q1");
  assert.equal(pi.sent.length, 1);
  const message = pi.last();
  assert.match(message.content, /^Vantage · question Q1 about src\/upload\.ts:40-42 \(current code\)/);
  assert.match(message.content, /Lens \(from the user, frames how to answer\): explain for a learner/);
  assert.match(message.content, /\| if \(retries > 3\) \{/);
  assert.match(message.content, /Question: why retried\?/);
  assert.match(message.content, /vantage_answer \(threadId "Q1"\)/);
  assert.match(message.content, /do not edit files/);
  assert.deepEqual(message.details, { messageId: "m1", ids: ["Q1"] });
  assert.equal(pi.activations, 1);
  assert.equal(client.lastState().threads[0].status, "sent");
  assert.deepEqual(
    pi.entries.map((e) => e.type),
    ["thread.created", "message.queued"],
  );
});

test("questions name the review base diff when one is set", () => {
  const { pi, review, client } = setup();
  review.handleAction(client, decodeAction({ type: "setBase", base: { ref: "main", mergeBase: "c".repeat(40), target: { kind: "worktree" } } }));
  review.handleAction(client, decodeAction({ type: "ask", text: "what changed?" }));
  assert.match(pi.last().content, /about the workspace as a whole/);
  assert.match(pi.last().content, new RegExp(`Diff: git diff ${"c".repeat(40)}`));
});

test("a vantage_answer settles the question; a second one is refused", () => {
  const { review, client } = setup();
  review.handleAction(client, decodeAction({ type: "ask", text: "why?" }));
  review.answer({ threadId: "Q1", text: "Because.", refs: [{ path: "src/a.ts", startLine: 1, endLine: 3 }] });
  const thread = client.lastState().threads[0];
  assert.equal(thread.status, "answered");
  assert.deepEqual(thread.messages.at(-1)?.refs, [{ path: "src/a.ts", startLine: 1, endLine: 3 }]);
  assert.throws(() => review.answer({ threadId: "Q1", text: "again" }), /not waiting/);
  assert.throws(() => review.answer({ threadId: "Q9", text: "x" }), ReviewError);
});

test("answer refs must stay inside the workspace", () => {
  const { review, client } = setup();
  review.handleAction(client, decodeAction({ type: "ask", text: "why?" }));
  assert.throws(() => review.answer({ threadId: "Q1", text: "x", refs: [{ path: "../etc/passwd", startLine: 1, endLine: 1 }] }), /workspace-relative/);
  assert.throws(() => review.answer({ threadId: "Q1", text: "x", refs: [{ path: "/abs.ts", startLine: 1, endLine: 1 }] }), /workspace-relative/);
});

test("change requests queue silently, then one round message lists them all", () => {
  const { pi, review, client } = setup();
  review.handleAction(client, decodeAction({ type: "request", anchor, text: "use backoff" }));
  review.handleAction(client, decodeAction({ type: "request", text: "rename the module" }));
  assert.equal(pi.sent.length, 0);
  review.handleAction(client, decodeAction({ type: "sendRound" }));
  assert.equal(pi.sent.length, 1);
  const { content, details } = pi.last();
  assert.match(content, /^Vantage · change requests, round 1/);
  assert.match(content, /- R1 at src\/upload\.ts:40-42 \(current code\) · the lines read: "if \(retries > 3\) \{"/);
  assert.match(content, /- R2 at the workspace as a whole/);
  assert.match(content, /vantage_request_update once/);
  assert.deepEqual(details.ids, ["R1", "R2"]);
  assert.throws(() => review.handleAction(client, decodeAction({ type: "sendRound" })), /no pending/);
});

test("request now sends only the new request as its own round", () => {
  const { pi, review, client } = setup();
  review.handleAction(client, decodeAction({ type: "request", text: "queued" }));
  review.handleAction(client, decodeAction({ type: "request", text: "urgent", sendNow: true }));
  assert.deepEqual(pi.last().details.ids, ["R2"]);
  const statuses = client.lastState().threads.map((t) => [t.id, t.status]);
  assert.deepEqual(statuses, [
    ["R1", "pending"],
    ["R2", "sent"],
  ]);
});

test("a request update must cover every open request of the round", () => {
  const { review, client } = setup();
  review.handleAction(client, decodeAction({ type: "request", text: "a" }));
  review.handleAction(client, decodeAction({ type: "request", text: "b" }));
  review.handleAction(client, decodeAction({ type: "sendRound" }));
  assert.throws(() => review.requestUpdate({ updates: [{ requestId: "R1", status: "done", reply: "ok" }] }), /missing R2/);
  review.requestUpdate({
    updates: [
      { requestId: "R1", status: "done", reply: "ok" },
      { requestId: "R2", status: "needs-input", reply: "which module?" },
    ],
  });
  assert.deepEqual(
    client.lastState().threads.map((t) => t.status),
    ["done", "needs-input"],
  );
});

test("cancelling a queued request withdraws it from the message before the agent sees it", () => {
  const { pi, review, client } = setup();
  review.handleAction(client, decodeAction({ type: "request", text: "a" }));
  review.handleAction(client, decodeAction({ type: "request", text: "b" }));
  review.handleAction(client, decodeAction({ type: "sendRound" }));
  review.handleAction(client, decodeAction({ type: "cancel", threadId: "R2" }));
  assert.equal(pi.sent.length, 1, "no inform for a request the agent has not seen");
  const transcript = [{ role: "custom", customType: MESSAGE_TYPE, content: pi.last().content, details: pi.last().details }];
  const rewritten = review.rewriteContext(transcript);
  assert.ok(rewritten);
  assert.match(String(rewritten[0].content), /The user withdrew R2 before you saw this message/);
  const state = client.lastState();
  assert.equal(state.threads[0].status, "working");
  assert.equal(state.threads[1].status, "cancelled");
  // A later model call sees the same rewrite.
  assert.match(String(review.rewriteContext(transcript)?.[0].content), /withdrew R2/);
  // The round no longer needs R2 in its report.
  review.requestUpdate({ updates: [{ requestId: "R1", status: "done", reply: "ok" }] });
  assert.throws(() => review.requestUpdate({ updates: [{ requestId: "R2", status: "done", reply: "ok" }] }), /cancelled by the user/);
});

test("withdrawing every request replaces the message", () => {
  const { pi, review, client } = setup();
  review.handleAction(client, decodeAction({ type: "ask", text: "why?" }));
  review.handleAction(client, decodeAction({ type: "cancel", threadId: "Q1" }));
  const rewritten = review.rewriteContext([{ role: "custom", customType: MESSAGE_TYPE, content: pi.last().content, details: pi.last().details }]);
  assert.equal(rewritten?.[0].content, "Vantage · Q1 withdrawn by the user before you saw it; ignore it.");
});

test("cancelling a request the agent is working on informs it on its next turn", () => {
  const { pi, review, client } = setup();
  review.handleAction(client, decodeAction({ type: "ask", text: "why?" }));
  review.delivered(pi.last().details);
  assert.equal(client.lastState().threads[0].status, "working");
  review.handleAction(client, decodeAction({ type: "cancel", threadId: "Q1" }));
  assert.equal(pi.last().inform, true);
  assert.match(pi.last().content, /Q1 cancelled by the user/);
});

test("recall pulls back a sent round before the agent starts and refuses after", () => {
  const { pi, review, client } = setup();
  review.handleAction(client, decodeAction({ type: "request", text: "a" }));
  review.handleAction(client, decodeAction({ type: "sendRound" }));
  review.handleAction(client, decodeAction({ type: "recallRound" }));
  assert.equal(client.lastState().threads[0].status, "pending");
  review.handleAction(client, decodeAction({ type: "sendRound" }));
  review.delivered(pi.last().details);
  assert.throws(() => review.handleAction(client, decodeAction({ type: "recallRound" })), { code: "busy-recall" });
});

test("walkthrough requests publish tours; an unrequested tour is flagged", () => {
  const { pi, review, client } = setup();
  review.handleAction(client, decodeAction({ type: "walkthrough", text: "how does upload work?" }));
  assert.match(pi.last().content, /vantage_walkthrough \(requestId "W1"\)/);
  const stops = [{ ref: { path: "src/upload.ts", startLine: 1, endLine: 4, side: "current" as const }, title: "Entry", note: "Starts here." }];
  review.walkthrough({ requestId: "W1", title: "Upload", summary: "s", stops });
  review.walkthrough({ title: "Mine", summary: "s", stops });
  const published = client.received.filter((m) => m.kind === "published");
  assert.deepEqual(
    published.map((m) => m.kind === "published" && m.unrequested),
    [false, true],
  );
  const state = client.lastState();
  assert.equal(state.threads[0].status, "done");
  assert.equal(state.tours.length, 1);
  assert.equal(state.tours[0].title, "Mine");
});

test("diff tours resolve commits and reject unknown ones", async () => {
  const { pi, review, client } = setup();
  review.handleAction(client, decodeAction({ type: "diffTour", text: "tour it", base: "main" }));
  assert.match(pi.last().content, /Compare main against the working tree, as the user asked/);
  const stops = [{ ref: { path: "a.ts", startLine: 1, endLine: 1, side: "base" as const }, title: "t", note: "n" }];
  await assert.rejects(review.diffTour({ requestId: "T1", title: "x", summary: "s", comparison: { base: "nope", target: "worktree" }, stops }), /does not name a commit/);
  await review.diffTour({ requestId: "T1", title: "x", summary: "s", comparison: { base: "main", target: "worktree" }, stops });
  const tour = client.lastState().tours[0];
  assert.deepEqual(tour.comparison, { base: "b".repeat(40), target: { kind: "worktree", head: "a".repeat(40) } });
});

test("a tour that cannot be built is reported with vantage_answer", () => {
  const { review, client } = setup();
  review.handleAction(client, decodeAction({ type: "diffTour", text: "tour it" }));
  review.answer({ threadId: "T1", text: "There are no changes against HEAD." });
  assert.equal(client.lastState().threads[0].status, "failed");
});

test("annotate replies go only to the requesting client and respect the candidates and budget", () => {
  const { pi, review, client } = setup();
  const other = new FakeClient();
  review.addClient(other);
  const lines = [
    { line: 3, text: "local x = 1" },
    { line: 5, text: "return x" },
  ];
  const { annotateId } = review.handleAction(client, decodeAction({ type: "annotate", request: { path: "a.lua", scope: "buffer", lines, budget: 1 } }));
  assert.equal(annotateId, "A1");
  assert.match(pi.last().content, /annotate A1 in a\.lua/);
  assert.match(pi.last().content, /at most 1 annotations/);
  assert.throws(() => review.annotateReply({ annotateId: "A1", blocks: [{ line: 4, text: "x" }] }), /not candidate lines/);
  assert.throws(
    () =>
      review.annotateReply({
        annotateId: "A1",
        blocks: [
          { line: 3, text: "x" },
          { line: 5, text: "y" },
        ],
      }),
    /at most 1/,
  );
  review.annotateReply({ annotateId: "A1", blocks: [{ line: 3, text: "Sets x." }] });
  assert.deepEqual(client.received.at(-1), { kind: "annotations", annotateId: "A1", path: "a.lua", blocks: [{ line: 3, text: "Sets x." }] });
  assert.equal(
    other.received.filter((m) => m.kind === "annotations").length,
    0,
  );
  assert.equal(client.lastState().threads.length, 0, "annotations stay out of review state");
  assert.throws(() => review.annotateReply({ annotateId: "A1", blocks: [] }), /no open annotate request/);
});

test("cancelling an annotate request the agent has not seen withdraws its message", () => {
  const { pi, review, client } = setup();
  const request = { path: "a.lua", scope: "line" as const, lines: [{ line: 1, text: "x" }], budget: 1 };
  review.handleAction(client, decodeAction({ type: "annotate", request }));
  const sent = pi.last();
  review.handleAction(client, decodeAction({ type: "cancelAnnotate", annotateId: "A1" }));
  const transcript = [{ role: "custom", customType: MESSAGE_TYPE, content: sent.content, details: sent.details }];
  assert.equal(review.rewriteContext(transcript)?.[0].content, "Vantage · A1 withdrawn by the user before you saw it; ignore it.");
  assert.throws(() => review.annotateReply({ annotateId: "A1", blocks: [] }), /A1 was cancelled by the user/);
  assert.equal(pi.sent.length, 1, "no notice for a message the agent never saw");
});

test("cancelling an annotate request the agent is working on sends a stop notice", () => {
  const { pi, review, client } = setup();
  const request = { path: "a.lua", scope: "line" as const, lines: [{ line: 1, text: "x" }], budget: 1 };
  review.handleAction(client, decodeAction({ type: "annotate", request }));
  review.delivered(pi.last().details);
  review.handleAction(client, decodeAction({ type: "cancelAnnotate", annotateId: "A1" }));
  assert.equal(pi.last().inform, true);
  assert.match(pi.last().content, /A1 cancelled by the user/);
  // Cancelling again, or a request already answered, is a no-op.
  review.handleAction(client, decodeAction({ type: "cancelAnnotate", annotateId: "A1" }));
  assert.equal(pi.sent.length, 2);
});

test("a closed connection cancels its annotate requests", () => {
  const { pi, review, client } = setup();
  const request = { path: "a.lua", scope: "line" as const, lines: [{ line: 1, text: "x" }], budget: 1 };
  review.handleAction(client, decodeAction({ type: "annotate", request }));
  const sent = pi.last();
  review.forgetClient(client);
  assert.match(String(review.rewriteContext([{ role: "custom", customType: MESSAGE_TYPE, content: sent.content, details: sent.details }])?.[0].content), /A1 withdrawn/);
});

test("decodeAction rejects unknown types, missing fields and blank text", () => {
  assert.throws(() => decodeAction({ type: "nope" }), /unknown action type/);
  assert.throws(() => decodeAction({ type: "ask" }), ReviewError);
  assert.throws(() => decodeAction({ type: "ask", text: "   " }), /text is empty/);
  assert.throws(() => decodeAction({ type: "cancel", threadId: "X1" }), ReviewError);
});

test("resolve hides a thread and clear removes resolved ones", () => {
  const { review, client } = setup();
  review.handleAction(client, decodeAction({ type: "ask", text: "why?" }));
  review.answer({ threadId: "Q1", text: "because" });
  review.handleAction(client, decodeAction({ type: "resolve", threadId: "Q1", resolved: true }));
  assert.equal(client.lastState().threads[0].resolved, true);
  review.handleAction(client, decodeAction({ type: "clearResolved" }));
  assert.equal(client.lastState().threads.length, 0);
});

test("busy state reaches clients without entering the session log", () => {
  const { pi, review, client } = setup();
  review.setBusy(true);
  assert.equal(client.lastState().agent.busy, true);
  assert.equal(client.lastState().agent.sessionName, "fixing uploads");
  assert.equal(pi.entries.length, 0);
});
