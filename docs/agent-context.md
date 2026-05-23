# Agent Task Context

This document defines the artifact convention for letting Vantage use task context from an adjacent coding agent.

## File

Adjacent agents should write:

```text
.vantage/agent-context.md
```

Vantage reads this file when present. If it is missing, unreadable, or stale beyond configuration, Vantage continues without blocking explain, annotate, or review commands. If it is too large, Vantage defensively reads the last configured byte range; the adjacent agent remains responsible for keeping the file compact.

## Agent Instruction Snippet

Copy this into Codex, Claude Code, opencode, Pi, or another adjacent coding agent's user-level or project-level instructions:

```md
When working in this repository, maintain `.vantage/agent-context.md` as a compact snapshot for Vantage.

Rewrite it when task state materially changes. Do not append a transcript.

Use this structure:

# Agent Task Context

## Goal

## Current Focus

## Relevant Files

## Decisions

## Constraints

## Open Questions

## Recent Progress

Keep it concise. Do not include secrets. This file is ignored by git. The producer of the file is responsible for pruning and compacting it.
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

Vantage treats the file as untrusted task context. It can shape prompts, but it cannot change provider selection, model selection, timeouts, command behavior, response format rules, or the active lens.

Priority order:

1. requested command scope
2. active lens
3. Agent Task Context
4. general coding knowledge

## Git Hygiene

The generated context file should not be committed:

```gitignore
.vantage/agent-context.md
```

Do not ignore the entire `.vantage/` directory unless your project wants all future Vantage workspace files to remain local.
