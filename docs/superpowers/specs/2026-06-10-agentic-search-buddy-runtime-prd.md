# PRD: Agentic Search and Singleton Buddy Runtime

## Problem Statement

Vantage currently helps developers understand and modify code through scoped commands such as explain, question, edit, annotate, and search. These commands are useful, but they do not yet provide a project-wide, agentic search experience that turns the agent's reasoning into native Neovim navigation artifacts.

Developers want Vantage to be an agentic buddy that helps them move quickly while staying close to implementation intent. A user should be able to ask “where is this handled?”, “trace this selected behavior”, or “what places matter for this concept?” and receive a quickfix list of code locations with concise explanations. The result should be a curated reading path through the codebase, not a detached chat response.

The current runtime/session model also creates tension for future agentic features. Some commands use bounded model calls and Vantage-owned in-memory session history, while true agentic search needs Pi coding-agent tools, command-specific active tools, custom structured result submission, shared memory, and cancellation. Vantage needs one consistent library-backed runtime path that can support both comprehension-first commands and agentic project exploration.

## Solution

Vantage will introduce a singleton in-memory Pi coding-agent buddy session for model-backed commands, using the Pi coding-agent SDK as the unified runtime path. The singleton session is shared across explicit developer commands and can be reset on demand when idle. Commands configure active tools per turn, so Vantage can offer project-aware help without giving every command write access.

The first new user-facing feature is `VantageSearch`: an agentic project search command that uses read-only Pi tools to explore the workspace, then submits final curated locations through a Vantage-owned structured result tool. Vantage converts those final results into a Neovim quickfix list. Each quickfix item includes a jumpable location and a concise one-line explanation.

Search supports normal, range, and visual invocation. Normal mode requires an explicit user prompt. Visual/range mode may use a configurable default prompt, initially “Find related code paths and explain why they matter.” Visual/range search includes a trace seed: the selected code, its file, and actual 1-based file line numbers, so the agent can search the project from a concrete anchor.

Vantage will also normalize its coordinate convention: all Vantage protocol, prompt, model, and UI coordinates are 1-based lines and 1-based characters. Conversion to Neovim’s 0-based APIs happens only at the Neovim API boundary.

## User Stories

