---
name: vantage-distill-session
description: Distills the current adjacent-agent session into Vantage's workspace context artifact at .vantage/agent-context.md. Use when the user wants Vantage, vantage.nvim, or Neovim to use the current agent session context, or asks to update/distill/snapshot Vantage agent context.
---

# Vantage Distill Session

## Purpose

Write a compact, current-state snapshot of this agent session for vantage.nvim to consume from:

```text
.vantage/agent-context.md
```

This is an on-demand distillation. Do not maintain the file continuously unless the user invokes this skill again.

## Workflow

1. Identify the workspace root.
   - Prefer the current git root.
   - Otherwise use the current working directory.
2. Create `.vantage/` if it does not exist.
3. Read the existing `.vantage/agent-context.md` if present, only to preserve still-relevant decisions or constraints.
4. Distill the current session into the markdown structure below.
5. Rewrite `.vantage/agent-context.md` completely. Do not append.
6. Keep the file concise: target 1-2 screens, ideally under 4 KB, always under 12 KB when practical.
7. Report the path written and any important omissions.

## Output Format

Write exactly this heading structure:

```md
# Agent Task Context

## Goal

## Current Focus

## Relevant Files

## Decisions

## Constraints

## Open Questions

## Recent Progress
```

## Distillation Rules

- Summarize the active development task, not the whole conversation.
- Prefer durable facts Vantage can use for explain/question/edit/annotate/search.
- Include only files, decisions, constraints, open questions, and recent progress that still matter.
- Keep bullets short and specific.
- Use workspace-relative paths in backticks when possible.
- Preserve recent meaningful test results or blockers when they affect next steps.
- If there is no active task context, write a minimal snapshot that says the current goal is unclear and list any known relevant files.

## Do Not Include

- Secrets, credentials, tokens, API keys, private URLs, or auth file contents.
- Raw chat transcript, chain-of-thought, hidden reasoning, or step-by-step internal deliberation.
- Long logs, full command output, stack traces, or large pasted content.
- Unrelated project documentation or broad architecture summaries.
- Speculative claims not grounded in the current session.

## Quality Check

Before finishing, verify:

- The file is at `.vantage/agent-context.md` under the workspace root.
- The content is a snapshot, not a chronological log.
- The most important current context is present.
- The content is concise enough for Vantage to include cheaply.
- No sensitive information or raw transcript was written.
