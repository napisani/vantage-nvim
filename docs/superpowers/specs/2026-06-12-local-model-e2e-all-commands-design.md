# Local Real-Model E2E: All Public Vantage Commands

## Purpose

Add a local-only end-to-end suite that launches one real Neovim instance in a small fixture codebase and exercises every public Vantage command through the actual Lua command layer, stdio backend, and Pi coding-agent runtime.

This suite is meant for developer confidence before shipping agent/runtime changes. It is intentionally not part of required CI yet because it depends on live model credentials, costs money, and can be slower or flakier than deterministic tests.

## Goals

- Exercise all public user commands in one Neovim session.
- Use a cheap configurable model by default, initially `openai/gpt-4o-mini`.
- Allow future provider/model swaps such as an Ollama-backed model without changing the test harness.
- Start Neovim with its current working directory set to an example codebase inside this repository.
- Validate structural behavior rather than exact model prose.
- Write a JSON artifact that makes local failures diagnosable.

## Non-goals

- Do not make the suite mandatory in CI yet.
- Do not assert exact LLM wording.
- Do not replace deterministic backend, Lua, or Neovim integration tests.
- Do not require the test model to make semantically perfect edits beyond minimal structural contracts.

## Commands Covered

The suite covers every public command registered by `lua/vantage/commands.lua`:

- `:VantageSetLens`
- `:VantageClearLens`
- `:VantageExplain`
- `:VantageQuestion`
- `:VantageEdit`
- `:VantageAnnotate`
- `:VantageAnnotationClear`
- `:VantageAnnotationStatus`
- `:VantageContextStatus`
- `:VantageSearch`
- `:VantageAgentCancel`
- `:VantageAgentReset`
- `:VantageAgentStatus`

Public Lua APIs may continue to be covered by deterministic tests. This e2e suite focuses on user-visible commands.

## Fixture Codebase

Create `examples/e2e-codebase/` with a few small files that give the model stable anchors:

- `lua/calculator.lua`: simple functions used by explain, question, edit, annotate, and search.
- `lua/report.lua`: imports/uses calculator functions so search has cross-file results.
- `.vantage/agent-context.md`: small Agent Context File for `:VantageContextStatus` and model context injection.

The fixture should be intentionally tiny so model calls are cheap and prompts remain focused.

## Test Harness

Add `nvim/tests/e2e_all_commands_spec.lua` as the command-tour test. It will:

1. Configure a deterministic Neovim test environment.
2. Set cwd to `examples/e2e-codebase` while keeping the plugin runtime path pointed at the repository root.
3. Configure Vantage with:
   - stdio backend: `node <repo>/server/out/neovim/stdio-server.js`
   - Pi runtime
   - provider/model from globals or environment
   - default provider/model: `openai/gpt-4o-mini`
   - request timeout and annotation timeout from globals
4. Open a known fixture file.
5. Run the public commands in a sequence that intentionally exercises singleton buddy reuse.
6. Record command results, markdown float text, quickfix entries, extmark counts, buffer changes, lens state, and any errors.
7. Write `.nvim-dev/e2e/model-all-commands.json`.
8. Fail with `cquit` if any required structural assertion fails.

## Command Sequence

A single session should run commands in this order:

1. `VantageSetLens learning Keep responses short and focus on data flow`
2. `VantageExplain`
3. `VantageQuestion Where does the total get computed?`
4. `VantageEdit rename total to sum on this line`
5. `VantageAnnotate`
6. `VantageAnnotationStatus`
7. `VantageAnnotationClear`
8. `VantageContextStatus`
9. `VantageSearch find where calculator totals are used`
10. `VantageAgentStatus`
11. `VantageAgentCancel`
12. `VantageAgentReset`
13. `VantageClearLens`

This order catches the class of bugs where a persistent buddy session is created by a non-submit command and later reused by edit/search/annotate submit-tool commands.

## Assertions

Assertions are structural:

- Lens commands update and clear `require("vantage").get_lens()`.
- Explain/question/status/context commands produce a non-empty markdown float.
- Edit changes the target buffer text and does not leave the buffer empty.
- Annotate produces at least one annotation extmark or a non-empty diagnostic artifact showing why none were accepted.
- Annotation clear removes Vantage annotation extmarks.
- Search populates quickfix with at least one item whose filename, line, and text are present.
- Agent cancel/reset/status commands complete without backend error.
- The suite records all command outputs and failures in the artifact.

The suite should avoid exact prose checks because model output is intentionally variable.

## Make/NPM Entry Points

Add a local-only target:

```bash
make e2e-model
```

Recommended defaults:

```make
PI_PROVIDER ?= openai
PI_MODEL ?= gpt-4o-mini
E2E_WAIT_MS ?= 120000
```

Allow overrides:

```bash
make e2e-model PI_PROVIDER=openai PI_MODEL=gpt-4o-mini
make e2e-model PI_PROVIDER=ollama PI_MODEL=<future-local-model>
```

Do not include this target in `npm run test:mvp` or CI workflows yet.

## Failure Handling

The test should continue collecting artifact details where possible, but hard failures may stop the run when continuing would make later assertions meaningless. Every failure should include the artifact path.

The artifact should include:

- model target
- command list and per-command status
- final buffer content
- latest float text
- quickfix list
- annotation mark count and texts
- lens state
- backend configuration
- Neovim cwd and opened files

## Risks and Mitigations

- **Model flake:** assert structure, not prose; keep fixture small; use short direct prompts.
- **Cost:** local-only target; cheap default model; tiny fixture.
- **Provider differences:** provider/model are variables; no OpenAI-specific assumptions in Lua harness.
- **Long runtime:** use one Neovim session and one fixture; expose timeout knobs.
- **Cascading failure:** JSON artifact records the last successful command and state after each command.

## Acceptance Criteria

- `make e2e-model` launches headless Neovim in `examples/e2e-codebase` using the real stdio backend and Pi runtime.
- The suite exercises every public Vantage command listed above.
- The model target is configurable without editing test code.
- The suite writes `.nvim-dev/e2e/model-all-commands.json`.
- Existing deterministic checks still pass with npm:
  - `npm run lint`
  - `npm run test:mvp`
- The local e2e target is documented in `README.md`.
