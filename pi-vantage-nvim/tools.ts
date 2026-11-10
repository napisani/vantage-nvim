// The reply tools the agent calls to answer Vantage. Descriptions carry the
// rules, so the agent needs no skill.
import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";
import type { Json } from "./actions.ts";
import type { Review } from "./review.ts";
import { ReviewError } from "./state.ts";

const Line = Type.Integer({ minimum: 1 });
const Side = Type.Union([Type.Literal("current"), Type.Literal("base")], { description: "current: added or unchanged lines. base: removed lines in a diff." });
const Path = Type.String({ minLength: 1, description: "Workspace-relative path." });

const CodeRef = Type.Object({
  path: Path,
  startLine: Line,
  endLine: Line,
  side: Type.Optional(Side),
  note: Type.Optional(Type.String({ description: "Why this location matters, one line." })),
});

const Stop = Type.Object({
  ref: CodeRef,
  title: Type.String({ minLength: 1, description: "A few words." }),
  note: Type.String({ minLength: 1, description: "What to notice here and why it matters. One short paragraph." }),
});

const Answer = Type.Object({
  threadId: Type.String({ description: "The thread named in the Vantage message, e.g. Q3, or a W/T id when a tour cannot be built." }),
  text: Type.String({ minLength: 1, description: "Markdown answer." }),
  refs: Type.Optional(Type.Array(CodeRef, { description: "Code locations the user should visit; Neovim can load them into quickfix." })),
});

const Update = Type.Object({
  updates: Type.Array(
    Type.Object({
      requestId: Type.String({ description: "e.g. R3" }),
      status: Type.Union([Type.Literal("done"), Type.Literal("declined"), Type.Literal("needs-input")]),
      reply: Type.String({ minLength: 1, description: "One plain line: what changed, why not, or your question." }),
      anchor: Type.Optional(
        Type.Object(
          { path: Path, startLine: Line, endLine: Line, side: Side, text: Type.Optional(Type.String({ description: "The lines now, if you have them." })) },
          { description: "Where the change now lives, when it moved." },
        ),
      ),
    }),
    { minItems: 1 },
  ),
});

const Walkthrough = Type.Object({
  requestId: Type.Optional(Type.String({ description: "The W id from the Vantage message. Omit when the user asked in Pi rather than from Neovim." })),
  title: Type.String({ minLength: 1 }),
  summary: Type.String({ minLength: 1, description: "Two to four sentences: what the tour covers and the path it takes." }),
  stops: Type.Array(Stop, { minItems: 1, maxItems: 100 }),
});

const DiffTour = Type.Object({
  requestId: Type.Optional(Type.String({ description: "The T id from the Vantage message. Omit when the user asked in Pi rather than from Neovim." })),
  title: Type.String({ minLength: 1 }),
  summary: Type.String({ minLength: 1, description: "Two to four sentences: what changed and the path the tour takes." }),
  comparison: Type.Object({
    base: Type.String({ minLength: 1, description: "Base commit or ref; resolved to a commit." }),
    target: Type.String({ minLength: 1, description: '"worktree" for uncommitted work, or a commit or ref.' }),
  }),
  stops: Type.Array(Stop, { minItems: 1, maxItems: 100 }),
});

const Annotate = Type.Object({
  annotateId: Type.String({ description: "The A id from the Vantage message." }),
  blocks: Type.Array(Type.Object({ line: Line, text: Type.String({ minLength: 1, description: "One to four sentences." }) })),
});

export interface ReviewTool {
  name: string;
  label: string;
  description: string;
  parameters: TSchema;
  /** Active from session start; the rest switch on when Vantage first asks the agent something. */
  alwaysActive: boolean;
  run(review: Review, params: Json): string | Promise<string>;
}

interface TypedTool<P extends TSchema> extends Omit<ReviewTool, "parameters" | "run"> {
  parameters: P;
  run(review: Review, params: Static<P>): string | Promise<string>;
}

/** Erases the parameter type for the tool list, re-checking params so run only sees what its schema allows. */
function tool<P extends TSchema>(definition: TypedTool<P>): ReviewTool {
  return {
    ...definition,
    run: (review, params) => {
      if (!Value.Check(definition.parameters, params)) {
        throw new ReviewError("invalid", `${definition.name}: parameters do not match the schema`);
      }
      return definition.run(review, params);
    },
  };
}

export const TOOLS: ReviewTool[] = [
  tool({
    name: "vantage_answer",
    label: "Vantage answer",
    description: "Answer a Vantage question (Q id) in its thread in Neovim. Also use it with a W or T id to explain why a requested tour cannot be built.",
    parameters: Answer,
    alwaysActive: false,
    run: (review, params) => review.answer(params),
  }),
  tool({
    name: "vantage_request_update",
    label: "Vantage request update",
    description: "After making a round of Vantage change requests, report every request of the round once: done, declined (with why) or needs-input (with your question).",
    parameters: Update,
    alwaysActive: false,
    run: (review, params) => review.requestUpdate(params),
  }),
  tool({
    name: "vantage_walkthrough",
    label: "Vantage walkthrough",
    description:
      "Publish an ordered walkthrough of code to the user's Neovim, replacing the previous one. Use it for a Vantage walkthrough request, or when the user asks you to walk them through code or your changes in their editor.",
    parameters: Walkthrough,
    alwaysActive: true,
    run: (review, params) => review.walkthrough(params),
  }),
  tool({
    name: "vantage_diff_tour",
    label: "Vantage diff tour",
    description:
      "Publish a guided tour of a git diff to the user's Neovim (opened in Diffview), replacing the previous one. Use it for a Vantage diff tour request, or when the user asks for a tour of changes in their editor.",
    parameters: DiffTour,
    alwaysActive: true,
    run: (review, params) => review.diffTour(params),
  }),
  tool({
    name: "vantage_annotate",
    label: "Vantage annotate",
    description: "Send annotation blocks for a Vantage annotate request (A id). Each block sits on one of the request's candidate lines; stay within its budget.",
    parameters: Annotate,
    alwaysActive: false,
    run: (review, params) => review.annotateReply(params),
  }),
];
