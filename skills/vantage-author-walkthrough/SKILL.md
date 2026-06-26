---
name: vantage-author-walkthrough
description: Writes a reviewable code walkthrough for vantage.nvim at .vantage/walkthrough.json — an ordered list of code pointers (file + line), each with a short annotation, distilled from the current session. Vantage loads it into a Neovim quickfix list and shows each annotation inline as the developer visits the line. Use this whenever the developer wants to review, walk through, or annotate specific lines of code in their editor based on this conversation — for example "show me the spots we changed in nvim", "mark up these files for review", "turn this into a walkthrough", or "point Vantage at the lines we discussed" — even if they never say the word "walkthrough". Prefer this over vantage-distill-session when the developer wants pointers to specific lines to review, rather than a general prose snapshot of the session.
---

# Vantage Author Walkthrough

## Purpose

Turn what this session learned into a guided tour of the code. You record the
specific lines worth looking at and a short note for each; Vantage opens them as
a Neovim quickfix list and renders your notes inline above the lines. The
developer is usually reviewing in Neovim while you work in an adjacent pane, so
this is how you hand off "here are the places to look, and why."

The artifact lives at the workspace root:

```text
.vantage/walkthrough.json
```

This is an on-demand snapshot. Write it when asked; don't maintain it
continuously.

## Workflow

1. Find the workspace root — prefer the current git root, otherwise the current
   working directory.
2. Create `.vantage/` if it does not exist.
3. Choose the lines that actually matter for the review the developer asked
   about. A focused tour of the key spots beats exhaustive coverage.
4. Open each file and read the line you're pointing at. Record its line number
   and copy the text on that line into `anchor`.
5. Write `.vantage/walkthrough.json` from scratch, overwriting any previous file.
6. Report the path and how many pointers you wrote.

If nothing in the session is worth reviewing yet, say so instead of inventing
pointers — an empty or misleading walkthrough wastes the developer's attention.

## Output format

Write a single JSON object with a `pointers` array. Use exactly these fields:

```json
{
  "version": 1,
  "pointers": [
    {
      "file": "lua/vantage/state.lua",
      "line": 111,
      "anchor": "command = { \"node\", plugin_root() .. \"/server/out/neovim/stdio-server.js\" },",
      "description": "Backend command resolves relative to the plugin root, not the editor's cwd."
    }
  ]
}
```

- `file`: workspace-relative path, forward slashes, no leading `/`.
- `line`: the 1-based line the note is about. Point at a line that exists right
  now; don't guess.
- `anchor`: the text currently on that line. Vantage compares it against the live
  buffer so it can flag a pointer as `[stale]` when the line has moved or
  changed. This matters because you are often the one still editing these files —
  line numbers drift, and a silent off-by-a-few annotation is worse than one
  honestly marked stale. Copy the line's content as-is; surrounding indentation
  is ignored (Vantage compares trimmed text), so you don't need to reproduce
  leading whitespace exactly.
- `description`: one plain-text sentence, no newlines. It shows up both as the
  quickfix entry and as the inline annotation, so make it specific enough to
  stand on its own when the developer reads it next to the code.

Order pointers the way a reader should walk them — the path through the change,
not alphabetical.

## Do not include

- Secrets, credentials, tokens, API keys, or auth-file contents.
- Raw chat transcript, hidden reasoning, or long pasted output — descriptions are
  one-liners, not a log.
- Pointers to files outside the workspace root.

## Before you finish

- The file is valid JSON at `.vantage/walkthrough.json` under the workspace root.
- Every `file` is workspace-relative and every `line` exists in that file.
- Each `anchor` matches the current text of its line.
