# vantage.nvim

vantage.nvim is a Neovim-first AI review and learning assistant.

The current architecture is a Lua Neovim plugin plus a local TypeScript backend. The plugin owns commands, floating markdown windows, and virtual text annotations. The backend owns request contracts and agent runtime behavior.

## Commands

- `:VantageSetLens learning I am learning Elixir syntax`
- `:VantageClearLens`
- `:VantageExplain`
- `:VantageQuestion why is this function recursive?`
- `:VantageEdit rename value to count`
- `:VantageAnnotate`
- `:VantageAnnotationClear`
- `:VantageAnnotationStatus`
- `:VantageContextStatus`
- `:VantageAgentStatus`
- `:VantageAgentReset`
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
      agent = {
        provider = "openai",
        model = "gpt-4o-mini",
      },
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
  agent = {
    provider = "openai",
    model = "gpt-4o-mini",
  },
})
```

### Native Packages

```bash
git clone --branch dist https://github.com/napisani/vantage-nvim \
  "${XDG_DATA_HOME:-$HOME/.local/share}/nvim/site/pack/vantage/start/vantage.nvim"
cd "${XDG_DATA_HOME:-$HOME/.local/share}/nvim/site/pack/vantage/start/vantage.nvim"
npm ci --omit=dev
```

## Agent Runtime

Vantage uses Pi through `@earendil-works/pi-ai` as its agent runtime. The public `agent.provider` and `agent.model` fields are the Pi model target, for example `openai/gpt-4o-mini` or `anthropic/claude-sonnet-4`.

```lua
require("vantage").setup({
  agent = {
    provider = "openai",
    model = "gpt-4o-mini",
    -- auth = {
    --   path = vim.fn.expand("~/.config/pi/auth.json"),
    -- },
    session = {
      enabled = true,
      max_turns = 12,
      cacheRetention = "short",
    },
    options = {
      temperature = 0.1,
      maxTokens = 1024,
      timeoutMs = 300000,
      -- apiKey = "sk-...",
    },
  },
})
```

If `agent.options.apiKey` is set, Vantage passes it to Pi. If it is omitted, Vantage tries to resolve Pi OAuth credentials for OAuth-backed providers from `agent.auth.path`, `<workspace>/auth.json`, `./auth.json`, `~/.config/pi/auth.json`, then `~/.config/pi-ai/auth.json`. If no Pi OAuth credentials are found, Vantage leaves credentials unset so Pi can still use provider auth such as `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, Google ADC, or AWS credentials.

For subscription-backed providers such as `openai-codex`, log in with Pi once. If Pi writes `auth.json` to the current directory, move it to the default Pi config path:

```bash
npx @earendil-works/pi-ai login openai-codex
mkdir -p ~/.config/pi
mv auth.json ~/.config/pi/auth.json
```

```lua
require("vantage").setup({
  agent = {
    provider = "openai-codex",
    model = "gpt-5.3-codex",
    options = {
      reasoning = "medium",
    },
  },
})
```

`openai-codex` rejects `temperature`; Vantage strips that option for Codex model targets even if it is present in shared `agent.options`.

Do not commit Pi OAuth auth files. This repository ignores `auth.json` by default because it can contain refresh tokens.

Vantage Agent Sessions are enabled by default. The backend keeps in-memory conversation state scoped by workspace root, model target, and lens mode, then passes a stable Pi `sessionId` for session affinity and provider-side cache reuse. Explain, question, edit, annotate, and review commands share the same scoped session. The history window is bounded by `agent.session.max_turns` and is not persisted across Neovim/backend restarts.

## Configuration Reference

The Lua config is documented with `---@class` annotations in `lua/vantage/state.lua` so Lua language servers can complete fields from `VantageConfig`.

```lua
---@type VantageConfig
require("vantage").setup({
  agent = {
    provider = "openai",
    model = "gpt-4o-mini",
    auth = {
      path = vim.fn.expand("~/.config/pi/auth.json"),
    },
    session = {
      enabled = true,
      max_turns = 12,
      cacheRetention = "short",
    },
    options = {
      temperature = 0.1,
      maxTokens = 1024,
      timeoutMs = 300000,
      reasoning = "medium",
      -- apiKey = "sk-...",
    },
    trace = {
      prompt_path = ".nvim-dev/trace/pi-prompt.txt",
      response_path = ".nvim-dev/trace/pi-response.txt",
    },
  },
  commands = {
    explain = {
      options = {},
    },
    question = {
      options = {},
    },
    edit = {
      options = {},
    },
    annotate = {
      waiting_message_ms = 30000,
      options = {
        maxTokens = 256,
        timeoutMs = 300000,
      },
    },
    review = {
      options = {},
    },
  },
  agent_context = {
    enabled = true,
    path = ".vantage/agent-context.md",
    max_bytes = 12000,
    max_age_ms = nil,
  },
})
```

Config groups:

