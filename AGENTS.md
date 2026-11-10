# Project Agent Instructions

## Lua API Requirement

Every user command must have a corresponding public Lua function exposed through `require("vantage")`. The command is a thin wrapper; the Lua function is the real implementation. This ensures integrations (statusline, keymaps, other plugins) can invoke any Vantage behavior without shelling out to `:Vantage*` commands.

Pattern:
- `lua/vantage/init.lua` — public function (e.g. `M.explain(opts)`)
- `lua/vantage/commands.lua` — user command calls the public function
- `lua/vantage/command_names.lua` — command name string

When adding a new command, add all three in the same change. Do not add a command that only exists as a `vim.api.nvim_create_user_command` without a Lua entry point.

## Two halves, one protocol

Vantage is a Lua plugin plus the `pi-vantage-nvim` Pi extension in
`pi-vantage-nvim/`. They talk over a Unix socket in JSON lines. Each part of
the wire lives in one file per side; change both sides in the same commit:

| What | TypeScript | Lua |
| --- | --- | --- |
| Version, framing, envelopes, server messages | `pi-vantage-nvim/protocol.ts` (`PROTOCOL_VERSION`, `ClientEnvelopeSchema`, `ServerMessage`) | `lua/vantage/review/protocol.lua` (`M.VERSION`, `encode`, `decode`) |
| Action payloads Neovim sends | `pi-vantage-nvim/actions.ts` (TypeBox schemas) | `lua/vantage/review/init.lua` (one builder per action); `core.cancel_annotate` |
| Handshake and request ids | `pi-vantage-nvim/server.ts` | `lua/vantage/review/client.lua` |
| Socket directory and names | `pi-vantage-nvim/server.ts` (`socketDirectory`, `socketPath`) | `lua/vantage/review/protocol.lua`, owner check in `client.lua` |

Each side stamps the version in one place (`stamp` in `protocol.ts`, `encode`
in `protocol.lua`), so a version bump is the two constants. Bump them when an
old client could misread a new message.

- Review rules (statuses, rounds, withdrawal) live in the extension's reducer
  (`state.ts`) and `review.ts`. Lua never decides them; it sends actions and
  renders the state it is given. The one Lua table that maps statuses to
  groups, highlights and order is `lua/vantage/review/statuses.lua`; when a
  status is added in `state.ts`, add it there too.
- `lua/vantage/review/core.lua` must not create windows, buffers or extmarks.
  Views under `lua/vantage/review/ui/` read it through `require("vantage.review")`
  and the `User VantageReviewChanged` event.
- The extension's agent-facing text lives in `messages.ts` and the tool
  descriptions in `tools.ts`; there is no skill. Keep each message ending with
  what to do and which tool answers it.

## Documentation Guardrail

Keep the public API documentation in `README.md` current with code changes.

Whenever you add, remove, rename, or change behavior for any public Vantage surface, update the `README.md` **Public API** section in the same change. This includes:

- user commands in `lua/vantage/command_names.lua` or `lua/vantage/commands.lua`
- command modes/range support (`normal`, range, visual via `:'<,'>`)
- prompt behavior, including whether a command requires inline args or opens the prompt buffer
- whether and when each command reaches the agent, and the extension's `vantage_*` reply tools
- public Lua APIs exposed from `lua/vantage/init.lua`
- keymaps/config that affect public command behavior

Before calling the work complete, run a quick documentation consistency check, for example:

```bash
rtk rg -n "Vantage[A-Za-z]+|function M\." lua/vantage README.md
```

If command behavior, public Lua API, or agentic tool availability changes but the README Public API tables do not change, treat that as documentation rot and fix it before finishing.

## Lua Test Layout

The Lua suite is one module per subject under `nvim/tests/spec/`, sharing a
registry (`nvim/tests/support/harness.lua`) and fixtures
(`nvim/tests/support/helpers.lua`). `nvim/tests/vantage_spec.lua` is only an
aggregator: it requires every spec module, then runs.

Specs that need an agent use `nvim/tests/support/extension.lua`: it starts the
real extension on a real socket through `support/extension_host.ts` and lets
the spec play the agent with `host:agent(op, params)`, where `op` names a reply
tool without its `vantage_` prefix. Specs that only check what a command sends
stub the core with `helpers.capture_actions`.

When adding Lua tests:

- Put the test in the spec module for the command or module under test. Do not
  add tests to `vantage_spec.lua` — it holds no tests.
- New subject: create `nvim/tests/spec/<name>_spec.lua` and add `"<name>"` to the
  `SPECS` list in `vantage_spec.lua`.
- New shared fixture: add it to `support/helpers.lua` and export it in the table
  at the bottom, then localize it in the spec modules that use it.
- Keep a spec module focused. When one grows past roughly 300 lines it is usually
  covering more than one concern and should be split (as `annotation_spec.lua`
  was split into command / render / status).

Headless-mode caveat worth knowing before writing UI tests: some mode
transitions cannot be driven synchronously. The prompt buffer's `startinsert`
runs inside `vim.schedule()` and only takes effect once Neovim next reads input,
so a synchronous test can never observe insert mode and `vim.wait` does not help
— assert the buffer's keymap table instead. Visual mode, by contrast, works:
`vim.cmd("normal! vjj")` establishes a real selection and stays in visual mode.
