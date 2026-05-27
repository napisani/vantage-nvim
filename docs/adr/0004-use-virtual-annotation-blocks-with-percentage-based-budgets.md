# Use virtual annotation blocks with percentage-based budgets

Vantage annotations will move from terse inline hints to virtual Annotation Blocks anchored above relevant code lines. Annotation Blocks remain non-mutating overlays, while the Agent Runtime chooses count and depth within an Annotation Budget derived from the relevant lines in the requested Annotation Scope.

## Consequences

Current-line annotation remains a single anchored block. Selection, visible viewport, and full-buffer annotation use percentage-based budgets with guardrails, so larger scopes can receive broader coverage without requiring line-by-line annotations or unbounded visual noise. Annotation depth is discretionary: the lens and code determine whether a block is a short note or a richer multi-line explanation.
