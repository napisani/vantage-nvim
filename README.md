# vantage.nvim

This project is being reworked into a Neovim-first AI review and learning tool.

The current architecture is a Lua Neovim plugin plus a local TypeScript backend. The plugin owns commands, floating markdown windows, and virtual text annotations. The backend owns request contracts and provider behavior.

## Commands

- `:VantageSetLens learning I am learning Elixir syntax`
- `:VantageClearLens`
- `:VantageExplain`
- `:VantageAnnotate`
- `:VantageAnnotationClear`
- `:VantageContextStatus`
- `:VantageReviewHunk`

## Installation

vantage.nvim needs Neovim 0.10+ and Node.js 22+. Install from the generated `dist` branch, which contains the Lua plugin and compiled Node backend. After your plugin manager clones the repo, run `npm ci --omit=dev` in the plugin directory so runtime Node dependencies are available.

### lazy.nvim

```lua
{
  "napisani/vantage-nvim",
  name = "vantage.nvim",
  branch = "dist",
  build = "npm ci --omit=dev",
  config = function()
    require("vantage").setup({
      provider = { name = "fake" },
    })
  end,
}
```

### vim-plug

```vim
Plug 'napisani/vantage-nvim', { 'branch': 'dist', 'do': 'npm ci --omit=dev' }
```

Then configure vantage.nvim from your Lua config:

```lua
require("vantage").setup({
  provider = { name = "fake" },
})
```

### Native Packages

```bash
git clone --branch dist https://github.com/napisani/vantage-nvim \
  "${XDG_DATA_HOME:-$HOME/.local/share}/nvim/site/pack/vantage/start/vantage.nvim"
cd "${XDG_DATA_HOME:-$HOME/.local/share}/nvim/site/pack/vantage/start/vantage.nvim"
npm ci --omit=dev
```

### Provider Configuration

The installed plugin starts the bundled stdio backend automatically. With `provider.name = "fake"`, commands use deterministic local responses and require no model setup.

Use Codex CLI:

```lua
require("vantage").setup({
  provider = {
    name = "codex",
    codex = {
      command = "codex",
      model = "gpt-5.4-mini",
    },
  },
})
```

Codex uses your existing `codex` CLI login.

Use Ollama:

```lua
require("vantage").setup({
  provider = {
    name = "ollama",
    ollama = {
      base_url = "http://localhost:11434",
      model = "qwen3:1.7b",
    },
  },
})
```

Use ChatGPT through the OpenAI SDK:

```lua
require("vantage").setup({
  provider = {
    name = "chatgpt",
    chatgpt = {
      model = "gpt-4o-mini",
      -- api_key = "sk-...", -- optional; falls back to OPENAI_API_KEY
    },
  },
})
```

Use Pi through `@earendil-works/pi-ai`:

```lua
require("vantage").setup({
  provider = {
    name = "pi",
    pi = {
      provider = "openai",
      model = "gpt-4o-mini",
      -- api_key = "sk-...", -- optional; falls back to OPENAI_API_KEY for openai
    },
  },
})
```

For `pi.provider = "anthropic"`, `pi.api_key` falls back to `ANTHROPIC_API_KEY`. Timeout and trace fields are also available for each provider, for example `timeout_ms`, `annotation_timeout_ms`, `trace_prompt_path`, and `trace_response_path`.

### Configuration Reference

The Lua config is documented with `---@class` annotations in `lua/vantage/state.lua` so Lua language servers can complete fields from `VantageConfig`.

```lua
---@type VantageConfig
require("vantage").setup({
  provider = {
    name = "fake", -- "fake" | "codex" | "ollama" | "chatgpt" | "pi"
  },
  annotations = {
    waiting_message_ms = 30000,
  },
  agent_context = {
    enabled = true,
    path = ".vantage/agent-context.md",
    max_bytes = 12000,
    max_age_ms = nil,
  },
})
```

Provider-specific fields:

- `codex`: `command`, `model`, `timeout_ms`, `annotation_timeout_ms`, `trace_prompt_path`, `trace_response_path`
- `ollama`: `base_url`, `model`, `timeout_ms`, `annotation_timeout_ms`, `trace_prompt_path`, `trace_response_path`
- `chatgpt`: `api_key`, `model`, `timeout_ms`, `annotation_timeout_ms`, `trace_prompt_path`, `trace_response_path`
- `pi`: `api_key`, `provider`, `model`, `timeout_ms`, `annotation_timeout_ms`, `trace_prompt_path`, `trace_response_path`

### Agent Task Context

