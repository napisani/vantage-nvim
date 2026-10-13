---
name: vantage-last-turn-to-doc
description: Copies your previous reply, verbatim, into .vantage/last-turn.md so the developer can open it in Neovim with vantage.nvim (:VantageLastTurn) and annotate it as a working doc. Use when the developer asks to put your last message, last turn, or last response into a doc for Vantage or Neovim, wants to mark up or comment on what you just said, or runs /vantage-last-turn-to-doc.
---

# Vantage Last Turn To Doc

## Purpose

Hand your previous reply to the developer as a markdown file they can edit in
Neovim. They open it with `:VantageLastTurn`, write comments and edits directly
into it, and then point you back at it. From then on it is a shared working
doc: when they send you back to it, read their comments and edit the file in
place.

The doc lives at the workspace root:

```text
.vantage/last-turn.md
```

## Workflow

1. Find the workspace root — prefer the current git root, otherwise the current
   working directory.
2. Create `.vantage/` if it does not exist.
3. If `.vantage/last-turn.md` already exists, move it aside to
   `.vantage/last-turn-<YYYYMMDD-HHMMSS>.md` using the current local time, so
   the developer's earlier annotations are never lost.
4. Write your previous reply into `.vantage/last-turn.md`.
5. Report the path in one line. Do not repeat the reply in chat.

## What to write

"Previous reply" is the last message you sent to the developer before this
skill was invoked — the text they read, not your tool calls or reasoning.

- Copy it verbatim. Do not summarize, shorten, reorder, or improve it; the
  developer is annotating what you actually said.
- Keep its markdown as-is: headings, lists, tables, and fenced code blocks.
- Do not wrap the whole reply in a code fence and do not add a title, preamble,
  or footer.
- If the reply was split across several messages in one turn, write only the
  final message unless the developer asks for the whole turn.

If there is no previous reply to copy, say so instead of writing the file.

## Do not include

- Secrets, credentials, tokens, API keys, or auth-file contents. Replace any
  that appeared in the reply with `[redacted]`.
