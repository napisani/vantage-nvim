# The adjacent Pi agent is Vantage's only runtime

Vantage runs no model. Every model-backed action, including annotate and
explain, is a request to the Pi agent running beside the editor, answered in
that agent's own conversation through reply tools that the `pi-vantage-nvim`
extension registers. Neovim talks to the extension directly over an owner-only
Unix socket; the extension owns review state and persists it in the Pi session
log. This supersedes ADR 0001 (agent context file), 0002 (Pi as Vantage's own
runtime) and 0003 (Vantage-owned Pi sessions): the one-way context file, the
buddy session, the fork-per-request bridge and the Node backend are gone. The
cost is that nothing model-backed works without a running agent, and annotate
waits behind the agent's other work.
