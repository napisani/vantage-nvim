# Vantage Improvements Running Doc

Status: living discussion document  
Created: 2026-06-12

## Purpose

Capture and pressure-test a set of medium-to-large Vantage product ideas before turning any of them into implementation plans. This doc is intentionally opinionated but provisional: each idea has a strawman, a steelman, complexity risks, usability upside, and a suggested priority.

The north star stays the same: Vantage should be an explicit Neovim buddy that helps developers stay close to code, not an autonomous coding replacement.

## External Reference Points

### ThePrimeagen/99

99 is useful as a guide because it embraces a few principles that fit Vantage:

- Prompt capture can be richer than `vim.ui.input` without becoming a full chat app.
- The highest-value workflow is search/navigation output into native editor artifacts, especially quickfix.
- Requests are concrete objects with state, output, logs, and replay/open affordances.
- Prior interactions are visible and reopenable. Users can inspect what happened rather than treating model calls as invisible black boxes.
- Completion is optional and adapter-based (`native`, `cmp`, `blink`) instead of hard-coupled to one completion plugin.

99 is also a warning:

- Hand-rolled agent/session lifecycle grows quickly.
- Persisted request/session state becomes product surface area, not an implementation detail.
- Rich prompt buffers can sprawl if they try to become a universal agent frontend too early.

### PromptBuilder in `~/.config/home-manager`

The local PromptBuilder concept is a strong reference for prompt authoring:

- One staging buffer, opened/focused on demand.
- Markdown scratch buffer with `b:prompt_builder = true` marker.
- Append operations for references and freeform text.
- Submit action sends the whole buffer, then wipes it.
- Completion sources are scoped to PromptBuilder buffers only.
- `blink.cmp` integrations are optional and should not affect ordinary markdown buffers.

This maps well to Vantage if we treat the prompt authoring buffer as a command input surface, not as an always-on chat pane.

## Priority Summary

| Idea | Usability upside | Complexity | Suggested priority | Why |
|---|---:|---:|---|---|
| 1. Prompt authoring buffer | High | Medium | P1 | Improves every prompted command and enables explicit context references later. |
| 2. Explain output formatting/config | High | Low-Medium | P0/P1 | Directly improves daily readability with low architectural risk. |
| 3. `VantageSessionOutput` | High | Medium | P1 | Makes agent behavior inspectable; complements status and debugging. |
| 4. Session lifecycle/resume | Medium-High | High | P2 | Valuable, but persistence semantics are tricky and should follow output inspection. |
| 5. Shared session/context with Pi TUI + tmux | Potentially high | Very High | Research/P3 | Powerful but likely coupled to Pi internals and cross-process coordination. |

Recommended sequencing:

1. Improve explain/output rendering first.
2. Add session output inspection.
3. Add prompt authoring buffer.
4. Revisit resumable sessions once session output tells us what state users expect to preserve.
5. Treat Pi TUI shared-session/tmux integration as research until Pi exposes a stable session API or file contract.

## Idea 1: Prompt Authoring Improvements

### User-facing goal

Replace one-line prompts with a rich, editable floating or split buffer for commands that need non-trivial instructions. Include optional completion for file references, skills/rules, and possibly command-specific snippets.

### Strawman

Add `:VantagePrompt` or make `:VantageQuestion`, `:VantageEdit`, and `:VantageSearch` open a scratch buffer when no inline prompt is provided. The buffer is markdown, supports `@file` references, and submits with `<C-g>` or a command. Completion uses `blink.cmp` if present, otherwise no completion.

### Steelman

A Vantage prompt buffer becomes the central authoring surface for all explicit model calls. It can stage:

- freeform instructions
- current file or visual selection references
- `@relative/path` file references
- future `/skill` or `#rule` references
- command mode metadata: question/edit/search/explain

It gives users time to edit intent before spending model calls. It also aligns with Vantage's buddy philosophy: explicit prompt authoring over ambient inference.

### What 99 suggests

99 shows that prompt capture and reference completion can be a major usability lever. Its optional completion provider design is the right shape: native/cmp/blink should be adapters, not hard dependencies.

### What PromptBuilder suggests

Start with a single marked buffer and narrowly scoped completion. Keep it a staging area. Do not turn it into a persistent chat UI at first.

### Complexity risks

