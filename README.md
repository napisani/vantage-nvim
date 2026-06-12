# vantage.nvim

vantage.nvim is a Neovim-first AI review and learning assistant.

The current architecture is a Lua Neovim plugin plus a local TypeScript backend. The plugin owns commands, floating markdown windows, and virtual annotation blocks. The backend owns request contracts and agent runtime behavior.

## Public API

### Commands

Vantage commands are explicit: model-backed commands only call the backend after a direct command invocation or prompt-buffer submit. For commands that accept a Vim range, visual mode works through Neovim's normal `:'<,'>` range.

Agentic tool access is intentionally narrow. Vantage does not expose Pi `edit` or `write` tools to user-facing commands. Commands that can inspect the project use read-only Pi tools; commands that produce structured Vantage results must submit those results through Vantage-owned submit tools.

| Command | Normal mode | Range / visual mode | Prompt behavior | Agent/session/tools available | Result |
| --- | --- | --- | --- | --- | --- |
| `:VantageSetLens [mode] [text]` | Yes | No | Prompts for lens text when `text` is omitted. | No model call; no agent tools. | Sets the active lens used by later commands. |
| `:VantageClearLens` | Yes | No | None. | No model call; no agent tools. | Clears the active lens. |
| `:VantageExplain` | Yes | Yes: `:10,20VantageExplain`, `:'<,'>VantageExplain` | None; it explains the current line or selected range. | Uses the singleton buddy session with read-only tools: `read`, `grep`, `find`, `ls`. No file mutation tools. | Opens a markdown explanation float. |
| `:VantageQuestion [question]` | Yes | Yes: `:10,20VantageQuestion ...`, `:'<,'>VantageQuestion ...` | If `question` is omitted, opens the floating prompt buffer. | Uses the singleton buddy session with read-only tools: `read`, `grep`, `find`, `ls`. No file mutation tools. | Opens a markdown answer float. |
| `:VantageEdit [instruction]` | Yes | Yes: `:10,20VantageEdit ...`, `:'<,'>VantageEdit ...` | If `instruction` is omitted, opens the floating prompt buffer. | Uses the singleton buddy session with read-only tools plus `submit_edit`. The agent cannot call Pi `edit`/`write`; Vantage applies the submitted replacement only to the requested range. | Replaces only the current line or requested range. |
| `:VantageAnnotate [scope] [max]` | Yes | Yes: `:10,20VantageAnnotate`, `:'<,'>VantageAnnotate` | None. Optional scope is `line`, `visible`, or `buffer`; optional max is a positive integer. | Uses a transient annotation session with `submit_annotations` only. It does not enter buddy-session memory and cannot read or mutate files through tools. | Renders virtual Annotation Blocks above relevant code lines. |
| `:VantageAnnotationClear` | Yes | No | None. | No model call; no agent tools. | Clears Vantage annotations in the current buffer. |
| `:VantageSearch [query]` | Yes | Yes: `:10,20VantageSearch ...`, `:'<,'>VantageSearch ...` | A prompt is required. If `query` is omitted, including for range/visual search, opens the floating prompt buffer. | Uses the singleton buddy session with read-only tools plus `submit_search_results`. Results are curated through Vantage's structured contract; no file mutation tools. | Populates quickfix with final curated search locations. |
| `:VantageStatus` | Yes | No | None. | No model call; no agent tools. Reads local Vantage status only. | Opens the combined Agent Session, Agent Context, and Annotation status float. |
| `:VantageSessionOutput` | Yes | No | None. | No model call; no agent tools. Polls Vantage's in-memory session-output history. | Opens a live-updating session activity float; `r` toggles raw details and `q` closes. |
| `:VantageAgentCancel` | Yes | No | None. | No new model call; aborts the currently active agent request if one exists. | Cancels the active agentic request, if any. |
| `:VantageAgentReset` | Yes | No | None. | No model call; no agent tools. Clears Vantage-owned in-memory state. | Clears the singleton in-memory buddy session and session-output history. |

Prompt buffers are markdown scratch floats. Submit with `<C-g>` and cancel with `<Esc>` by default; configure these under `ui.prompt.keymaps`.

