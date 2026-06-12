# Use a Vantage-owned singleton Pi coding-agent buddy session

Vantage uses the `@earendil-works/pi-coding-agent` SDK directly for model-backed commands. The backend owns one in-memory buddy session per backend/workspace process. Explain, question, edit, and search share that singleton session so the assistant behaves like an explicit project buddy rather than a collection of disconnected one-shot calls.

Annotation generation is intentionally excluded from this buddy memory: annotation requests use transient sessions and are discarded after completion, because inline annotation sweeps are noisy and should not bias later conversational work.

## Consequences

Vantage no longer scopes persistent sessions by model target or lens. The session is reset explicitly with `:VantageAgentReset` or implicitly by backend restart. Only one agentic request may be active at a time; users can cancel active work with `:VantageAgentCancel` before resetting or starting another search.

Commands enable only command-specific tool allowlists. User-facing commands do not enable direct mutation tools in v1; edits are returned through structured Vantage submit tools and applied by the Neovim client. Search returns curated quickfix locations through `submit_search_results` rather than parsing text or temp files.

Agent state remains in-memory only. Failed, cancelled, timed-out, annotation, or malformed submit-tool requests are not intentionally retained as successful Vantage outcomes.