- Completion compatibility: blink/cmp/native integrations can become support burden.
- Prompt reference expansion needs a stable contract, otherwise the model sees ambiguous text.
- Floating buffer UX can conflict with existing floats/status/output windows.
- Different commands need different submit behavior and validation.

### Pressure test

Questions before implementation:

1. Should the prompt buffer be a floating window, bottom split, or configurable?
2. Is it only used when prompt text is omitted, or can users explicitly open it for any command?
3. Should submit wipe the buffer, keep history, or preserve it until success?
4. Are `@file` references included in v1, or do we start with plain text only?
5. What is the minimal completion story if blink is absent?

### Recommendation

P1, but not first. Build after output/session inspection basics. Start with a small `VantagePrompt`/prompt-buffer primitive and use it for `Question` and `Search` before expanding to edit.

## Idea 2: Explain Output Formatting and Configurability

### User-facing goal

Make `:VantageExplain` output easier to read: wrapped text, predictable width, better markdown rendering defaults, and user-configurable output window behavior.

### Strawman

Set `wrap`, `linebreak`, a better width, and maybe `conceallevel`/markdown options in the Vantage output float. Add config fields for output width/height/border/wrap.

### Steelman

Vantage's most common command should feel polished. If Explain produces dense or poorly wrapped text, users will trust the whole tool less. A small output surface abstraction can also benefit status, question, session output, and future prompt previews.

### What 99 suggests

99 invests in windows as core UX. It has active/status windows and open/reopen behavior. Native editor artifacts matter as much as model quality.

### Complexity risks

- Low if kept to display options.
- Medium if we build a full markdown renderer, syntax folding, or complex window manager.
- Some settings may need per-command defaults: explain output differs from status or session output.

### Pressure test

Questions before implementation:

1. Should output be a floating window, split, or configurable globally?
2. Should wrapping be on by default for all markdown floats or only explain/question?
3. Should users be able to copy/export responses easily?
4. Should markdown be rendered with conceal/folds, or just readable text wrapping?

### Recommendation

P0/P1. This is likely the best value-to-complexity ratio. Implement before bigger session lifecycle work.

## Idea 3: `VantageSessionOutput`

### User-facing goal

Expose the most recent session activity in a command that feels similar to what a user sees in the Pi TUI: messages, tool calls, tool results, request progress, and final assistant output.

### Strawman

Add `:VantageSessionOutput` that opens a markdown buffer showing the last prompt, assistant response, and tool calls from the singleton buddy session. It is read-only and local to the current backend process.

### Steelman

This makes Vantage transparent. When search/edit/explain behaves strangely, users can inspect what the agent did. This is also a prerequisite for meaningful session lifecycle and resume decisions: users need to see what state exists before choosing what to persist or resume.

### What 99 suggests

99 treats previous requests as inspectable things: users can open prior request outputs, quickfix results, and logs. Vantage should not hide agent activity behind a one-shot response float.

### Complexity risks

- Pi coding-agent event/model APIs may not expose exactly the same shape as the TUI.
- Tool call details can be verbose or contain sensitive paths/content.
- We need retention policy: last request only, full session, or bounded event history?
- Needs redaction for API keys/tokens if details include provider metadata.

### Pressure test

Questions before implementation:

1. Should it show only the most recent request or the whole current session?
2. Should it include raw tool inputs/results or summaries by default?
3. Should it live in a scratch buffer, markdown float, or split?
4. Should users be able to jump from tool-read file paths to buffers?
5. Should annotation transient sessions be included or intentionally excluded?

### Recommendation

P1. High usability and debugging value. Build before resume/shared-session work. Start with bounded in-memory output for the current process and make persistence a later decision.

## Idea 4: Session Lifecycle and Resume

### User-facing goal

Let users resume a Vantage buddy session after Neovim/backend restart, at minimum within the same workspace.

### Strawman

Persist the singleton session id and session transcript under `.vantage/sessions/` or the existing Pi session manager location. Add `:VantageSessionResume` to choose or resume the most recent workspace session.

### Steelman

Resumability is key if Vantage is a buddy rather than one-shot command wrapper. Users can build context over time, restart Neovim, and continue. It also enables more ambitious workflows like deliberate project explorations or long-running search/edit iterations.

### What 99 suggests

