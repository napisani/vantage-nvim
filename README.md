# vantage.nvim

This project is being reworked into a Neovim-first AI review and learning tool.

The current architecture is a Lua Neovim plugin plus a local TypeScript backend. The plugin owns commands, floating markdown windows, and virtual text annotations. The backend owns request contracts and provider behavior. The current implementation uses a deterministic fake provider so the developer experience can be tuned before real model integrations are added.

## Commands

- `:VantageSetLens learning I am learning Elixir syntax`
- `:VantageClearLens`
- `:VantageExplain`
- `:VantageAnnotate`
- `:VantageAnnotationClear`
- `:VantageReviewHunk`

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

`:VantageAnnotate` asks the active provider to annotate the section closest to the cursor. New annotations are additive; an annotation returned for the exact same buffer position replaces the older annotation at that position. `:VantageAnnotationClear` removes all vantage.nvim annotations from the current buffer.

`VantageAnnotate` accepts simple scope and budget arguments:

```vim
:VantageAnnotate line
:VantageAnnotate visible
:VantageAnnotate 5
:VantageAnnotate visible 10
```

With no arguments, `VantageAnnotate` keeps the fast default of up to 3 nearby candidate lines. `line` annotates only the current line. `visible` annotates up to 6 visible-window candidate lines. A numeric argument sets the maximum annotation budget for that request.

`VantageAnnotate` also accepts Vim line ranges:

```vim
:10,20VantageAnnotate
:'<,'>VantageAnnotate
```
