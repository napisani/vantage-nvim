import { emptyState, reduce, type ReviewEvent, type ReviewState } from "./state.ts";

export interface StoreHooks {
  persist(event: ReviewEvent): void;
  broadcast(state: ReviewState): void;
}

/** Holds the one review state. A batch of events applies whole or not at all. */
export class Store {
  #state: ReviewState;
  readonly #hooks: StoreHooks;

  constructor(hooks: StoreHooks, initial: ReviewState = emptyState()) {
    this.#hooks = hooks;
    this.#state = initial;
  }

  get state(): ReviewState {
    return this.#state;
  }

  /** Reduces every event first, so an invalid one leaves nothing persisted. */
  dispatch(...events: ReviewEvent[]): ReviewState {
    if (!events.length) {
      return this.#state;
    }
    let next = this.#state;
    for (const event of events) {
      next = reduce(next, event);
    }
    this.#state = next;
    for (const event of events) {
      this.#hooks.persist(event);
    }
    this.#hooks.broadcast(next);
    return next;
  }

  setAgent(agent: ReviewState["agent"]): void {
    const current = this.#state.agent;
    if (current.busy === agent.busy && current.sessionId === agent.sessionId && current.sessionName === agent.sessionName) {
      return;
    }
    this.#state = { ...this.#state, agent, revision: this.#state.revision + 1 };
    this.#hooks.broadcast(this.#state);
  }
}

/** Rebuilds state from logged events, skipping any the current reducer rejects. */
export function replay(events: readonly ReviewEvent[], sessionId: string): ReviewState {
  let state = emptyState(sessionId);
  for (const event of events) {
    try {
      state = reduce(state, event);
    } catch {
      // An event a newer or older reducer disagrees with is dropped rather than losing the session.
    }
  }
  return state;
}
