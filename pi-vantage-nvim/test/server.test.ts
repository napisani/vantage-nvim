import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { after, test } from "node:test";
import { PROTOCOL_VERSION, type WireMessage } from "../protocol.ts";
import { Review } from "../review.ts";
import { socketPath, startServer, workspacePrefix } from "../server.ts";
import { emptyState } from "../state.ts";
import { FakePi } from "./fake.ts";

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "vantage-ws-"));
const directory = fs.mkdtempSync("/tmp/vantage-test-");
fs.chmodSync(directory, 0o700);
after(() => {
  fs.rmSync(workspace, { recursive: true, force: true });
  fs.rmSync(directory, { recursive: true, force: true });
});

async function serve(sessionId = "session-1") {
  const review = new Review(new FakePi(), emptyState(sessionId));
  const file = socketPath(workspace, directory);
  const close = await startServer({ socketPath: file, workspaceRoot: workspace, review: () => review, session: () => ({ id: sessionId, name: "uploads" }) });
  return { review, file, close };
}

/** Sends lines and collects replies until `count` arrive or the server closes. */
function talk(file: string, lines: object[], count: number): Promise<WireMessage[]> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(file);
    const received: WireMessage[] = [];
    let buffer = "";
    const done = () => {
      socket.destroy();
      resolve(received);
    };
    socket.on("connect", () => socket.write(lines.map((l) => `${JSON.stringify(l)}\n`).join("")));
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        received.push(JSON.parse(buffer.slice(0, newline)));
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
      }
      if (received.length >= count) {
        done();
      }
    });
    socket.on("end", done);
    socket.on("error", reject);
  });
}

test("socket names carry the workspace hash and the pid, and the socket is owner-only", async () => {
  const { file, close } = await serve();
  assert.equal(path.basename(file), `${workspacePrefix(workspace)}-${process.pid}.sock`);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  await close();
  assert.equal(fs.existsSync(file), false);
});

test("a probe returns the session and closes", async () => {
  const { file, close } = await serve();
  const [reply] = await talk(file, [{ v: 1, kind: "probe", workspaceRoot: workspace }], 1);
  assert.deepEqual(reply, { v: 1, kind: "probe", sessionId: "session-1", sessionName: "uploads", workspaceRoot: fs.realpathSync(workspace), pid: process.pid });
  await close();
});

test("version and workspace mismatches are refused", async () => {
  const { file, close } = await serve();
  const [version] = await talk(file, [{ v: 2, kind: "hello", workspaceRoot: workspace }], 1);
  assert.equal(version.kind === "error" && version.code, "version");
  const [other] = await talk(file, [{ v: 1, kind: "hello", workspaceRoot: os.tmpdir() }], 1);
  assert.equal(other.kind === "error" && other.code, "workspace");
  const [session] = await talk(file, [{ v: 1, kind: "hello", workspaceRoot: workspace, sessionId: "older" }], 1);
  assert.equal(session.kind === "error" && session.code, "session-changed");
  await close();
});

test("hello returns state; actions are acked and broadcast; rejected actions return errors", async () => {
  const { file, close } = await serve();
  const replies = await talk(
    file,
    [
      { v: 1, kind: "hello", workspaceRoot: workspace },
      { v: 1, kind: "action", id: 1, action: { type: "ask", text: "why?" } },
      { v: 1, kind: "action", id: 2, action: { type: "cancel", threadId: "Q7" } },
      { v: 1, kind: "skills", id: 3 },
    ],
    5,
  );
  assert.deepEqual(
    replies.map((r) => r.kind),
    ["state", "state", "ack", "error", "skills"],
  );
  assert.deepEqual(replies[2], { v: 1, kind: "ack", id: 1, threadId: "Q1" });
  assert.ok(
    replies.every((r) => r.v === PROTOCOL_VERSION),
    "every outgoing message carries the protocol version",
  );
  assert.equal(replies[3].kind === "error" && replies[3].code, "unknown-id");
  assert.equal(replies[3].kind === "error" && replies[3].id, 2);
  assert.deepEqual(replies[4].kind === "skills" && replies[4].skills, [{ name: "tdd", description: "Test first" }]);
  await close();
});

test("a Pi started in a subdirectory serves the git root Neovim resolves", async () => {
  const { execFileSync } = await import("node:child_process");
  const { workspaceRoot } = await import("../index.ts");
  execFileSync("git", ["init", "-q", workspace]);
  const sub = path.join(workspace, "pkg", "inner");
  fs.mkdirSync(sub, { recursive: true });
  assert.equal(fs.realpathSync(workspaceRoot(sub)), fs.realpathSync(workspace));
  assert.equal(workspaceRoot("/"), "/");
});
