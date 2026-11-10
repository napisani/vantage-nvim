// Pi wiring for pi-vantage-nvim: replay on session start, the socket for
// Neovim, the reply tools, and the Pi events that drive delivery and busy state.
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Json } from "./actions.ts";
import { detailsOf, MESSAGE_TYPE, Review, type PiPort, type VantageDetails } from "./review.ts";
import { socketPath, startServer } from "./server.ts";
import { ReviewError, type ReviewEvent } from "./state.ts";
import { replay } from "./store.ts";
import { TOOLS } from "./tools.ts";

export const ENTRY_TYPE = "vantage-review";
const run = promisify(execFile);

/** The git root above `cwd`, else `cwd`: the same rule Neovim uses, so a Pi started in a subdirectory still matches. */
export function workspaceRoot(cwd: string): string {
  try {
    return execFileSync("git", ["-C", cwd, "rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || cwd;
  } catch {
    return cwd;
  }
}

function eventsOf(ctx: ExtensionContext): ReviewEvent[] {
  // SAFETY: only this extension appends ENTRY_TYPE entries, and it always appends a ReviewEvent.
  return ctx.sessionManager.getBranch().flatMap((entry) => (entry.type === "custom" && entry.customType === ENTRY_TYPE ? [entry.data as ReviewEvent] : []));
}

export default function piVantageNvim(pi: ExtensionAPI): void {
  let review: Review | undefined;
  let close: (() => Promise<void>) | undefined;

  const port = (ctx: ExtensionContext, root: string): PiPort => ({
    sendMessage: (content, details) =>
      void pi.sendMessage<VantageDetails>({ customType: MESSAGE_TYPE, content, display: true, details }, { triggerTurn: true, deliverAs: "followUp" }),
    inform: (content, details) => void pi.sendMessage<VantageDetails>({ customType: MESSAGE_TYPE, content, display: true, details }, { triggerTurn: false, deliverAs: "nextTurn" }),
    appendEntry: (event) => pi.appendEntry(ENTRY_TYPE, event),
    activateTools: () => pi.setActiveTools([...new Set([...pi.getActiveTools(), ...TOOLS.map((t) => t.name)])]),
    session: () => ({ id: ctx.sessionManager.getSessionId(), name: pi.getSessionName() }),
    skills: () => pi.getCommands().flatMap((c) => (c.source === "skill" ? [{ name: c.name, description: c.description }] : [])),
    now: () => new Date().toISOString(),
    git: async (args) => (await run("git", ["-C", root, ...args])).stdout.trim(),
  });

  const status = (ctx: ExtensionContext) => {
    const open = review?.state.threads.filter((t) => !t.resolved && t.status !== "cancelled").length ?? 0;
    ctx.ui.setStatus("vantage", `vantage · ${open} open`);
  };

  pi.on("session_start", async (_event, ctx) => {
    await close?.();
    close = undefined;
    review = undefined;
    // Only the interactive TUI serves Neovim; print and RPC runs never advertise a socket.
    if (ctx.mode !== "tui") {
      return;
    }
    const sessionId = ctx.sessionManager.getSessionId();
    const root = workspaceRoot(ctx.cwd);
    const current = new Review(port(ctx, root), replay(eventsOf(ctx), sessionId));
    review = current;
    current.setBusy(!ctx.isIdle());
    const path = socketPath(root);
    close = await startServer({
      socketPath: path,
      workspaceRoot: root,
      review: () => review,
      session: () => ({ id: ctx.sessionManager.getSessionId(), name: pi.getSessionName() }),
    });
    status(ctx);
  });

  pi.on("session_shutdown", async () => {
    await close?.();
    close = undefined;
    review = undefined;
  });

  pi.on("agent_start", (_event, ctx) => {
    review?.setBusy(true);
    status(ctx);
  });

  pi.on("agent_end", (_event, ctx) => {
    review?.setBusy(false);
    status(ctx);
  });

  pi.on("message_start", (event) => {
    review?.delivered(detailsOf(event.message));
  });

  pi.on("context", (event) => {
    const messages = review?.rewriteContext(event.messages);
    return messages ? { messages } : undefined;
  });

  for (const tool of TOOLS) {
    pi.registerTool({
      name: tool.name,
      label: tool.label,
      description: tool.description,
      parameters: tool.parameters,
      defaultActive: tool.alwaysActive,
      executionMode: "sequential",
      async execute(_id, params, _signal, _onUpdate, ctx) {
        if (!review) {
          throw new Error("pi-vantage-nvim serves only the interactive Pi TUI");
        }
        try {
          // SAFETY: Pi parses tool-call arguments from JSON and checks them against the tool's schema.
          const text = await tool.run(review, params as Json);
          status(ctx);
          return { content: [{ type: "text" as const, text }], details: undefined };
        } catch (error) {
          // Expected failures become tool errors the model can read and fix.
          if (error instanceof ReviewError) {
            throw new Error(error.message);
          }
          throw error;
        }
      },
    });
  }
}
