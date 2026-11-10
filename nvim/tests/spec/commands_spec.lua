-- user-command registration and the Lua API rule
--
-- Registers into the shared harness; run via nvim/tests/vantage_spec.lua.
local test = require("support.harness").test

test("every command name is registered", function()
	local vantage = require("vantage")
	vantage.setup({})
	for _, name in ipairs(vantage.CommandNames.all) do
		assert(vim.fn.exists(":" .. name) == 2, "expected :" .. name)
	end
end)

test("commands of the model-running Vantage are gone", function()
	require("vantage").setup({})
	for _, name in ipairs({ "VantageQuestion", "VantageEdit", "VantageSearch", "VantageSessionOutput", "VantageAgentReset", "VantageLastTurn", "VantageGenerateWalkthrough", "VantageLoadDiffTour", "VantageModel" }) do
		assert(vim.fn.exists(":" .. name) == 0, "expected :" .. name .. " to be removed")
	end
end)

test("every command has a public Lua function", function()
	local vantage = require("vantage")
	local functions = {
		"set_lens", "clear_lens", "ask", "explain", "request", "request_now", "send_round", "recall_round", "reply", "cancel",
		"resolve", "clear_resolved", "thread_peek", "thread_open", "thread_next", "thread_prev", "thread_refs_to_quickfix",
		"pick_thread", "sidebar", "walkthrough", "diff_tour", "tour_next", "tour_prev", "tour_clear", "set_review_base",
		"clear_review_base", "review_files", "annotate", "clear_annotations", "connect", "status", "health", "debug_log",
		"compose", "compose_send", "compose_clear", "history_pick", "history_clear_workspace", "history_clear_all", "monitor",
	}
	for _, name in ipairs(functions) do
		assert(type(vantage[name]) == "function", "expected vantage." .. name)
	end
	assert(#functions == #vantage.CommandNames.all, "one function per command")
end)