Vantage can use task context produced by an adjacent coding agent such as Codex, Claude Code, opencode, or Pi. The integration is artifact-first: the adjacent agent writes a compact Markdown snapshot at `.vantage/agent-context.md`, and Vantage reads it when present. If the file is absent, Vantage commands work normally without the extra context.

The context file is workspace/session state and should not be committed. This repository ignores `.vantage/agent-context.md` by default.

#### Configure adjacent agents

For personal Vantage usage, put the instruction in your agent's user-level rules so it follows you across repositories without changing team-shared project instructions:

| Agent | Personal instruction file |
| --- | --- |
| Codex | `~/.codex/AGENTS.md` |
| Claude Code | `~/.claude/CLAUDE.md` or a user-level rule under `~/.claude/rules/` |
| opencode | `~/.config/opencode/AGENTS.md` |

If a whole team wants the same behavior, put the same instruction in the repository's agent instructions instead. Use `AGENTS.md` for Codex and opencode, and `CLAUDE.md` for Claude Code. Claude Code reads `CLAUDE.md`, not `AGENTS.md`, but a `CLAUDE.md` file can import `AGENTS.md` with `@AGENTS.md`.

Keep the generated artifact local. For a personal-only setup, add it to `.git/info/exclude` in each workspace:

```gitignore
.vantage/agent-context.md
```

For a team setup, commit that ignore rule to `.gitignore`.

Copy this instruction into the adjacent agent configuration you chose:

```md
## Workspace Task Snapshot

If `.vantage/` exists in the current workspace, maintain `.vantage/agent-context.md` as a compact snapshot of the active task.

Create `.vantage/agent-context.md` if it is missing. Rewrite the file when task state materially changes; do not append a running log or transcript.

Keep the snapshot concise, current, and under 12 KB when practical. Do not include secrets, credentials, raw conversation, or unrelated project documentation.

Use this structure:

# Agent Task Context

## Goal

## Current Focus

## Relevant Files

## Decisions

## Constraints

## Open Questions

## Recent Progress

Update it after meaningful changes: plan changes, important files or constraints are discovered, decisions are made, tests pass/fail in a relevant way, or before handing control back to the user.

Do not update it after every command, file read, or tool call.
```

Vantage gives the active command scope and lens higher priority than Agent Task Context. Use the context file for task state, not for overriding the user's selected lens or asking Vantage to inspect unrelated files.

Use `:VantageContextStatus` to see whether Vantage found, included, skipped, or truncated the context file for the current workspace. Then use normal commands such as `:VantageExplain`, `:VantageAnnotate visible`, and `:VantageReviewHunk`; Vantage includes the snapshot automatically when it is available.

See `docs/agent-context.md` for the full artifact convention and design notes. Tool-specific instruction docs are available from Codex, Claude Code, and opencode:

- Codex: <https://developers.openai.com/codex/guides/agents-md>
- Claude Code: <https://docs.anthropic.com/en/docs/claude-code/memory>
- opencode: <https://dev.opencode.ai/docs/rules/>

## Development

Install dependencies:

```bash
npm install
```

Run the MVP tests:

```bash
make test
```

Run backend tests only:

```bash
npm run test:backend
```

Run headless Neovim tests only:

```bash
npm run test:nvim
```

Run the annotation e2e test through the stdio backend with a deterministic Codex CLI stub:

```bash
make e2e-annotations
```

This writes `.nvim-dev/e2e/annotations.json` with the extmarks Neovim rendered, `.nvim-dev/e2e/codex-prompt.txt` with the prompt sent to the provider, and `.nvim-dev/e2e/codex-response.txt` with the raw provider response.

## Manual Neovim Smoke Test

Compile the backend:

```bash
npm run compile
```

Open Neovim with only the repo-local development config:

```bash
make run
```

The repo-local development config uses the in-process fake provider by default so command plumbing is visible without starting a model or backend process.

Open Neovim with the Codex CLI provider:

```bash
make run-codex
```

`make run-codex` reuses your existing `codex` CLI SSO login. It defaults to `gpt-5.4-mini`, a five-minute general request timeout, and a 30-second annotation timeout. Override them when needed:

```bash
make run-codex CODEX_MODEL=gpt-5.4-mini CODEX_TIMEOUT_MS=600000 CODEX_ANNOTATION_TIMEOUT_MS=45000
```

Manual Codex runs write `.nvim-dev/trace/codex-prompt.txt` when a request starts and `.nvim-dev/trace/codex-response.txt` when Codex returns. If Neovim shows `Vantage: still waiting for annotations` and only the prompt file exists, the request is still inside the Codex CLI.

Open Neovim with the Codex provider plumbing but deterministic local responses:

```bash
make run-codex-stub
```

