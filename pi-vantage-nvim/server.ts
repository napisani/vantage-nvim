// Owner-only Unix socket: discovery probes and persistent Neovim connections.
// Socket names carry a workspace hash and the Pi PID so Lua can find them.
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as net from "node:net";
import * as path from "node:path";
import { Value } from "typebox/value";
import { decodeAction } from "./actions.ts";
import { ClientEnvelopeSchema, MAX_LINE_BYTES, PROTOCOL_VERSION, stamp, type ClientEnvelope, type ErrorCode, type ServerMessage } from "./protocol.ts";
import type { Client, Review } from "./review.ts";
import { ReviewError } from "./state.ts";

export function socketDirectory(): string {
  // Short and fixed: macOS's tmpdir is too long for Unix socket paths.
  return `/tmp/vantage-pi-${process.getuid?.() ?? 0}`;
}

function ensurePrivateDirectory(directory: string): void {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0) {
    throw new Error(`Vantage socket directory must be owner-only: ${directory}`);
  }
}

export function workspacePrefix(root: string): string {
  return createHash("sha256").update(fs.realpathSync(root)).digest("hex").slice(0, 16);
}

export function socketPath(root: string, directory = socketDirectory(), pid = process.pid): string {
  return path.join(directory, `${workspacePrefix(root)}-${pid}.sock`);
}

export interface ServerOptions {
  socketPath: string;
  workspaceRoot: string;
  /** The review of the current Pi session; undefined between sessions. */
  review(): Review | undefined;
  session(): { id: string; name?: string };
}

class Connection implements Client {
  readonly #socket: net.Socket;
  constructor(socket: net.Socket) {
    this.#socket = socket;
  }
  send(message: ServerMessage): void {
    if (!this.#socket.destroyed) {
      this.#socket.write(`${JSON.stringify(stamp(message))}\n`);
    }
  }
  fail(code: ErrorCode, message: string, id?: number): void {
    this.send({ kind: "error", code, message, id });
  }
  end(): void {
    this.#socket.end();
  }
}

export async function startServer(options: ServerOptions): Promise<() => Promise<void>> {
  ensurePrivateDirectory(path.dirname(options.socketPath));
  const root = fs.realpathSync(options.workspaceRoot);
  const sockets = new Set<net.Socket>();

  const sameWorkspace = (value: string | undefined) => {
    try {
      return value !== undefined && fs.realpathSync(value) === root;
    } catch {
      return false;
    }
  };

  const server = net.createServer((socket) => {
    sockets.add(socket);
    const connection = new Connection(socket);
    let review: Review | undefined;
    let buffer = "";

    const handshake = (envelope: ClientEnvelope) => {
      if (!sameWorkspace(envelope.workspaceRoot)) {
        connection.fail("workspace", `this Pi serves ${root}`);
        return connection.end();
      }
      const session = options.session();
      if (envelope.kind === "probe") {
        connection.send({ kind: "probe", sessionId: session.id, sessionName: session.name, workspaceRoot: root, pid: process.pid });
        return connection.end();
      }
      if (envelope.kind !== "hello") {
        connection.fail("invalid", "expected probe or hello first");
        return connection.end();
      }
      const current = options.review();
      if (!current) {
        connection.fail("no-agent", "Pi has no active session");
        return connection.end();
      }
      if (envelope.sessionId !== undefined && envelope.sessionId !== session.id) {
        connection.fail("session-changed", `Pi moved to session ${session.id}`);
        return connection.end();
      }
      review = current;
      current.addClient(connection);
    };

    const handle = (envelope: ClientEnvelope) => {
      const { id, action } = envelope;
      if (envelope.kind === "skills" && id !== undefined) {
        return connection.send({ kind: "skills", id, skills: review!.skills() });
      }
      if (envelope.kind !== "action" || id === undefined || !action) {
        return connection.fail("invalid", "expected an action with an id", id);
      }
      try {
        const result = review!.handleAction(connection, decodeAction(action));
        connection.send({ kind: "ack", id, ...result });
      } catch (error) {
        if (error instanceof ReviewError) {
          return connection.fail(error.code, error.message, id);
        }
        connection.fail("invalid", error instanceof Error ? error.message : String(error), id);
      }
    };

    const line = (text: string) => {
      let parsed: ClientEnvelope | undefined;
      try {
        const json: unknown = JSON.parse(text);
        parsed = Value.Check(ClientEnvelopeSchema, json) ? json : undefined;
      } catch {
        parsed = undefined;
      }
      if (!parsed) {
        return connection.fail("invalid", "expected a JSON message with v and kind");
      }
      const envelope = parsed;
      if (envelope.v !== PROTOCOL_VERSION) {
        connection.fail("version", `extension speaks protocol ${PROTOCOL_VERSION}, client sent ${String(envelope.v)}`);
        return connection.end();
      }
      if (!review) {
        return handshake(envelope);
      }
      handle(envelope);
    };

    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const text = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (text.trim()) {
          line(text);
        }
        newline = buffer.indexOf("\n");
      }
      if (Buffer.byteLength(buffer) > MAX_LINE_BYTES) {
        connection.fail("invalid", "message too large");
        socket.destroy();
      }
    });
    socket.on("error", () => socket.destroy());
    socket.on("close", () => {
      sockets.delete(socket);
      review?.forgetClient(connection);
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.socketPath, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  // The directory is the access gate; the mode keeps the socket itself owner-only too.
  fs.chmodSync(options.socketPath, 0o600);

  let closed = false;
  return async () => {
    if (closed) {
      return;
    }
    closed = true;
    for (const socket of sockets) {
      socket.destroy();
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(options.socketPath, { force: true });
  };
}
