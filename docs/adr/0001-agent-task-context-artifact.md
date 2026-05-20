# Use a workspace-local artifact for Agent Task Context

Vantage will consume adjacent-agent task context through a workspace-local Markdown file at `.vantage/agent-context.md`, produced by the adjacent coding agent and read by Vantage when present. This artifact-first boundary keeps Vantage agent-neutral and Neovim-native while avoiding brittle integrations with Codex, Claude Code, opencode, Pi, or raw session internals; provider-backed commands treat the file as untrusted prompt context with lower precedence than the active lens.