Open Neovim with the Ollama provider:

```bash
ollama pull qwen3:1.7b
make run-ollama
```

`make run-ollama` uses `qwen3:1.7b` by default, expects Ollama at `http://localhost:11434`, and gives annotation requests a 20-second timeout. Override them when needed:

```bash
make run-ollama OLLAMA_MODEL=qwen3:1.7b OLLAMA_BASE_URL=http://localhost:11434 OLLAMA_ANNOTATION_TIMEOUT_MS=30000
```

Manual Ollama runs write `.nvim-dev/trace/ollama-prompt.txt` when a request starts and `.nvim-dev/trace/ollama-response.txt` when Ollama returns.

Open Neovim with the ChatGPT provider through the official OpenAI Node SDK:

```bash
OPENAI_API_KEY=... make run-chatgpt
```

`make run-chatgpt` defaults to `gpt-4o-mini`, a five-minute general request timeout, and a 30-second annotation timeout. Override them when needed:

```bash
make run-chatgpt CHATGPT_MODEL=gpt-4o-mini CHATGPT_ANNOTATION_TIMEOUT_MS=45000
```

The provider uses the OpenAI SDK's Responses API. Manual ChatGPT runs write `.nvim-dev/trace/chatgpt-prompt.txt` when a request starts and `.nvim-dev/trace/chatgpt-response.txt` when the provider returns.

Open Neovim with the Pi provider:

```bash
OPENAI_API_KEY=... make run-pi
```

`make run-pi` defaults to `openai/gpt-4o-mini`, a five-minute general request timeout, and a 30-second annotation timeout. Override them when needed:

```bash
make run-pi PI_PROVIDER=openai PI_MODEL=gpt-4o-mini PI_ANNOTATION_TIMEOUT_MS=45000
```

Manual Pi runs write `.nvim-dev/trace/pi-prompt.txt` when a request starts and `.nvim-dev/trace/pi-response.txt` when the provider returns.

Run the annotation e2e test against your real Codex CLI login:

```bash
make e2e-annotations-real
```

The real e2e target writes `.nvim-dev/e2e/annotations-real.json`, `.nvim-dev/e2e/codex-prompt-real.txt`, and `.nvim-dev/e2e/codex-response-real.txt`.
It waits up to 30 seconds by default; override that with `E2E_WAIT_MS=60000` if your Codex calls are slower.

Run the annotation e2e test against local Ollama:

```bash
make e2e-annotations-ollama E2E_WAIT_MS=60000
```

The Ollama e2e target writes `.nvim-dev/e2e/annotations-ollama.json`, `.nvim-dev/e2e/ollama-prompt.txt`, and `.nvim-dev/e2e/ollama-response.txt`.

Run the annotation e2e test against ChatGPT:

```bash
OPENAI_API_KEY=... make e2e-annotations-chatgpt E2E_WAIT_MS=60000
```

The ChatGPT e2e target writes `.nvim-dev/e2e/annotations-chatgpt.json`, `.nvim-dev/e2e/chatgpt-prompt.txt`, and `.nvim-dev/e2e/chatgpt-response.txt`.

Open a specific file:

```bash
make run FILE=path/to/file.lua
```

Then run:

```vim
:VantageSetLens learning I am learning Lua syntax
:VantageExplain
:VantageAnnotate
:VantageAnnotationClear
```

`:VantageExplain` asks the active provider to explain the current line. It also accepts Vim line ranges:

```vim
:10,20VantageExplain
:'<,'>VantageExplain
```

`:VantageAnnotate` asks the active provider to annotate the current line, visible window, or explicit line range. New annotations are additive; an annotation returned for the exact same buffer position replaces the older annotation at that position. `:VantageAnnotationClear` removes all vantage.nvim annotations from the current buffer.

`:VantageContextStatus` opens a status float for the current workspace's Agent Context File. It reports the resolved path, whether the file was included, size and included bytes, freshness, truncation, and read errors when relevant.

`VantageAnnotate` accepts simple scope and budget arguments:

```vim
:VantageAnnotate
:VantageAnnotate line
:VantageAnnotate visible
:VantageAnnotate visible 10
```

With no arguments, `VantageAnnotate` annotates only the current line. `line` is an explicit form of the same behavior. `visible` annotates the currently visible buffer lines, equivalent to selecting those lines and running `VantageAnnotate`. A numeric argument sets the maximum annotation budget for that request, which is most useful with `visible` or a Vim line range.

`VantageAnnotate` also accepts Vim line ranges:

```vim
:10,20VantageAnnotate
:'<,'>VantageAnnotate
:'<,'>VantageAnnotate 5
```
