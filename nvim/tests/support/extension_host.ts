// Test-only: hosts the real pi-vantage-nvim review and socket for the Lua
// suite, with the test playing the agent. Usage: node extension_host.ts <workspace>
// stdin: one JSON command per line, { op, params }; stdout: one JSON event per line.
import { execFile } from "node:child_process";
import * as readline from "node:readline";
import { promisify } from "node:util";
import { Type } from "typebox";
import { Value } from "typebox/value";
import type { Json } from "../../../pi-vantage-nvim/actions.ts";
import { Review, type PiPort, type VantageDetails } from "../../../pi-vantage-nvim/review.ts";
import { socketPath, startServer } from "../../../pi-vantage-nvim/server.ts";
import { emptyState } from "../../../pi-vantage-nvim/state.ts";
import { TOOLS } from "../../../pi-vantage-nvim/tools.ts";

type HostEvent =
  | { event: "ready"; socket: string }
  | { event: "message"; content: string; details: VantageDetails; inform: boolean }
  | { event: "result"; op: string; ok: true; text: string }
  | { event: "result"; op: string; ok: false; error: string }
  | { event: "stopped" };

const Command = Type.Object({ op: Type.String(), params: Type.Optional(Type.Unknown()) });

const run = promisify(execFile);
const workspace = process.argv[2];
let sessionId = process.env.VANTAGE_TEST_SESSION ?? "session-1";

function emit(event: HostEvent): void {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

const port: PiPort = {
  sendMessage: (content, details) => emit({ event: "message", content, details, inform: false }),
  inform: (content, details) => emit({ event: "message", content, details, inform: true }),
  appendEntry: () => undefined,
  activateTools: () => undefined,
  session: () => ({ id: sessionId, name: "test agent" }),
  skills: () => [{ name: "tdd", description: "Test first" }],
  now: () => new Date().toISOString(),
  git: async (args) => (await run("git", ["-C", workspace, ...args])).stdout.trim(),
};

let review = new Review(port, emptyState(sessionId));
const file = socketPath(workspace);
const serve = () => startServer({ socketPath: file, workspaceRoot: workspace, review: () => review, session: () => port.session() });
let close = await serve();

/** What Pi does on /new: shut the server down, start a new session, serve it on the same socket. */
async function switchSession(next: string): Promise<string> {
  await close();
  sessionId = next;
  review = new Review(port, emptyState(sessionId));
  close = await serve();
  return sessionId;
}

/** Test ops name the tools without their prefix, e.g. requestUpdate for vantage_request_update. */
function toolFor(op: string) {
  const name = `vantage_${op.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)}`;
  return TOOLS.find((t) => t.name === name);
}

async function perform(op: string, params: Json): Promise<string> {
  if (op === "busy") {
    review.setBusy(params === true);
    return "ok";
  }
  if (op === "switchSession") {
    return switchSession(String(params));
  }
  const tool = toolFor(op);
  if (!tool) {
    throw new Error(`unknown op ${op}`);
  }
  // Goes through the same schema check Pi applies before a real tool call.
  return tool.run(review, params);
}

readline.createInterface({ input: process.stdin }).on("line", async (line) => {
  const command: unknown = JSON.parse(line);
  if (!Value.Check(Command, command)) {
    return;
  }
  if (command.op === "stop") {
    await close();
    emit({ event: "stopped" });
    process.exit(0);
  }
  try {
    // SAFETY: the params came from JSON.parse, so they are plain JSON.
    const text = await perform(command.op, command.params as Json);
    emit({ event: "result", op: command.op, ok: true, text });
  } catch (error) {
    emit({ event: "result", op: command.op, ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});

emit({ event: "ready", socket: file });
