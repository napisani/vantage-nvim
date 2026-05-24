# Use Vantage-owned Pi-backed agent sessions

Vantage will move from purely bounded one-shot model calls toward Vantage-owned in-memory agent sessions. Each session is scoped by workspace root, Model Target, and lens mode. Explain, annotate, and review commands share the scoped session, and each successful command becomes a retained session turn. Agent Task Context remains a separate adjacent-agent artifact: Vantage observes Agent Context Revisions and injects a Context Update Turn only when the file changes.

## Consequences

Vantage will own `Context.messages` and pass a stable Pi `sessionId` for provider caching or affinity. Pi is not treated as a separate OS daemon, and adjacent coding agents remain separate from the Vantage Pi-backed Agent Runtime. Session state is in-memory only for the first implementation, with sessions enabled by default, a bounded non-summarizing history window, short Pi cache retention, and explicit reset/status commands. Failed, cancelled, or timed-out requests are not retained as session history.