1. As a Neovim developer, I want to ask Vantage to search my project semantically, so that I can find the important places related to a concept without leaving the editor.
2. As a Neovim developer, I want Vantage search results in quickfix, so that I can navigate them using familiar editor workflows.
3. As a Neovim developer, I want each search result to include a concise explanation, so that I understand why the location matters before opening it.
4. As a Neovim developer, I want Vantage to return only final curated search results, so that the quickfix list is a useful reading path instead of an agent log.
5. As a Neovim developer, I want visual selection search to use the selected code as a trace seed, so that I can ask “where does this flow continue?” from code I am already reading.
6. As a Neovim developer, I want range-based search to include actual file line numbers, so that the agent and quickfix agree about locations.
7. As a Neovim developer, I want normal-mode search to require a prompt, so that project-wide searches remain explicit.
8. As a Neovim developer, I want visual/range search to have a configurable default prompt, so that common trace workflows are fast.
9. As a Neovim developer, I want Vantage search to use read-only tools, so that search cannot mutate my files.
10. As a Neovim developer, I want Vantage search to remember the search turn in the buddy session, so that follow-up commands can refer to the discovered context.
11. As a Neovim developer, I want search to share a singleton buddy session with explain, question, and edit, so that Vantage feels like one assistant rather than disconnected commands.
12. As a Neovim developer, I want annotations excluded from the singleton buddy memory, so that exploratory visual annotation requests do not pollute the working session.
13. As a Neovim developer, I want to cancel the active agentic request, so that I can stop a slow or mistaken search without restarting Neovim.
14. As a Neovim developer, I want Vantage to reject a new search while another agentic request is active, so that the singleton session does not receive overlapping prompts.
15. As a Neovim developer, I want Vantage reset to work only when idle, so that session state is not cleared while a tool-using request is still running.
16. As a Neovim developer, I want Vantage to notify me when search returns no results, so that I know the request completed even if quickfix has no items.
17. As a Neovim developer, I want empty search results to clear or replace the quickfix list, so that stale previous results are not mistaken for the current search.
18. As a Neovim developer, I want all valid final results shown without an artificial cap, so that broad searches are not silently truncated.
19. As a Neovim developer, I want search result paths to be workspace-relative in the agent contract, so that outputs are concise and safe to validate.
20. As a Neovim developer, I want Vantage to validate search result paths and line numbers, so that quickfix entries reliably open real files.
21. As a Neovim developer, I want Vantage to reject duplicate exact search results, so that the quickfix list stays clean.
22. As a Neovim developer, I want Vantage to reject multiline search explanations, so that quickfix remains readable.
23. As a Neovim developer, I want invalid result submissions to return detailed correction errors to the agent, so that the agent can retry with corrected results.
24. As a Neovim developer, I want Vantage to use the configured model target for search, so that all commands honor my Vantage model configuration.
25. As a Neovim developer, I want Vantage to fail clearly if the configured model cannot power the coding-agent session, so that I can fix configuration instead of getting silent fallback behavior.
26. As a Neovim developer, I want configured API keys and Pi OAuth credentials to work consistently across commands, so that agentic search does not require a separate auth setup.
27. As a Neovim developer, I want Vantage to preserve the current explain/question/edit/annotation UX, so that runtime migration does not break existing workflows.
28. As a Neovim developer, I want explain, question, edit, and search to have read-only project tools where appropriate, so that Vantage can answer with project context when useful.
29. As a Neovim developer, I want edit requests to submit replacement text through Vantage rather than directly changing files through agent tools, so that I stay in control of applied edits.
30. As a Neovim developer, I want annotations to remain scope-local and fast, so that they do not become noisy project-wide investigations.
31. As a Neovim developer, I want lens inclusion to be configurable for prompted commands, so that I can decide when lens should shape answers.
32. As a Neovim developer, I want annotations to always include the active lens, so that annotation blocks stay aligned with the current learning perspective.
33. As a Neovim developer, I want explain/search to include lens by default, so that Vantage’s comprehension features stay lens-aware.
34. As a Neovim developer, I want question/edit to exclude lens by default, so that my direct prompt or edit instruction remains primary unless I opt in.
35. As a Neovim plugin user, I want a public Lua API for search and existing commands, so that I can write keymaps and custom command wrappers consistently.
36. As a Neovim plugin user, I want command wrappers and Lua APIs to share implementation paths, so that behavior is consistent regardless of how I invoke Vantage.
37. As a maintainer, I want the runtime migration covered by tests at protocol, backend, and Neovim seams, so that existing behavior remains stable.
38. As a maintainer, I want one coordinate convention across Vantage, so that future features do not accumulate off-by-one debt.
39. As a maintainer, I want command-specific tool activation, so that future authoring features can safely add edit/write capabilities only when needed.
40. As a maintainer, I want result submission to be a structured custom tool, so that agentic features do not rely on fragile text parsing.

## Implementation Decisions

