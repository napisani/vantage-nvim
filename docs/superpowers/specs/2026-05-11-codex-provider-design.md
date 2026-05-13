# Codex Provider Design

## Goal

Add a real backend provider that uses the local Codex CLI and therefore reuses the user's existing Codex SSO authentication instead of requiring OpenAI API keys.

## Scope

The Neovim plugin remains unchanged at the UI level. It continues to talk to the local TypeScript stdio backend. The backend gains provider selection so the existing fake provider stays available for fast plumbing tests while a new Codex provider can be enabled for real model responses.

## Provider Selection

The backend selects providers from environment variables:

- `VANTAGE_PROVIDER=fake`: deterministic fake provider.
- `VANTAGE_PROVIDER=codex`: local Codex CLI provider.
- Unset `VANTAGE_PROVIDER`: fake provider, preserving current fast test behavior.

Codex provider configuration:

- `VANTAGE_CODEX_COMMAND`: command to run, default `codex`.
- `VANTAGE_CODEX_MODEL`: model to pass to `codex exec`, default `gpt-5.4-mini`.
- `VANTAGE_CODEX_TIMEOUT_MS`: request timeout in milliseconds, default `300000`.

`gpt-5.4-mini` is the default because OpenAI's current model docs describe it as the strongest mini model for coding-oriented lower-latency workloads. `codex-mini-latest` is Codex-CLI-optimized, but the requested default was the latest GPT mini model.

## Codex Execution

Each backend request invokes:

```bash
codex exec \
  --model gpt-5.4-mini \
  --sandbox read-only \
  --ephemeral \
  --ignore-rules \
  --skip-git-repo-check \
  --output-last-message <temp-file> \
  -
```

The prompt is sent on stdin. The provider reads the final model response from the output file. This keeps stdout/stderr noise from the Codex CLI out of the backend protocol.

## Response Shape

`explainSelection` and `reviewCurrentHunk` return markdown directly. `annotateRange` asks Codex to return strict JSON with an `annotations` array, then validates each annotation before returning it to Neovim. If Codex returns invalid JSON, the backend returns a readable error response instead of blank annotations.

## Neovim Development Flow

`make run` remains fake for fast UI iteration. A new `make run-codex` target compiles the backend and launches Neovim with the repo-local config using `VANTAGE_PROVIDER=codex`, without touching `~/.config/nvim`.
