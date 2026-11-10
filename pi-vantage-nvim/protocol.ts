// The wire between Neovim and the extension: one JSON object per line over an
// owner-only Unix socket. Every message carries `v`; each side stamps it in one
// place (Connection.send here, protocol.encode in lua/vantage/review/protocol.lua).
// Action payloads are in actions.ts; Lua builds them in lua/vantage/review/init.lua.
import { Type, type Static } from "typebox";
import type { AnnotateId, ReviewState, ThreadId } from "./state.ts";

export const PROTOCOL_VERSION = 1;
/** Bytes per line, either direction. */
export const MAX_LINE_BYTES = 4 * 1024 * 1024;

export type ErrorCode = "version" | "workspace" | "session-changed" | "unknown-id" | "bad-transition" | "invalid" | "busy-recall" | "no-agent";

export interface Block {
  line: number;
  text: string;
}

/** What Neovim sends: probe and hello open a connection, action and skills follow it. */
export const ClientEnvelopeSchema = Type.Object({
  v: Type.Number(),
  kind: Type.String(),
  id: Type.Optional(Type.Integer()),
  workspaceRoot: Type.Optional(Type.String()),
  sessionId: Type.Optional(Type.String()),
  action: Type.Optional(Type.Object({ type: Type.String() }, { additionalProperties: true })),
});
export type ClientEnvelope = Static<typeof ClientEnvelopeSchema>;

/** What the extension sends, before Connection.send stamps the version. */
export type ServerMessage =
  | { kind: "probe"; sessionId: string; sessionName?: string; workspaceRoot: string; pid: number }
  | { kind: "state"; state: ReviewState }
  | { kind: "ack"; id: number; threadId?: ThreadId; annotateId?: AnnotateId }
  | { kind: "error"; id?: number; code: ErrorCode; message: string }
  | { kind: "annotations"; annotateId: AnnotateId; path: string; blocks: Block[] }
  | { kind: "annotateFailed"; annotateId: AnnotateId; reason: string }
  | { kind: "skills"; id: number; skills: { name: string; description?: string }[] }
  | { kind: "published"; tourId: string; unrequested: boolean };

/** A server message as it goes on the wire. */
export type WireMessage = ServerMessage & { v: typeof PROTOCOL_VERSION };

export function stamp(message: ServerMessage): WireMessage {
  return { v: PROTOCOL_VERSION, ...message };
}