- Vantage will add the Pi coding-agent SDK as a runtime dependency and use it as the unified library-backed runtime path for model-backed commands.
- Vantage will not shell out to the Pi binary for this feature.
- Vantage will maintain one singleton in-memory buddy session for non-annotation model-backed commands within the backend process/workspace. The session resets on explicit user request or backend restart.
- The singleton buddy session is not scoped by lens, command, buffer, or exact prompt. Lens and context are prompt metadata, not session identity.
- Annotations will use a transient SDK session and will not be recorded into singleton buddy memory.
- The existing session ADR must be updated or superseded because the new decision changes session scope from workspace/model/lens to singleton workspace/backend buddy memory.
- Active tools are command-specific. Search uses read-only project tools plus a structured search-result submission tool. Explain and question may use read-only project tools. Edit uses read-only project tools plus a structured edit submission tool. Annotate uses only a structured annotation submission tool.
- Direct file mutation tools are not enabled for v1 command behavior. Edits are applied by Vantage after structured replacement submission, preserving developer control.
- `VantageSearch` returns final curated results only. Intermediate agent exploration is retained in session history but not surfaced in quickfix.
- Search result submission uses a custom structured tool instead of a final text format. This differs from 99’s line-oriented temp-file contract and gives Vantage stronger validation.
- Search result paths in the tool contract are workspace-relative.
- Search result coordinates are 1-based lines and 1-based characters.
- Search explanations must be non-empty single-line strings.
- Search submission validation rejects missing files, paths outside the workspace, out-of-range lines, invalid coordinates, empty or multiline explanations, and exact duplicate locations.
- Validation failures return detailed tool errors so the agent can correct and resubmit results in the same agent turn.
- Quickfix entries include all valid final results; no maximum result cap is enforced in v1.
- Empty search results clear or replace quickfix with an empty Vantage search list and show a notification.
- Normal-mode search requires an explicit prompt. Visual/range search can use a configurable default prompt.
- The default visual/range search prompt is “Find related code paths and explain why they matter.”
- Visual/range search includes a trace seed containing the user request, selected code, file path, and actual 1-based file line numbers.
- Vantage-wide protocol/model/UI coordinates are 1-based. Neovim API adapters convert to 0-based only when calling low-level Neovim APIs.
- Numbered code shown to models uses actual 1-based file line numbers, not scope-relative line numbers.
- Lens inclusion is configurable for explain, question, edit, and search. Annotation always includes lens.
- Default lens inclusion is enabled for explain, and search; disabled for question and edit; always enabled for annotate.
- Vantage uses the configured model target for the SDK runtime. If the configured provider/model cannot be resolved or authorized, Vantage fails clearly instead of silently falling back.
- Credential resolution follows Vantage’s existing fallback order: explicit API key first, then configured auth path, workspace/cwd auth files, Pi default auth, and older Pi auth location where supported.
- A general agent cancel command cancels the currently active agentic backend request.
- Vantage rejects a new search while another agentic request is active.
- Vantage reset is rejected while an agentic request is active.
- The top-level Lua API will expose consistent functions for existing model-backed commands, search, cancel, reset, and status. User commands wrap these public functions.
- Prompt references such as `@file` and `#rule` are out of v1 scope, even though 99 supports them.

## Testing Decisions

- Tests should verify external behavior and command contracts rather than private implementation details.
- Backend protocol tests should cover the new search request and result shapes, 1-based coordinate parsing, and compatibility of existing command responses.
- Prompt/model contract tests should verify 1-based actual file line numbering, lens inclusion defaults, annotation lens behavior, and command-specific prompt context.
- Runtime wrapper tests should cover singleton session reuse, transient annotation sessions, command-specific active tools, configured model resolution, credential resolution, reset behavior, and cancellation behavior.
- Submit-tool tests should cover valid search result acceptance, workspace-relative path validation, out-of-workspace rejection, missing file rejection, line bound rejection, invalid character rejection, duplicate rejection, empty explanation rejection, multiline explanation rejection, and precise error messages for agent retry.
- Lua command tests should cover `VantageSearch`, public Lua search invocation, normal-mode prompt requirement, visual/range default prompt behavior, quickfix population, empty result behavior, active-request rejection, cancel command behavior, and reset-while-active rejection.
- Neovim integration tests should verify 1-based to 0-based conversion at edit application, annotation extmark rendering, selected/range context capture, and quickfix entry creation.
- Existing tests for explain, question, edit, annotate, and search should remain behaviorally valid after migrating the runtime path.
- Prior art includes the existing backend command tests, protocol tests, Pi runtime tests, stdio cancellation tests, model-contract tests, and Neovim headless command tests.

## Out of Scope

- Prompt references such as `@file`, `#rule`, or symbol completions.
- Persistent buddy sessions across Neovim/backend restarts.
- Parallel agentic requests.
- Direct agent file mutation via edit/write tools.
- A detail panel for rich per-result explanations.
- Reopening previous search results after quickfix is closed.
- Search status command.
- LSP or Tree-sitter-powered search tools.
- Worktree-based agent execution.
- Always-on background inference or ambient flow monitoring.
- Result caps, ranking UI, or filters in v1.
- Full autonomous “vibe coding” behavior.

## Further Notes

This feature intentionally ports the strongest product primitive from 99: agentic reasoning should become native editor navigation. Vantage differs by using a structured custom tool contract, stronger validation, a singleton buddy memory model, command-specific active tools, and a consistent 1-based coordinate convention.

The implementation should preserve the existing Vantage philosophy: developers move quickly, but stay close to the code, intent, and final applied changes. Search is not a chat transcript; it is a navigable comprehension artifact.