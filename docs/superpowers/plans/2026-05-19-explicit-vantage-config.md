# Explicit Vantage Config Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Vantage-specific environment-variable configuration with a documented Lua `require("vantage").setup({ ... })` configuration object.

**Architecture:** Lua stores a typed `VantageConfig` and sends the selected provider config with each stdio request. The Node backend parses that request config and creates providers from config values. Provider API keys may be passed explicitly in config, with only standard provider env vars such as `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` used as fallbacks.

**Tech Stack:** Neovim Lua, TypeScript stdio backend, Node test runner, headless Neovim tests.

---

### Task 1: Lua Config Contract

**Files:**
- Modify: `lua/vantage/state.lua`
- Modify: `lua/vantage/backend.lua`
- Modify: `lua/vantage/commands.lua`
- Test: `nvim/tests/vantage_spec.lua`

- [x] Add Lua doc classes for `VantageConfig`, provider sub-configs, backend config, and annotation config.
- [x] Store provider config under `state.config.provider`.
- [x] Send `config = { provider = state.config.provider }` on every stdio backend request.
- [x] Build annotation provider labels from `state.config.provider`, not `vim.env`.

### Task 2: Backend Config Contract

**Files:**
- Modify: `server/src/neovim/protocol.ts`
- Modify: `server/src/neovim/provider-factory.ts`
- Modify: `server/src/neovim/handlers.ts`
- Test: `server/src/neovim/protocol.test.ts`
- Test: `server/src/neovim/provider-factory.test.ts`
- Test: `server/src/neovim/stdio-server.test.ts`

- [x] Parse optional top-level request config with provider details.
- [x] Replace `createProviderFromEnv` with `createProviderFromConfig`.
- [x] Create the provider per request from parsed request config unless a test injects a provider.
- [x] Keep `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` fallback behavior for missing configured API keys.

### Task 3: Dev, Tests, And Docs

**Files:**
- Modify: `nvim/dev/init.lua`
- Modify: `nvim/tests/dev_init_spec.lua`
- Modify: `nvim/tests/e2e_annotations_spec.lua`
- Modify: `Makefile`
- Modify: `README.md`

- [x] Replace `VANTAGE_*` dev configuration with Lua globals consumed by `nvim/dev/init.lua`.
- [x] Keep standard credential env vars only.
- [x] Update install docs to show explicit `require("vantage").setup` examples.
- [x] Update dev docs and Make targets to match the new config contract.

### Verification

- [x] Run `npm run test:mvp`.
- [x] Run `npm run lint`.
- [x] Run `npm run build:plugin`.
- [x] Run `rg "vim\\.env\\.VANTAGE|VANTAGE_PROVIDER|VANTAGE_CODEX|VANTAGE_OLLAMA|VANTAGE_CHATGPT|VANTAGE_PI"`.
- [x] Run `git diff --check`.
