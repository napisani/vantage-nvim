# Project Agent Instructions

## Documentation Guardrail

Keep the public API documentation in `README.md` current with code changes.

Whenever you add, remove, rename, or change behavior for any public Vantage surface, update the `README.md` **Public API** section in the same change. This includes:

- user commands in `lua/vantage/command_names.lua` or `lua/vantage/commands.lua`
- command modes/range support (`normal`, range, visual via `:'<,'>`)
- prompt behavior, including whether a command requires inline args or opens the prompt buffer
- agent/session/tool availability for each command and function, including read-only tools and Vantage submit tools
- public Lua APIs exposed from `lua/vantage/init.lua`
- keymaps/config that affect public command behavior

Before calling the work complete, run a quick documentation consistency check, for example:

```bash
rtk rg -n "Vantage[A-Za-z]+|function M\." lua/vantage README.md
```

If command behavior, public Lua API, or agentic tool availability changes but the README Public API tables do not change, treat that as documentation rot and fix it before finishing.
