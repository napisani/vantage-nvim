// A PiPort that records what the review asked Pi to do.
import { Review, type Client, type PiPort, type VantageDetails } from "../review.ts";
import type { ServerMessage } from "../protocol.ts";
import { emptyState, type ReviewEvent, type ReviewState } from "../state.ts";

export interface Sent {
  content: string;
  details: VantageDetails;
  inform: boolean;
}

export class FakePi implements PiPort {
  sent: Sent[] = [];
  entries: ReviewEvent[] = [];
  activations = 0;
  commits = new Map<string, string>([
    ["HEAD", "a".repeat(40)],
    ["main", "b".repeat(40)],
  ]);
  #clock = 0;

  sendMessage(content: string, details: VantageDetails): void {
    this.sent.push({ content, details, inform: false });
  }
  inform(content: string, details: VantageDetails): void {
    this.sent.push({ content, details, inform: true });
  }
  appendEntry(event: ReviewEvent): void {
    this.entries.push(event);
  }
  activateTools(): void {
    this.activations += 1;
  }
  session() {
    return { id: "session-1", name: "fixing uploads" };
  }
  skills(): { name: string; description?: string }[] {
    return [{ name: "tdd", description: "Test first" }];
  }
  now(): string {
    this.#clock += 1;
    return new Date(Date.UTC(2026, 10, 10, 0, 0, this.#clock)).toISOString();
  }
  async git(args: string[]): Promise<string> {
    const ref = args.at(-1)!.replace(/\^\{commit\}$/, "");
    const sha = this.commits.get(ref) ?? (/^[0-9a-f]{40}$/.test(ref) ? ref : undefined);
    if (!sha) {
      throw new Error(`unknown ref ${ref}`);
    }
    return sha;
  }
  last(): Sent {
    return this.sent.at(-1)!;
  }
}

export class FakeClient implements Client {
  received: ServerMessage[] = [];
  send(message: ServerMessage): void {
    this.received.push(message);
  }
  lastState(): ReviewState {
    const states = this.received.filter((m) => m.kind === "state");
    const last = states.at(-1);
    if (!last || last.kind !== "state") {
      throw new Error("no state received");
    }
    return last.state;
  }
}

export function setup(initial: ReviewState = emptyState("session-1")) {
  const pi = new FakePi();
  const review = new Review(pi, initial);
  const client = new FakeClient();
  review.addClient(client);
  return { pi, review, client };
}

export const anchor = { path: "src/upload.ts", startLine: 40, endLine: 42, side: "current" as const, text: "if (retries > 3) {" };
