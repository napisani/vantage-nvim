-- how annotations render as virtual blocks, and clearing them
--
-- Registers into the shared harness; run via nvim/tests/vantage_spec.lua.
local test = require("support.harness").test
local helpers = require("support.helpers")

local eq = helpers.eq
local lua_buffer = helpers.lua_buffer

test("annotations render as wrapped above-line virtual blocks", function()
	local vantage = require("vantage")
	local annotations = require("vantage.annotations")
	vantage.setup({})

	lua_buffer({
		"local value = compute_value(input)",
	})
	vim.o.columns = 48

	annotations.render(0, {
		{
			text = "The `compute_value` call is where the incoming `input` crosses into domain-specific transformation logic, so this line is the best anchor for understanding the data flow under the lens.",
			severity = "info",
			range = { startLine = 1, startCharacter = 1, endLine = 1, endCharacter = 32 },
		},
	})

	local marks = annotations.current_marks(0)
	assert(#marks == 1, vim.inspect(marks))
	local details = marks[1][4]
	eq(details.virt_lines_above, true)
	assert(#details.virt_lines >= 2, vim.inspect(details.virt_lines))
	assert(details.virt_lines[1][1][1]:match("compute_value"), vim.inspect(details.virt_lines))
	assert(details.virt_text == nil, vim.inspect(details))
	annotations.clear(0)
end)

test("annotations render additively and overwrite the exact same position", function()
	local vantage = require("vantage")
	local annotations = require("vantage.annotations")
	vantage.setup({})

	lua_buffer({
		"local a = 1",
		"local b = a + 1",
	})

	annotations.render(0, {
		{
			text = "First line annotation.",
			severity = "info",
			range = { startLine = 1, startCharacter = 1, endLine = 1, endCharacter = 0 },
		},
	})
	annotations.render(0, {
		{
			text = "Second line annotation.",
			severity = "info",
			range = { startLine = 2, startCharacter = 1, endLine = 2, endCharacter = 0 },
		},
	})
	annotations.render(0, {
		{
			text = "Updated first line annotation.",
			severity = "info",
			range = { startLine = 1, startCharacter = 1, endLine = 1, endCharacter = 0 },
		},
	})

	local marks = annotations.current_marks(0)
	assert(#marks == 2, vim.inspect(marks))
	local texts = {}
	for _, mark in ipairs(marks) do
		table.insert(texts, mark[4].virt_lines[1][1][1])
	end
	local combined = table.concat(texts, "\n")
	assert(combined:match("Updated first line annotation"), combined)
	assert(combined:match("Second line annotation"), combined)
	assert(not combined:match("First line annotation%."), combined)
end)

test("annotations skip out-of-range lines", function()
	local vantage = require("vantage")
	local annotations = require("vantage.annotations")
	vantage.setup({})

	lua_buffer({ "only one line" })

	local count = annotations.render(0, {
		{
			text = "Out of range.",
			range = {
				startLine = 100,
				startCharacter = 1,
				endLine = 100,
				endCharacter = 0,
			},
		},
	})

	assert(count == 0, "expected no rendered annotations")
	assert(#annotations.current_marks(0) == 0, "expected out-of-range annotation to be skipped")
	assert(not annotations.is_enabled(), "expected annotations to stay disabled")
end)