### Lua API

All public Lua functions are available from `require("vantage")` and share the same implementation paths as user commands.

| Lua function | Equivalent command / behavior | Agent/session/tools available |
| --- | --- | --- |
| `setup(config)` | Configure Vantage and register commands. | No model call; no agent tools. |
| `set_lens(mode, text)` | `:VantageSetLens {mode} {text}`. | No model call; no agent tools. |
| `get_lens()` | Return the current lens table or `nil`. | No model call; no agent tools. |
| `clear_lens()` | `:VantageClearLens`. | No model call; no agent tools. |
| `prompt_lens(mode)` | Prompt for lens text, then set the lens. | No model call; no agent tools. |
| `explain(opts)` | `:VantageExplain`; accepts command-style `opts` including `range`, `line1`, and `line2`. | Singleton buddy session; `read`, `grep`, `find`, `ls`. |
| `question(opts)` | `:VantageQuestion`; `opts.args` is the inline question when present. | Singleton buddy session; `read`, `grep`, `find`, `ls`. |
| `edit(opts)` | `:VantageEdit`; `opts.args` is the inline edit instruction when present. | Singleton buddy session; `read`, `grep`, `find`, `ls`, `submit_edit`. No Pi `edit`/`write`. |
| `annotate(opts)` | `:VantageAnnotate`; `opts.fargs` carries scope/max arguments. | Transient annotation session; `submit_annotations` only. Does not enter buddy memory. |
| `clear_annotations()` | `:VantageAnnotationClear`. | No model call; no agent tools. |
| `search(opts)` | `:VantageSearch`; `opts.args` is the inline query when present. Missing args open the prompt buffer. | Singleton buddy session; `read`, `grep`, `find`, `ls`, `submit_search_results`. No file mutation tools. |
| `status()` | `:VantageStatus`. | No model call; no agent tools. |
| `session_output()` | `:VantageSessionOutput`. | No model call; no agent tools; polls in-memory session-output history. |
| `agent_cancel()` | `:VantageAgentCancel`. | No new model call; aborts the active agent request. |
| `agent_reset()` | `:VantageAgentReset`. | No model call; no agent tools; clears in-memory buddy/session-output state. |

`require("vantage").CommandNames` exposes the canonical command names for plugin integrations that need to avoid string literals.

## Installation

vantage.nvim needs Neovim 0.10+, Node.js 22+, and npm. Install from the generated `dist` branch, which contains the Lua plugin and compiled Node backend. After your plugin manager clones the repo, run `npm ci --omit=dev` in the plugin directory so runtime Node dependencies are available.

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

