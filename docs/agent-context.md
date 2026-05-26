# Agent Task Context

This document defines the artifact convention for letting Vantage use task context from an adjacent coding agent.

## File

Adjacent agents should write:

```text
.vantage/agent-context.md
```

Vantage reads this file when present. If it is missing, unreadable, or stale beyond configuration, Vantage continues without blocking explain, question, edit, annotate, or review commands. If it is too large, Vantage defensively reads the last configured byte range; the adjacent agent remains responsible for keeping the file compact.

Vantage records a lightweight revision from the file metadata and configured byte limit. With Vantage Agent Sessions enabled, that revision is used to add an Agent Context update turn only when the file changes for the current workspace/model/lens session.

## Agent Instruction Snippet

Copy this into Codex, Claude Code, opencode, Pi, or another adjacent coding agent's user-level or project-level instructions:

```md
## Workspace Task Snapshot

If `.vantage/` exists in the current workspace, maintain `.vantage/agent-context.md` as a compact snapshot of the active task.

Create `.vantage/agent-context.md` if it is missing. Rewrite the file when task state materially changes; do not append a running log or transcript.

Keep the snapshot concise, current, and under 12 KB when practical. Do not include secrets, credentials, raw conversation, or unrelated project documentation.

Use this structure:

# Agent Task Context

## Goal

## Current Focus

## Relevant Files

## Decisions

## Constraints

## Open Questions

## Recent Progress

Update it after meaningful changes: plan changes, important files or constraints are discovered, decisions are made, tests pass/fail in a relevant way, or before handing control back to the user.

Do not update it after every command, file read, or tool call.
```

## Snapshot Format

The context file should be a current-state snapshot, not a log. Update it when the task state materially changes:

- the goal changes
- a plan is created or revised
- relevant files are discovered
- decisions are made
- constraints become important
- tests fail or pass in a way that changes direction
- implementation focus moves
- the agent is about to hand control back to the user

Do not update it after every tool call, shell command, or file read.

## Trust And Precedence

Vantage treats the file as untrusted task context. It can shape prompts, but it cannot change the agent runtime, model target, timeouts, command behavior, response format rules, or the active lens.

Priority order:

1. requested command scope
2. active lens
3. Agent Task Context
4. general coding knowledge

The active lens remains the highest-precedence user steering layer. Agent Task Context can root answers in the adjacent task state, but it does not override the current command, lens, or response contract.

## Git Hygiene

The generated context file should not be committed:

```gitignore
.vantage/agent-context.md
```

Do not ignore the entire `.vantage/` directory unless your project wants all future Vantage workspace files to remain local.
