// What Neovim may ask for. Decoded once at the socket, so everything past here
// sees a typed action or never runs.
import { Type, type Static, type TObject, type TProperties, type TSchema } from "typebox";
import { Value } from "typebox/value";
import { ReviewError } from "./state.ts";

const MAX_TEXT = 20_000;
const Text = Type.String({ minLength: 1, maxLength: MAX_TEXT });
const Lens = Type.Optional(Type.String({ maxLength: MAX_TEXT }));
const ThreadIdSchema = Type.String({ pattern: "^[QRWT][0-9]+$" });
const Commit = Type.String({ pattern: "^[0-9a-f]{40}([0-9a-f]{24})?$" });
const Line = Type.Integer({ minimum: 1 });

export const AnchorSchema = Type.Object({
  path: Type.String({ minLength: 1, maxLength: 1024 }),
  startLine: Line,
  endLine: Line,
  side: Type.Union([Type.Literal("current"), Type.Literal("base")]),
  text: Type.String({ maxLength: MAX_TEXT }),
});

const BaseSchema = Type.Object({
  ref: Type.String({ minLength: 1, maxLength: 256 }),
  mergeBase: Commit,
  target: Type.Union([Type.Object({ kind: Type.Literal("worktree") }), Type.Object({ kind: Type.Literal("commit"), commit: Commit })]),
});

const AnnotateRequestSchema = Type.Object({
  path: Type.String({ minLength: 1, maxLength: 1024 }),
  scope: Type.Union(["line", "range", "visible", "buffer"].map((s) => Type.Literal(s))),
  lines: Type.Array(Type.Object({ line: Line, text: Type.String({ maxLength: MAX_TEXT }) }), { minItems: 1, maxItems: 5000 }),
  budget: Type.Integer({ minimum: 1, maximum: 100 }),
  lens: Lens,
});

const action = <T extends string, P extends TProperties>(type: T, properties: P) => Type.Object({ type: Type.Literal(type), ...properties });

const ACTIONS = {
  ask: action("ask", { anchor: Type.Optional(AnchorSchema), text: Text, lens: Lens, preset: Type.Optional(Type.Literal("explain")) }),
  request: action("request", { anchor: Type.Optional(AnchorSchema), text: Text, lens: Lens, sendNow: Type.Optional(Type.Boolean()) }),
  edit: action("edit", { threadId: ThreadIdSchema, text: Text }),
  delete: action("delete", { threadId: ThreadIdSchema }),
  followUp: action("followUp", { threadId: ThreadIdSchema, text: Text, lens: Lens }),
  sendRound: action("sendRound", {}),
  recallRound: action("recallRound", {}),
  cancel: action("cancel", { threadId: ThreadIdSchema }),
  resolve: action("resolve", { threadId: ThreadIdSchema, resolved: Type.Boolean() }),
  clearResolved: action("clearResolved", {}),
  walkthrough: action("walkthrough", { anchor: Type.Optional(AnchorSchema), text: Text, lens: Lens }),
  diffTour: action("diffTour", {
    text: Text,
    base: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
    target: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
    lens: Lens,
  }),
  clearTours: action("clearTours", { kind: Type.Optional(Type.Union([Type.Literal("walkthrough"), Type.Literal("diffTour")])) }),
  setBase: action("setBase", { base: BaseSchema }),
  clearBase: action("clearBase", {}),
  annotate: action("annotate", { request: AnnotateRequestSchema }),
  cancelAnnotate: action("cancelAnnotate", { annotateId: Type.String({ pattern: "^A[0-9]+$" }) }),
};

export type ClientAction = Static<(typeof ACTIONS)[keyof typeof ACTIONS]>;
export type AnnotateRequest = Static<typeof AnnotateRequestSchema>;

/** A value as JSON.parse returns it. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export function decode<T extends TSchema>(schema: T, value: Json, what: string): Static<T> {
  if (Value.Check(schema, value)) {
    return value;
  }
  const [first] = Value.Errors(schema, value);
  const field = first?.instancePath ? `"${first.instancePath.slice(1).replaceAll("/", ".")}"` : what;
  throw new ReviewError("invalid", `${field} ${first?.message ?? "is invalid"}`);
}

const Tagged = Type.Object({ type: Type.String() });

/** Decodes against the schema for the action's type, so an error names the field, not the union. */
export function decodeAction(body: Json): ClientAction {
  const { type } = decode(Tagged, body, "action");
  if (!Object.hasOwn(ACTIONS, type)) {
    throw new ReviewError("invalid", `unknown action type "${type}"`);
  }
  // SAFETY: ACTIONS[type] is the member of ClientAction whose type is `type`.
  const schema = ACTIONS[type as keyof typeof ACTIONS] as TObject;
  // SAFETY: decode checked the value against that member's schema.
  const decoded = decode(schema, body, "action") as ClientAction;
  return trimmed(decoded);
}

function trimmed(a: ClientAction): ClientAction {
  if ("text" in a) {
    a.text = a.text.trim();
    if (!a.text) {
      throw new ReviewError("invalid", "text is empty");
    }
  }
  if ("lens" in a && a.lens !== undefined) {
    a.lens = a.lens.trim() || undefined;
  }
  return a;
}
