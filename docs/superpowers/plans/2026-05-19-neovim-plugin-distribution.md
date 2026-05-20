# Neovim Plugin Distribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make vantage.nvim installable as a Neovim plugin with a prebuilt Node backend published by GitHub Actions.

**Architecture:** The runtime plugin resolves its backend script relative to the installed plugin root instead of the editor working directory. A packaging script compiles the TypeScript backend and stages only the runtime files needed by Vim plugin managers. A GitHub Actions workflow verifies the repo and publishes that staged tree to a `dist` branch.

**Tech Stack:** Lua Neovim runtime files, TypeScript/Node backend, npm scripts, GitHub Actions, git worktree/orphan branch publishing.

---

### Task 1: Runtime Backend Resolution

**Files:**
- Modify: `lua/vantage/state.lua`
- Test: `nvim/tests/vantage_spec.lua`

- [ ] Add a Lua test that `require("vantage").setup({})` configures the stdio backend command to run `node <plugin-root>/server/out/neovim/stdio-server.js`.
- [ ] Implement plugin-root detection with `debug.getinfo` from `lua/vantage/state.lua`.
- [ ] Run `npm run test:nvim` and confirm the new test passes.

### Task 2: Package Runtime Tree

**Files:**
- Add: `scripts/build-plugin-package.mjs`
- Modify: `package.json`
- Modify: `.gitignore`

- [ ] Add an npm script `build:plugin` that compiles the backend and stages the plugin runtime in `.plugin-dist`.
- [ ] Copy `plugin/`, `lua/`, `server/out/`, `package.json`, `package-lock.json`, `README.md`, and `LICENSE` if present.
- [ ] Exclude tests, TypeScript source, development config, and root `node_modules`.
- [ ] Run `npm run build:plugin` and inspect `.plugin-dist`.

### Task 3: Publish Dist Branch

**Files:**
- Add: `.github/workflows/build-plugin.yml`

- [ ] Add a workflow that runs on pushes to `main`, tags, and manual dispatch.
- [ ] Use Node 22, `npm ci`, `npm run lint`, `npm run test:mvp`, and `npm run build:plugin`.
- [ ] Publish `.plugin-dist` to the `dist` branch using a deploy action.

### Task 4: Install Documentation

**Files:**
- Modify: `README.md`

- [ ] Document requirements: Neovim, Node.js, and provider-specific credentials/tools.
- [ ] Add lazy.nvim, vim-plug, and native package examples using `branch = "dist"` and `npm ci --omit=dev`.
- [ ] Document setup options for fake, Codex, Ollama, ChatGPT, and Pi providers.
- [ ] Keep development workflow separate from user installation.

### Verification

- [ ] Run `npm run test:mvp`.
- [ ] Run `npm run lint`.
- [ ] Run `npm run build:plugin`.
- [ ] Run `git diff --check`.
