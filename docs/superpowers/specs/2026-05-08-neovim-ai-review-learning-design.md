# Neovim AI Review And Learning Tool Design

Date: 2026-05-08

## Context

This repository started as an AI-assisted LSP prototype with a TypeScript language server, a VS Code client, CodeLens experiments, OpenAI completions, and local embeddings/RAG exploration. The desired product has shifted toward a Neovim-first developer experience for code review and learning. Editor agnosticism is not a v1 priority.

The v1 design should prioritize a usable Neovim workflow over preserving LSP as the central integration boundary.

## Goals

- Help developers understand unfamiliar syntax, semantics, and code concepts while reading code.
- Help developers review code through a specific lens, such as idempotency, security, API compatibility, or relation to an intended change.
- Keep the experience command-driven, explicit, and quiet by default.
- Make Neovim the primary editor target.
- Use an AI provider abstraction from day one so cloud and local backends can be swapped later.
- Leave room for future agentic workflows without making simple commands agent-driven.

## Non-Goals

- Building a general editor-agnostic LSP experience for v1.
- Building every learning and review command variant in the first implementation pass.
- Making whole-repository background analysis the default behavior.
- Requiring docs/RAG ingestion for the first useful loop.
- Making agent runtimes responsible for simple inline explanation and annotation flows.

## Product Experience

V1 is a Neovim-native AI review and learning tool.

The user interacts through explicit commands. They can set an optional session lens, such as "I am learning Elixir syntax" or "review this change for idempotency." Commands inherit the active lens unless the user provides an inline override.

The first command set is intentionally small:

- `Explain selection`: explain selected code in the lens context.
- `Toggle annotations`: show or hide ephemeral annotations for the visible window or current function.
- `Set lens`: configure the current learning or review context.
- `Review current hunk`: review the current git hunk against the active or inline lens.

Command output opens in floating markdown windows. Inline annotations use virtual text/extmarks and are scoped to the visible window or current function for v1. Current-function scope should use Tree-sitter when available and fall back to the visible window when function detection is unavailable. This keeps the product responsive and makes annotation ergonomics easy to revise after actual use.

## Architecture

V1 should pivot away from "AI LSP" as the primary product shape.

The architecture has two main parts:

- A Neovim Lua plugin owns the developer experience: commands, keymaps, visual selection capture, floating markdown windows, virtual text annotations, and active lens lifecycle.
- A backend service owns heavier logic: context assembly, git diff/hunk extraction, prompt construction, model/provider calls, caching, response validation, and future agent-runtime delegation.

The LSP protocol is not the v1 integration boundary. Existing TypeScript server and embeddings code may be mined for useful pieces, but the primary interface should be a simple local protocol between the plugin and backend.

The transport can be stdio or localhost JSON-RPC. Planning should choose the simplest reliable option for Neovim process management and testability. Conceptually, the plugin sends structured requests and receives structured markdown, annotation, and finding responses.

## Provider Strategy

The provider layer should be abstracted from day one.

Simple commands use a direct model adapter owned by this project. The project owns context building, prompts, response schemas, annotations, and review logic for those flows.

The design should reserve a separate agent-runtime boundary for larger future workflows. A future opencode or pi-agent-style adapter can receive higher-level tasks, but it should not be required for v1 commands like `Explain selection`, `Toggle annotations`, or `Review current hunk`.

## Context Strategy

V1 context defaults to current buffer plus git change context.

For learning commands, the backend should include:

- Selected text or visible/current-function code.
- File path and language.
- Nearby lines around the range.
- Active lens and inline override, if provided.

For review commands, the backend should additionally include:

- Current hunk.
- Surrounding function or local scope when available.
- Branch diff summary when useful.
- Touched-file metadata when useful.

Docs/RAG should remain outside the first default path. The existing embeddings work can inform future learning-material retrieval, but v1 should not depend on it.

## Command Data Flow

### Explain Selection

1. Lua plugin captures file path, language, cursor/range, selected text, active lens, and optional inline override.
2. Backend builds context from selected text and nearby buffer lines.
3. Backend adds git context if useful, such as current hunk, branch diff summary, and touched-file metadata.
4. Provider adapter generates a concise markdown explanation.
5. Plugin renders the response in a floating markdown window.

### Toggle Annotations

1. Plugin asks backend to annotate the visible range or current function, using the visible range as the fallback scope.
2. Backend segments the range into meaningful spans.
3. Backend returns structured annotations with line/range, category, short virtual text, and optional longer markdown detail.
4. Plugin renders annotations through virtual text/extmarks and can open detail in a float.

### Review Current Hunk

1. Plugin identifies the current hunk or asks backend to resolve it from git diff.
2. Backend builds review context from the hunk, surrounding function, active review lens, and related touched files.
3. Provider returns structured findings plus markdown.
4. Plugin renders a float with findings and can place lightweight markers on relevant lines.

## Response Contracts

Backend responses should be structured before they reach Neovim.

`Explain selection` returns:

- Markdown body.
- Lens used.
- Context summary.
- Request metadata useful for debugging.

`Toggle annotations` returns:

- Annotation list.
- Each annotation has a range, short text, category, optional severity, and optional markdown detail.
- A response version or request id so stale responses can be ignored.

`Review current hunk` returns:

- Markdown summary.
- Structured findings.
- Each finding has a range when possible, title, explanation, confidence, and category.
- Lens used and context summary.

## Error Handling And UX Constraints

The tool should fail quietly and specifically:

- Missing provider config: show a short float explaining what env var or config is missing.
- No git repo or no hunk: explain that review commands need git context, while learning commands still work.
- Slow request: show cancellable progress and ignore stale responses if the buffer changed.
- Bad or empty AI response: show a concise failure with request metadata, not a stack trace.
- Annotation overload: cap annotations per visible range and prefer fewer, higher-signal notes.
- Lens ambiguity: display the active lens in command output headers so hidden context is visible.

The plugin should never spam the buffer. Annotations are opt-in, scoped, and disposable. Floats are the primary surface for anything longer than a short sentence.

## Testing Strategy

Backend tests should cover:

- Context builder includes selected code, nearby lines, and git hunk data correctly.
- Provider abstraction works with a fake provider.
- Annotation responses are validated before reaching the client.
- Review output parsing handles malformed model responses.

Plugin tests should cover:

- Commands collect the right selection, range, cursor, file, and lens data.
- Floating windows render markdown responses.
- Extmarks are added, updated, and cleared.
- Stale async responses do not overwrite newer annotations.

## Milestones

1. Prove the end-to-end loop with fake provider responses.
2. Add a real direct provider adapter behind the abstraction.
3. Add git-aware review context for `Review current hunk`.
4. Tune annotation ergonomics through actual Neovim use.

## Open Decisions For Implementation Planning

- Choose stdio or localhost JSON-RPC transport.
- Choose initial backend runtime reuse: adapt the existing TypeScript server or start a cleaner backend package.
- Choose the first real direct provider implementation.
- Choose how much Neovim plugin testing to automate in v1.
