-- Entry point for the Lua suite: `require("vantage_spec").run()`.
--
-- Tests live in one module per subject under nvim/tests/spec/. Each registers
-- itself into support/harness at require time, so adding a spec module means
-- adding one line to SPECS below -- and adding a test to an existing subject
-- means touching only that subject's file.
--
-- Shared fixtures live in support/helpers.lua. To run a single subject while
-- iterating:
--
--   nvim --headless -u nvim/tests/minimal_init.lua \
--     -c "lua require('spec.review_spec'); require('support.harness').run()" -c qa
local harness = require("support.harness")

local SPECS = {
	-- plumbing
	"state",
	"history",
	"history_store",
	"monitor",
	"monitor_ring",
	"monitor_source",
	"context",
	"input",
	"commands",
	"protocol",
	"anchors",
	"statuses",
	"debug_log",

	-- the review with the agent
	"review",
	"annotation",
	"annotation_render",
	"walkthrough",
	"diff_tour",
	"lens",

	-- surfaces
	"prompt_buffer",
	"composition",
	"monitor_navigate",
	"monitor_lifecycle",
	"health",
}

for _, name in ipairs(SPECS) do
	require("spec." .. name .. "_spec")
end

local M = {}

M.run = harness.run

return M
