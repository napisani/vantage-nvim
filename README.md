# learn.nvim

This project is being reworked into a Neovim-first AI review and learning tool.

The current architecture is a Lua Neovim plugin plus a local TypeScript backend. The plugin owns commands, floating markdown windows, and virtual text annotations. The backend owns request contracts and provider behavior. The current implementation uses a deterministic fake provider so the developer experience can be tuned before real model integrations are added.

## Commands

- `:LearnSetLens learning I am learning Elixir syntax`
- `:LearnClearLens`
- `:LearnExplainLine`
- `:LearnExplainSelection`
- `:LearnToggleAnnotations`
- `:LearnReviewHunk`

## Development

Install dependencies:

```bash
npm install
```

Run the MVP tests:

```bash
make test
```

Run backend tests only:

```bash
npm run test:backend
```

Run headless Neovim tests only:

```bash
npm run test:nvim
```

## Manual Neovim Smoke Test

Compile the backend:

```bash
npm run compile
```

Open Neovim with only the repo-local development config:

```bash
make run
```

Open a specific file:

```bash
make run FILE=path/to/file.lua
```

Then run:

```vim
:LearnSetLens learning I am learning Lua syntax
:LearnExplainLine
:LearnToggleAnnotations
```
