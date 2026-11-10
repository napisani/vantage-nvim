-- the ui.input provider abstraction
--
-- Registers into the shared harness; run via nvim/tests/vantage_spec.lua.
local test = require("support.harness").test
local helpers = require("support.helpers")

local eq = helpers.eq
local with_ui_input = helpers.with_ui_input
local with_fn_input = helpers.with_fn_input

test("the lens prompt can force the ui2 input provider", function()
	local vantage = require("vantage")
	local prompts = {}
	vantage.setup({ ui = { input = { provider = "ui2", lens = { prompt = "UI2 lens: " } } } })
	with_ui_input(function()
		error("expected Vantage to bypass vim.ui.input when ui2 provider is configured")
	end, function()
		with_fn_input(function(opts)
			table.insert(prompts, opts.prompt)
			return "Prefer concrete examples"
		end, function()
			vim.cmd("VantageSetLens learning")
		end)
	end)
	eq(prompts, { "UI2 lens: " })
	eq(vantage.get_lens(), { mode = "learning", text = "Prefer concrete examples" })
	vantage.setup({})
end)
