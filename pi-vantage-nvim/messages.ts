// The text the agent reads. Each message ends with what to do and which tool
// answers it, so the agent needs no skill to serve Vantage.
import type { Anchor, ChangeRequest, QuestionThread, ReviewBase, ReviewState, Thread, ThreadId, TourRequest } from "./state.ts";

export const MESSAGE_PREFIX = "Vantage · ";

export interface AnnotatePrompt {
  annotateId: string;
  path: string;
  scope: string;
  lines: { line: number; text: string }[];
  budget: number;
  lens?: string;
}

function span(start: number, end: number): string {
  return end > start ? `${start}-${end}` : `${start}`;
}

export function where(anchor: Anchor | undefined): string {
  if (!anchor) {
    return "the workspace as a whole";
  }
  return `${anchor.path}:${span(anchor.startLine, anchor.endLine)} (${anchor.side === "base" ? "removed code, base side" : "current code"})`;
}

export function diffCommand(base: ReviewBase): string {
  return base.target.kind === "worktree"
    ? `git diff ${base.mergeBase} (working tree; untracked files count as added: git ls-files --others --exclude-standard)`
    : `git diff ${base.mergeBase}..${base.target.commit}`;
}

function baseLines(state: ReviewState): string[] {
  const { base } = state;
  if (!base) {
    return [];
  }
  const target = base.target.kind === "worktree" ? "the working tree" : base.target.commit.slice(0, 12);
  return [`Review base: ${base.ref} (merge base ${base.mergeBase.slice(0, 12)}) against ${target}. Diff: ${diffCommand(base)}`];
}

function lensLines(lens: string | undefined): string[] {
  return lens ? [`Lens (from the user, frames how to answer): ${lens}`] : [];
}

function quoted(anchor: Anchor | undefined): string[] {
  if (!anchor || !anchor.text.trim()) {
    return [];
  }
  return ["The lines read:", ...anchor.text.split("\n").map((line) => `  | ${line}`)];
}

function conversation(thread: Thread): string[] {
  const earlier = thread.messages.slice(0, -1).map((m) => `  ${m.role === "user" ? "user" : "you"}: ${m.text}`);
  return earlier.length ? ["Thread so far:", ...earlier] : [];
}

function latest(thread: Thread): string {
  return thread.messages.at(-1)?.text ?? "";
}

export function question(state: ReviewState, thread: QuestionThread): string {
  return [
    `${MESSAGE_PREFIX}question ${thread.id} about ${where(thread.anchor)}`,
    ...baseLines(state),
    ...lensLines(thread.lens),
    ...quoted(thread.anchor),
    ...conversation(thread),
    `Question: ${latest(thread)}`,
    "",
    `Read the code; do not edit files. Answer with vantage_answer (threadId "${thread.id}") in two to six sentences of markdown. Add refs for code locations the user should visit.`,
  ].join("\n");
}

function requestLines(request: ChangeRequest): string[] {
  const text = request.anchor?.text.trim() ? ` · the lines read: ${JSON.stringify(request.anchor.text.split("\n")[0].trim())}` : "";
  return [
    `- ${request.id} at ${where(request.anchor)}${text}`,
    ...(request.lens ? [`  lens: ${request.lens}`] : []),
    ...request.messages.map((m) => `  ${m.role === "user" ? "user" : "you"}: ${m.text}`),
  ];
}

export function round(state: ReviewState, number: number, requests: ChangeRequest[]): string {
  return [
    `${MESSAGE_PREFIX}change requests, round ${number}`,
    ...baseLines(state),
    ...requests.flatMap(requestLines),
    "",
    "Make each change in the workspace, keeping it to what its request asks. Line numbers are from before your edits; the quoted line finds the spot if they moved.",
    "Then call vantage_request_update once, covering every request above: done, declined (say why), or needs-input (ask your question), each with a one-line reply. Give the new anchor when a change moved the lines it was about.",
  ].join("\n");
}

export function walkthrough(state: ReviewState, request: TourRequest): string {
  return [
    `${MESSAGE_PREFIX}walkthrough ${request.id}${request.anchor ? ` starting from ${where(request.anchor)}` : ""}`,
    ...baseLines(state),
    ...lensLines(request.lens),
    ...quoted(request.anchor),
    ...conversation(request),
    `Request: ${latest(request)}`,
    "",
    `Read the code; do not edit files. Publish an ordered tour of the code that answers the request with vantage_walkthrough (requestId "${request.id}"): each stop is a file and line range with a short title and a note on what to notice there. If you cannot build it, explain why with vantage_answer (threadId "${request.id}").`,
  ].join("\n");
}

function comparisonRule(state: ReviewState, request: TourRequest): string {
  const typed = request.comparison;
  if (typed?.base) {
    return `Compare ${typed.base} against ${typed.target ?? "the working tree"}, as the user asked.`;
  }
  if (state.base) {
    return `Compare the review base against its target: ${diffCommand(state.base)}.`;
  }
  return "Choose the comparison from the request; with nothing named, compare HEAD against the working tree.";
}

export function diffTour(state: ReviewState, request: TourRequest): string {
  return [
    `${MESSAGE_PREFIX}diff tour ${request.id}`,
    ...baseLines(state),
    ...lensLines(request.lens),
    ...conversation(request),
    `Request: ${latest(request)}`,
    comparisonRule(state, request),
    "",
    `Read the diff; do not edit files. Publish the tour with vantage_diff_tour (requestId "${request.id}"), giving the exact base commit and the target ("worktree" or a commit). Each stop names a side: "current" for added or unchanged lines, "base" for removed ones. If you cannot build it, explain why with vantage_answer (threadId "${request.id}").`,
  ].join("\n");
}

export function annotate(prompt: AnnotatePrompt): string {
  return [
    `${MESSAGE_PREFIX}annotate ${prompt.annotateId} in ${prompt.path} (${prompt.scope})`,
    ...lensLines(prompt.lens),
    `Candidate lines (line: text), at most ${prompt.budget} annotations:`,
    ...prompt.lines.map((l) => `  ${l.line}: ${l.text}`),
    "",
    `Read the file and what it touches; do not edit files. Call vantage_annotate (annotateId "${prompt.annotateId}") with up to ${prompt.budget} blocks, each anchored to one candidate line above. A block is one to four sentences explaining what matters on that line. Use fewer blocks when fewer lines deserve one.`,
  ].join("\n");
}

export function cancelled(id: string): string {
  return `${MESSAGE_PREFIX}${id} cancelled by the user. Stop work on it and do not report it.`;
}

/** Replaces a message every request of which was withdrawn before the agent saw it. */
export function withdrawnAll(ids: readonly string[]): string {
  return `${MESSAGE_PREFIX}${ids.join(", ")} withdrawn by the user before you saw it; ignore it.`;
}

/** Appended to a message some of whose requests were withdrawn before the agent saw it. */
export function withdrawnNote(ids: readonly ThreadId[]): string {
  return `\n\nThe user withdrew ${ids.join(", ")} before you saw this message: skip ${ids.length === 1 ? "it" : "them"} and leave ${ids.length === 1 ? "it" : "them"} out of your report.`;
}