Vantage Agent Sessions are enabled by default. The backend keeps in-memory conversation state scoped by workspace root, model target, and lens mode, then passes a stable Pi `sessionId` for session affinity and provider-side cache reuse. Explain, question, edit, and search share the same scoped buddy session. Annotations use transient sessions and do not enter buddy-session memory. The history window is bounded by `agent.session.max_turns` and is not persisted across Neovim/backend restarts.

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
    session_output = {
      history_limit = 10,
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
  },
  ui = {
    output = {
      width = 0.82,
      height = 0.72,
      border = "rounded",
      wrap = true,
    },
    prompt = {
      keymaps = {
        submit = "<C-g>",
        cancel = "<Esc>",
      },
    },
    session_output = {
      refresh_ms = 750,
      keymaps = {
        close = "q",
        toggle_raw = "r",
      },
    },
    input = {
      provider = "vim.ui.input",
      lens = {
        prompt = "Vantage lens: ",
      },
      question = {
        prompt = "Vantage question: ",
      },
      edit = {
        prompt = "Vantage edit: ",
      },
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
- `agent.session_output.history_limit`: backend-owned retention for `:VantageSessionOutput` activity entries.
- `agent.options`: Pi call options using Pi SDK-style camelCase keys, including `apiKey`, `temperature`, `maxTokens`, `timeoutMs`, `maxRetries`, `maxRetryDelayMs`, `reasoning`, `metadata`, and `headers`.
- `agent.trace`: optional prompt and response trace paths.
- `commands.annotate.waiting_message_ms`: when to show a still-waiting annotation notification.
- `commands.*.options`: command-specific Pi options layered over `agent.options`.
- `ui.output`: readable markdown float defaults for Vantage output.
- `ui.prompt.keymaps`: floating prompt-buffer submit/cancel mappings for missing Question/Edit/Search prompts.
- `ui.session_output.refresh_ms` and `ui.session_output.keymaps`: live transcript polling and `q`/`r` keymaps.
- `ui.input.provider`: prompt provider for lens prompts. Question/Edit/Search use the floating prompt buffer when command text is omitted.
- `ui.input.lens`: option table passed to the selected input provider, such as `prompt`, `default`, `completion`, `highlight`, and `scope`.
- `agent_context`: workspace task snapshot settings.

The active lens and command scope take precedence over Agent Task Context, and command-specific options take precedence over shared `agent.options`.

### Prompt Buffer Completion

Prompt buffers work without autocomplete. Vantage does not install a completion engine. To opt in, configure your completion plugin explicitly:

```lua
-- nvim-cmp: registers a /skill source named "vantage_skills".
require("vantage.integrations.cmp").setup()
```

```lua
-- blink.cmp: use this provider in your blink sources.providers config.
local ok, provider = require("vantage.integrations.blink").setup()
```

`@file` completion should use your completion plugin's existing path/file source. `/skill` completion uses Pi-owned skill discovery through the Vantage backend. Prompt references append normalized metadata only; Vantage does not inline file or skill contents.

## Agent Task Context

Vantage can use task context produced by an adjacent coding agent such as Codex, Claude Code, opencode, or Pi. The integration is artifact-first: the adjacent agent writes a compact Markdown snapshot at `.vantage/agent-context.md`, and Vantage reads it when present. If the file is absent, Vantage commands work normally without the extra context.

The context file is workspace/session state and should not be committed. This repository ignores `.vantage/agent-context.md` by default.

### Configure Adjacent Agents

Vantage reads `.vantage/agent-context.md`, but it does not create or continuously maintain that file. To avoid an always-on system-prompt tax in adjacent agents, use the on-demand `vantage-distill-session` skill when you want to refresh the context snapshot.

Install or copy the skill from this repository:

```text
.agents/skills/vantage-distill-session/SKILL.md
```

Then invoke it from the adjacent agent of your choice when useful:

```text
/skill:vantage-distill-session
```

The skill rewrites `.vantage/agent-context.md` as a concise snapshot of the current adjacent-agent session. It does not append logs, raw transcript, or file contents.

Keep the generated artifact local. For a personal-only setup, add it to `.git/info/exclude` in each workspace:

```gitignore
.vantage/agent-context.md
```

For a team setup, commit that ignore rule to `.gitignore`.

Use `:VantageStatus` to see whether Vantage found, included, skipped, or truncated the context file for the current workspace. Then use normal commands such as `:VantageExplain`, `:VantageQuestion`, `:VantageEdit`, and `:VantageAnnotate visible`; Vantage includes the snapshot automatically when it is available.

When Agent Sessions are enabled, Vantage tracks the context file revision and injects an Agent Context update turn only when the file changes for the current scoped session. The active lens still has higher precedence than the adjacent-agent context.

See `docs/agent-context.md` for the full artifact convention and design notes. Tool-specific instruction docs are available from Codex, Claude Code, and opencode:

- Codex: <https://developers.openai.com/codex/guides/agents-md>
- Claude Code: <https://docs.anthropic.com/en/docs/claude-code/memory>
- opencode: <https://dev.opencode.ai/docs/rules/>

## Development

Install mise-managed Node.js and project dependencies:

```bash
mise install
mise exec -- npm install
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

Run the local-only real-model e2e command tour against `examples/e2e-codebase`:

```bash
make e2e-model
```

`make e2e-model` exercises every public Vantage command in one headless Neovim session using the Pi runtime. It defaults to `openai/gpt-4o-mini` and writes `.nvim-dev/e2e/model-all-commands.json`. Override the model target when needed:

```bash
make e2e-model PI_PROVIDER=openai PI_MODEL=gpt-4o-mini
make e2e-model PI_PROVIDER=ollama PI_MODEL=<future-local-model>
```

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
:VantageSetLens learning
:VantageExplain
:VantageQuestion
:VantageEdit simplify this line
:VantageAnnotate
:VantageAnnotationClear
:VantageStatus
:VantageSessionOutput
:VantageSearch find related code paths
:VantageAgentCancel
:VantageAgentReset
```

`:VantageExplain` asks the active agent runtime to explain the current line. It also accepts Vim line ranges:

```vim
:10,20VantageExplain
:'<,'>VantageExplain
```

`:VantageSetLens [mode] [lens]` sets the active lens. If the lens text is omitted, Vantage prompts with the configured input provider. Without a mode, it reuses the current lens mode or falls back to `general`. Configure prompt metadata with `ui.input.lens`; set `ui.input.provider = "ui2"` to force UI2-backed command-line input.

```vim
:VantageSetLens learning
:VantageSetLens review Check naming clarity
```

`:VantageQuestion [question]` asks a specific question about the current line. If the question is omitted, Vantage opens a floating multi-line prompt buffer; submit with `<C-g>` or cancel with `<Esc>`. It also accepts Vim line ranges:

```vim
:VantageQuestion
:VantageQuestion why is this value immutable?
:10,20VantageQuestion
:10,20VantageQuestion what is the data flow here?
:'<,'>VantageQuestion what should I notice in this selection?
```

`:VantageEdit [instruction]` asks the active agent runtime for a single replacement of the current line. If the instruction is omitted, Vantage opens a floating multi-line prompt buffer; submit with `<C-g>` or cancel with `<Esc>`. It also accepts Vim line ranges and replaces only the requested range:

```vim
:VantageEdit
:VantageEdit rename value to count
:10,20VantageEdit
:10,20VantageEdit simplify this branch
:'<,'>VantageEdit convert this to early returns
```

`:VantageAnnotate` asks the active agent runtime to add virtual Annotation Blocks above relevant code lines in the current line, visible window, full buffer, or explicit line range. New annotations are additive; an annotation returned for the exact same buffer position replaces the older annotation at that position. `:VantageAnnotationClear` removes all vantage.nvim annotations from the current buffer.

`:VantageStatus` opens one status float with Agent Session, Agent Context, and Annotation sections. It reports the current buddy session state, whether the workspace Agent Context File was included, and the latest annotation request/rendering details.

`:VantageSessionOutput` opens a live-updating floating transcript of recent Vantage activity. It shows entries chronologically with the latest output at the bottom. Press `r` to toggle raw details and `q` to close.

`:VantageSearch [query]` runs an explicit agentic project search and opens the final curated locations in quickfix. Search always requires an explicit prompt. If the query is omitted, including for ranged or visual search, Vantage opens the same floating prompt buffer used by Question/Edit.

`:VantageAgentCancel` cancels the active agentic request. `:VantageAgentReset` clears the singleton in-memory buddy session. Explain, question, edit, and search share that session; annotations use transient sessions and do not enter buddy memory. For review-style feedback, use `:VantageQuestion review this for correctness and clarity`.

`VantageAnnotate` accepts simple scope and budget arguments:

```vim
:VantageAnnotate
:VantageAnnotate line
:VantageAnnotate visible
:VantageAnnotate visible 10
:VantageAnnotate buffer
:VantageAnnotate buffer 20
```

With no arguments, `VantageAnnotate` annotates only the current line. `line` is an explicit form of the same behavior. `visible` annotates the currently visible buffer lines, and `buffer` annotates the full current buffer. A numeric argument sets the maximum annotation budget for that request.

Without a numeric override, multi-line scopes derive their maximum annotation budget from relevant non-empty, non-comment lines. Visual ranges and `visible` use 25% of relevant lines with a minimum of 1 and maximum of 12. `buffer` uses 15% with a minimum of 3 and maximum of 24. The agent can return fewer Annotation Blocks when fewer lines are noteworthy, and each block can vary in depth based on the active lens.

`VantageAnnotate` also accepts Vim line ranges:

```vim
:10,20VantageAnnotate
:'<,'>VantageAnnotate
:'<,'>VantageAnnotate 5
```