- `agent.provider`: Pi provider name, default `openai`.
- `agent.model`: Pi model name, default `gpt-4o-mini`.
- `agent.auth.path`: optional Pi OAuth `auth.json` path. If omitted, Vantage checks `<workspace>/auth.json`, `./auth.json`, `~/.config/pi/auth.json`, then `~/.config/pi-ai/auth.json`.
- `agent.session`: Vantage-owned in-memory Agent Session settings. `enabled` turns scoped sessions on or off, `max_turns` bounds retained successful command turns, and `cacheRetention` is passed to Pi as `none`, `short`, or `long`.
- `agent.options`: Pi call options using Pi SDK-style camelCase keys, including `apiKey`, `temperature`, `maxTokens`, `timeoutMs`, `maxRetries`, `maxRetryDelayMs`, `reasoning`, `metadata`, and `headers`.
- `agent.trace`: optional prompt and response trace paths.
- `commands.annotate.waiting_message_ms`: when to show a still-waiting annotation notification.
- `commands.*.options`: command-specific Pi options layered over `agent.options`.
- `agent_context`: workspace task snapshot settings.

The active lens and command scope take precedence over Agent Task Context, and command-specific options take precedence over shared `agent.options`.

## Agent Task Context

Vantage can use task context produced by an adjacent coding agent such as Codex, Claude Code, opencode, or Pi. The integration is artifact-first: the adjacent agent writes a compact Markdown snapshot at `.vantage/agent-context.md`, and Vantage reads it when present. If the file is absent, Vantage commands work normally without the extra context.

The context file is workspace/session state and should not be committed. This repository ignores `.vantage/agent-context.md` by default.

### Configure Adjacent Agents

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

Use `:VantageContextStatus` to see whether Vantage found, included, skipped, or truncated the context file for the current workspace. Then use normal commands such as `:VantageExplain`, `:VantageQuestion`, `:VantageEdit`, `:VantageAnnotate visible`, and `:VantageReviewHunk`; Vantage includes the snapshot automatically when it is available.

When Agent Sessions are enabled, Vantage tracks the context file revision and injects an Agent Context update turn only when the file changes for the current scoped session. The active lens still has higher precedence than the adjacent-agent context.

See `docs/agent-context.md` for the full artifact convention and design notes. Tool-specific instruction docs are available from Codex, Claude Code, and opencode:

- Codex: <https://developers.openai.com/codex/guides/agents-md>
- Claude Code: <https://docs.anthropic.com/en/docs/claude-code/memory>
- opencode: <https://dev.opencode.ai/docs/rules/>

## Development

Install dependencies:

```bash
npm install
```

Run the full local test suite:

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

Run the annotation e2e test through the bundled stdio backend with the deterministic development agent runtime:

```bash
make e2e-annotations
```

This writes `.nvim-dev/e2e/annotations.json` with the extmarks Neovim rendered.

## Manual Neovim Smoke Test

Compile the backend:

```bash
npm run compile
```

Open Neovim with only the repo-local development config:

```bash
make run
```

The repo-local development config uses the internal development agent runtime by default so command plumbing is visible without starting a model request.

Open Neovim with the Pi agent runtime:

```bash
make run-pi
```

`make run-pi` defaults to `openai/gpt-4o-mini`, a five-minute general request timeout, and a five-minute annotation timeout. Override them when needed:

```bash
make run-pi PI_PROVIDER=openai PI_MODEL=gpt-4o-mini PI_ANNOTATION_TIMEOUT_MS=45000
```

Manual Pi runs write `.nvim-dev/trace/pi-prompt.txt` when a request starts and `.nvim-dev/trace/pi-response.txt` when Pi returns.

Open a specific file:

```bash
make run FILE=path/to/file.lua
```

Then run:

```vim
:VantageSetLens learning I am learning Lua syntax
:VantageExplain
:VantageQuestion why is this line useful?
:VantageEdit simplify this line
:VantageAnnotate
:VantageAnnotationClear
:VantageAgentStatus
:VantageAgentReset
```

`:VantageExplain` asks the active agent runtime to explain the current line. It also accepts Vim line ranges:

```vim
:10,20VantageExplain
:'<,'>VantageExplain
```

`:VantageQuestion {question}` asks a specific question about the current line. It also accepts Vim line ranges:

```vim
:VantageQuestion why is this value immutable?
:10,20VantageQuestion what is the data flow here?
:'<,'>VantageQuestion what should I notice in this selection?
```

`:VantageEdit {instruction}` asks the active agent runtime for a single replacement of the current line. It also accepts Vim line ranges and replaces only the requested range:

```vim
:VantageEdit rename value to count
:10,20VantageEdit simplify this branch
:'<,'>VantageEdit convert this to early returns
```

`:VantageAnnotate` asks the active agent runtime to annotate the current line, visible window, or explicit line range. New annotations are additive; an annotation returned for the exact same buffer position replaces the older annotation at that position. `:VantageAnnotationClear` removes all vantage.nvim annotations from the current buffer.

`:VantageContextStatus` opens a status float for the current workspace's Agent Context File. It reports the resolved path, whether the file was included, size and included bytes, freshness, truncation, and read errors when relevant.

`:VantageAgentStatus` opens a status float for the current Vantage Agent Session. `:VantageAgentReset` clears that session. The session scope is workspace root plus model target plus lens mode, so explain, question, edit, annotate, and review share context without mixing separate workspaces or lens modes.

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
