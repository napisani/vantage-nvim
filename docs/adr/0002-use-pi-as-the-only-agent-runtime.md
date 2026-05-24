# Use Pi as the only agent runtime

Vantage previously treated Codex, Ollama, ChatGPT, and Pi as interchangeable provider adapters. Vantage will now use Pi as the only real agent runtime and reserve "provider" for Pi's provider/model selection semantics, because this simplifies the Neovim plugin surface while preserving cross-model flexibility through Pi.

## Consequences

Non-Pi adapters, public configuration, development targets, tests, and README instructions should be removed rather than hidden behind compatibility shims. Deterministic fake behavior remains available only as a test and development runtime.
