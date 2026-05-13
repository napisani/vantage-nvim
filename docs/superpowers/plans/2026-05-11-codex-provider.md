# Codex Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a real Codex CLI-backed provider that reuses Codex SSO authentication and can be launched from a repo-local Neovim flow.

**Architecture:** Introduce a provider interface behind the existing backend handler. Keep fake as the default provider, add a Codex provider that shells out to `codex exec`, and select providers through environment variables. Neovim continues using the existing stdio backend protocol.

**Tech Stack:** TypeScript backend, Node child process APIs, Node test runner, Lua Neovim dev bootstrap, Makefile.

---

### Task 1: Provider Interface And Selection

**Files:**
- Create: `server/src/neovim/provider.ts`
- Create: `server/src/neovim/provider-factory.ts`
- Modify: `server/src/neovim/fake-provider.ts`
- Modify: `server/src/neovim/handlers.ts`
- Test: `server/src/neovim/provider-factory.test.ts`
- Test: `server/src/neovim/handlers.test.ts`

- [ ] **Step 1: Write failing provider selection tests**

Create `server/src/neovim/provider-factory.test.ts` with tests that assert unset provider selects fake, `VANTAGE_PROVIDER=fake` selects fake, `VANTAGE_PROVIDER=codex` selects Codex, and unknown providers throw a readable error.

- [ ] **Step 2: Run tests and verify they fail**

Run: `npm run compile && node --test server/out/neovim/provider-factory.test.js`

Expected: compile fails because provider-factory does not exist.

- [ ] **Step 3: Implement provider interface and factory**

Add `BackendProvider` methods matching the three existing request handlers. Update `FakeProvider` to implement the interface. Update `handlers.ts` to accept an optional provider and default to `createProviderFromEnv(process.env)`.

- [ ] **Step 4: Run provider tests**

Run: `npm run compile && node --test server/out/neovim/provider-factory.test.js server/out/neovim/handlers.test.js`

Expected: tests pass.

### Task 2: Codex CLI Provider

**Files:**
- Create: `server/src/neovim/codex-provider.ts`
- Test: `server/src/neovim/codex-provider.test.ts`

- [ ] **Step 1: Write failing Codex provider tests**

Add tests using a fake command such as `node -e` to simulate `codex exec`. Cover markdown output, strict JSON annotation parsing, invalid annotation JSON, and non-zero CLI exit.

- [ ] **Step 2: Run tests and verify they fail**

Run: `npm run compile && node --test server/out/neovim/codex-provider.test.js`

Expected: compile fails because codex-provider does not exist.

- [ ] **Step 3: Implement Codex provider**

Use `node:child_process` to spawn the configured command, `node:fs/promises` and `node:os` to manage a temp output file, and send prompts through stdin. Read final content from `--output-last-message`. Default model is `gpt-5.4-mini`.

- [ ] **Step 4: Run Codex provider tests**

Run: `npm run compile && node --test server/out/neovim/codex-provider.test.js`

Expected: tests pass.

### Task 3: Repo-Local Codex Run Flow

**Files:**
- Modify: `nvim/dev/init.lua`
- Modify: `Makefile`
- Modify: `README.md`
- Test: `nvim/tests/dev_init_spec.lua`

- [ ] **Step 1: Write failing dev init test for Codex mode**

Extend `nvim/tests/dev_init_spec.lua` so it can assert the backend mode is `stdio` when `VANTAGE_DEV_PROVIDER=codex`.

- [ ] **Step 2: Run test and verify it fails**

Run: `make test-dev-init VANTAGE_DEV_PROVIDER=codex`

Expected: test fails because dev init always configures fake mode.

- [ ] **Step 3: Implement Makefile and dev init wiring**

Add `make run-codex`, passing `VANTAGE_DEV_PROVIDER=codex` and `VANTAGE_PROVIDER=codex`. Update `nvim/dev/init.lua` to use fake by default and stdio when `VANTAGE_DEV_PROVIDER=codex`.

- [ ] **Step 4: Run full verification**

Run:

```bash
make test
make run NVIM='nvim --headless -c "lua assert(require(\"vantage.state\").config.backend.mode == \"fake\")" -c qa'
make run-codex NVIM='nvim --headless -c "lua assert(require(\"vantage.state\").config.backend.mode == \"stdio\")" -c qa'
npm run lint
```

Expected: all commands exit 0.
