-- the one Lua table of what thread statuses mean to the views
--
-- Registers into the shared harness; run via nvim/tests/vantage_spec.lua.
local test = require("support.harness").test
local helpers = require("support.helpers")

local eq = helpers.eq
local statuses = require("vantage.review.statuses")

test("every known status has a group the sidebar lists", function()
	local keys = {}
	for _, group in ipairs(statuses.GROUPS) do
		keys[group.key] = true
	end
	for _, status in ipairs(statuses.ORDER) do
		assert(keys[statuses.group(status)], status .. " has no listed group")
		assert(statuses.group(status) ~= "other", status .. " is unknown to the table")
	end
end)

test("needs you covers needs-input, declined and failed; with the agent covers sent and working", function()
	eq(vim.tbl_filter(statuses.needs_you, statuses.ORDER), { "needs-input", "declined", "failed" })
	eq(vim.tbl_filter(statuses.with_agent, statuses.ORDER), { "sent", "working" })
end)

test("a status the table does not know lands in Other instead of vanishing", function()
	eq(statuses.group("escalated"), "other")
	eq(statuses.highlight("escalated"), "Comment")
	eq(statuses.GROUPS[#statuses.GROUPS].key, "other")
end)
