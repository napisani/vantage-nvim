---
name: vantage-author-diff-tour
description: Author a guided tour of a Git diff for vantage.nvim and Diffview at .vantage/diff-tour.json. Use when the developer asks to walk through, explain, or explore the important changes in a commit, branch comparison, or working-tree diff inside Neovim, including removed lines. Prefer this over vantage-author-walkthrough when the subject is the changeset rather than live-file code locations.
---

# Author a Vantage Diff Tour

This is an on-demand, read-only investigation of a Git changeset. Write a short ordered tour that Vantage opens in Diffview with notes above lines on **either revision side**. Do not edit code or stage changes. The only output is `.vantage/diff-tour.json` at the Git workspace root; report its path and the number of stops. The user loads it with `:VantageLoadDiffTour`, then navigates with `]c` / `[c` (or `:VantageDiffTourNext` / `:VantageDiffTourPrev`). Keep the tour focused: produce 4–8 stops by default, and never more than 10 unless the user explicitly asks for exhaustive coverage.

## Choose the comparison

1. Require a user-authored request. Resolve explicit base and target refs if supplied. If the request names a comparison, use it; if neither does, compare `HEAD` to the tracked worktree (including staged and unstaged changes). If refs and the request contradict each other, ask rather than silently choosing one. Do not assume a remote branch exists or fetch anything.
2. Resolve commit refs to full hashes with `git rev-parse --verify --end-of-options 'REF^{commit}'`. Compare exact trees A..B, not merge-base/PR-style A...B. For a worktree target pin the base and record `HEAD` at authoring time. Use the Git repository root as the workspace; do not point outside it.
3. Get the complete tracked text-file manifest with `git diff --name-status -z -M` and `git diff --numstat -z -M` for those revisions. Exclude binary (`-` numstat), symlinks/nonregular files, and untracked files. Renames use their new path as `file`, while the left-side content uses the old path. The full manifest is your map, **not** a requirement to tour every file.

## Explore selectively

Look at change stats and filenames before picking representative areas. Fetch patches for files that illuminate the requested change (`git diff -M -U3 BASE..TARGET -- PATH` or `git diff -M -U3 BASE -- PATH` for worktree); for a rename include both old and new paths so the left and right revisions are visible. Read supporting code as needed. Large mechanical repetitions, generated files, lockfiles, and unrelated working-tree changes rarely merit stops.

Treat a broad working tree as potentially mixed. Follow the user's stated focus and omit unrelated themes; if no focus is stated and the changes clearly contain unrelated themes, ask which one to tour instead of producing a catalog of everything. Use the manifest to ensure coverage of the selected theme, not to justify one stop per file. Prefer one stop per architectural seam, with at most two stops in a file unless both revision sides are essential. This keeps the tour navigable and makes each explanation meaningful.

Choose a small ordered set of key stops. A stop may land on a changed line **or unchanged context inside a changed file**. For deleted content choose `side: "left"`; added/right-side content uses `side: "right"`. `line` is 1-based **in that side's file**, not the line number in the unified patch. Obtain exact `anchor` text from the pinned blob (`git show 'SHA:PATH'`) or the current tracked worktree file, and verify the line still exists before writing. For renamed left-side points use the old path to read the blob but the new path in `file`. Avoid secrets, credential text, transcript excerpts, and verbose descriptions.

## Artifact

Write valid JSON atomically to `.vantage/diff-tour.json` with exactly the following shape. Replace the previous tour **only after** validating at least one real stop. Do not write an empty tour. Do not point to outside-workspace paths or invent binary/untracked stops.

```json
{
  "version": 1,
  "comparison": {
    "vcs": "git",
    "repoRoot": ".",
    "base": { "label": "main", "commit": "<full verified commit id>" },
    "target": { "kind": "commit", "label": "HEAD", "commit": "<full verified commit id>" }
  },
  "points": [
    {
      "file": "src/example.ts",
      "side": "right",
      "line": 42,
      "anchor": "  return result;",
      "description": "The result now includes the validated fields before returning."
    }
  ]
}
```

For a worktree target, use `"target": { "kind": "worktree", "headAtAuthoring": "<full HEAD hash>" }` instead. A `file` is a repository-relative path with forward slashes and no `.`/`..` segments. `description` is a specific single-line sentence; `anchor` is the exact line on that revision side. Pin hashes even if the user gave branch names so moving branches cannot change the tour. Do not claim full coverage from a curated tour.

## Verify before handoff

- Re-read every line/side, and confirm the file belongs to the changed-text manifest; keep descriptions accurate to the requested focus.
- JSON parses and has version 1 and a nonempty ordered `points` array.
- Validate the artifact with a short local check and write it atomically. Keep implementation details out of the user's response: do not print a giant heredoc or dump every anchor; report only the artifact path and stop count.
- If validation fails, fix the selected point rather than weakening the check. Never replace an existing valid tour with an empty or partially validated artifact.
- `.vantage/diff-tour.json` is workspace state, normally git-ignored; do not commit it.