99 serializes successful request contexts and has prior-request opening. It only syncs successful requests. That is a useful constraint: persist clean, inspectable outcomes first, not arbitrary half-failed agent state.

### Complexity risks

- Session state format and compatibility over time.
- Difference between Vantage-owned transcript and Pi provider/session cache ids.
- Security/privacy of persisted prompts and code snippets.
- Cleanup/retention UI.
- What happens when model/provider/tools/config changed between sessions?

### Pressure test

Questions before implementation:

1. What exactly is resumed: transcript only, Pi SDK session id, tool state, model target, active lens?
2. Where is state stored: project `.vantage`, user data dir, or Pi's session manager?
3. Should resume be automatic per workspace or explicit via command?
4. How do users inspect/delete session history?
5. Should failed/cancelled requests be persisted?

### Recommendation

P2. Valuable, but only after `VantageSessionOutput` exists. Resume without inspectability risks creating invisible sticky context that users cannot understand or control.

## Idea 5: Shared Context/Session With Pi TUI in tmux

### User-facing goal

Support a workflow where Pi TUI runs in one tmux pane and Vantage+nvim runs in another. Vantage prompts could use or contribute to the same context/session visible in Pi TUI.

### Strawman

Expose a config option pointing Vantage at a Pi session id or session file. Vantage loads that session through the Pi SDK and appends its prompt/response turns.

### Steelman

This could make Vantage a true editor-side companion to Pi rather than a separate assistant. The TUI gives rich conversational context, while Vantage gives precise editor context and native Neovim artifacts. In a tmux workflow, the two could reinforce each other: Pi TUI for broad planning, Vantage for scoped code questions, annotations, and search quickfixes.

### What 99 suggests

99's worker/request tracking model shows a lightweight version of this: external agent process plus editor-side request artifacts. But 99 does not require another live TUI sharing exactly the same session. That is the leap in complexity.

### Complexity risks

- Cross-process session locking and race conditions.
- Pi TUI and Vantage may have different active tool sets and system prompts.
- Session file format may be internal, unstable, or not safe for concurrent writes.
- User expectations become subtle: did Vantage see the TUI's latest response? Did the TUI see Vantage's tool call?
- tmux pane discovery/control is another integration surface.

### Pressure test

Questions before implementation:

1. Does Pi SDK expose a stable session resume/open API compatible with TUI sessions?
2. Can two processes safely attach to one session, or must one be read-only?
3. Should Vantage import TUI context without writing back, or fully share the session?
4. Is tmux integration necessary, or is a session id/path enough?
5. What should happen when active tool sets differ?

### Recommendation

Research/P3. Potentially high value, but likely the highest complexity. Do not implement until we understand Pi's session storage and concurrency model. A safer stepping stone is `VantageSessionOutput` plus explicit import/export of context summaries.

## Suggested Near-Term Roadmap

### Phase 1: Polish and inspectability

1. Improve markdown output display defaults and config.
2. Add `VantageSessionOutput` for the most recent session/request activity.

### Phase 2: Better prompt input

3. Add a small Vantage prompt authoring buffer.
4. Add optional completion adapters behind feature detection, starting with file refs.
5. Add blink integration as optional peer behavior, not a dependency.

### Phase 3: Session persistence

6. Persist successful session/request summaries.
7. Add explicit resume command.
8. Add session picker/delete/status controls if needed.

### Phase 4: Pi TUI interop research

9. Investigate Pi SDK/TUI session storage contracts.
10. Prototype read-only import of TUI session context.
11. Only then consider shared writeable sessions.

## Initial Deprioritization Candidates

- Full shared live session with Pi TUI: too much concurrency and hidden-state risk for now.
- Rich PromptBuilder with all reference types in v1: useful, but easy to overbuild.
- Markdown rendering engine beyond basic wrapping/config: likely unnecessary until users hit concrete readability limits.
- Automatic session resume: should remain explicit until users can inspect session state.

## Open Questions For Deeper Discussion

1. Which command should get prompt-buffer authoring first: `Question`, `Search`, or `Edit`?
2. Should `VantageSessionOutput` show raw events or a curated transcript by default?
3. Should session resume be project-local by default, or user-global by default?
4. How much should Vantage mirror Pi TUI output versus creating a Neovim-native representation?
5. Is the long-term mental model closer to 99's request history or Pi's conversation session?
