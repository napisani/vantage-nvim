-- vantage.state configuration and lens storage
--
-- Registers into the shared harness; run via nvim/tests/vantage_spec.lua.
local test = require("support.harness").test
local helpers = require("support.helpers")

local eq = helpers.eq

test("state stores and clears a lens", function()
	local vantage = require("vantage")
	vantage.setup({})
	vantage.set_lens("learning", "I am learning Lua syntax")
	eq(vantage.get_lens(), { mode = "learning", text = "I am learning Lua syntax" })
	vantage.clear_lens()
	eq(vantage.get_lens(), nil)
end)

test("setup names removed config keys instead of ignoring them silently", function()
	local notified = helpers.capture_notifications(function()
		require("vantage").setup({ agent = { runtime = "pi" }, composition = { on_send = function() end } })
	end)
	assert(notified[1]:find("ignoring removed setup keys", 1, true), notified[1])
	assert(notified[1]:find("agent (", 1, true) and notified[1]:find("composition.on_send", 1, true), notified[1])
	require("vantage").setup({})
end)

test("review config has defaults that setup can override", function()
	require("vantage").setup({ review = { sidebar_width = 50 } })
	local review = require("vantage.state").config.review
	eq(review.sidebar_width, 50)
	eq(review.thread_split_height, 15)
	require("vantage").setup({})
end)
