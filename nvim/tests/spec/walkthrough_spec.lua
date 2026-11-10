-- walkthroughs from review state: quickfix, notes on open buffers, navigation,
-- and the :VantageWalkthrough request
--
-- Registers into the shared harness; run via nvim/tests/vantage_spec.lua.
local test = require("support.harness").test
local helpers = require("support.helpers")

local eq = helpers.eq
local fresh_buffer = helpers.fresh_buffer
local temp_workspace = helpers.temp_workspace
local set_buffer_path = helpers.set_buffer_path
local writefile = helpers.writefile
local capture_actions = helpers.capture_actions

local function open_fixture(root, lines)
	require("vantage").setup({})
	require("vantage.walkthrough").disarm()
	require("vantage.annotations").clear_all()
	fresh_buffer()
	vim.fn.mkdir(root .. "/lua", "p")
	local file = root .. "/lua/example.lua"
	writefile(file, table.concat(lines, "\n") .. "\n")
	set_buffer_path(file)
	vim.api.nvim_buf_set_lines(0, 0, -1, false, lines)
	return vim.api.nvim_get_current_buf()
end

local function tour(stops)
	return { id = "tour-1", kind = "walkthrough", title = "Derivation", summary = "s", stops = stops, createdAt = "" }
end

local function stop(line, title, note)
	return { ref = { path = "lua/example.lua", startLine = line, endLine = line, side = "current" }, title = title, note = note }
end

test("loading a walkthrough fills quickfix and draws notes on open buffers", function()
	local annotations = require("vantage.annotations")
	local root = temp_workspace()
	local bufnr = open_fixture(root, { "local a = 1", "local b = a + 1" })
	require("vantage.walkthrough").load(tour({ stop(2, "Derive", "b derives from a.") }), root)

	local qf = vim.fn.getqflist({ title = 1, items = 1 })
	eq(qf.title, "Vantage walkthrough: Derivation")
	eq(#qf.items, 1)
	eq(qf.items[1].lnum, 2)
	eq(qf.items[1].text, "Derive: b derives from a.")
	local marks = annotations.current_marks(bufnr)
	eq(#marks, 1)
	eq(marks[1][4].virt_lines[1][1][1], "Derive: b derives from a.")
	eq(marks[1][4].virt_lines_above, true)
	require("vantage.walkthrough").disarm()
	annotations.clear_all()
end)

test("notes render on buffer entry and VantageAnnotationClear disarms them", function()
	local annotations = require("vantage.annotations")
	local root = temp_workspace()
	local bufnr = open_fixture(root, { "local a = 1", "local b = a + 1" })
	require("vantage.walkthrough").load(tour({ stop(2, "Derive", "b derives from a.") }), root)

	annotations.clear(bufnr)
	vim.cmd("enew")
	vim.api.nvim_set_current_buf(bufnr)
	eq(#annotations.current_marks(bufnr), 1)

	vim.cmd("VantageAnnotationClear")
	eq(#annotations.current_marks(bufnr), 0)
	vim.cmd("enew")
	vim.api.nvim_set_current_buf(bufnr)
	eq(#annotations.current_marks(bufnr), 0)
end)

test("next and prev move between stops through quickfix", function()
	local root = temp_workspace()
	open_fixture(root, { "local a = 1", "local b = a + 1", "return b" })
	local walkthrough = require("vantage.walkthrough")
	walkthrough.load(tour({ stop(1, "A", "first"), stop(3, "C", "last") }), root, { open = true })
	vim.cmd("wincmd p")
	eq(vim.api.nvim_win_get_cursor(0)[1], 1)
	walkthrough.next()
	eq(vim.api.nvim_win_get_cursor(0)[1], 3)
	walkthrough.prev()
	eq(vim.api.nvim_win_get_cursor(0)[1], 1)
	vim.cmd("cclose")
	walkthrough.disarm()
	require("vantage.annotations").clear_all()
end)

test(":VantageWalkthrough sends the prompt, anchored to a selected range", function()
	local captured = capture_actions(function()
		require("vantage").setup({})
		helpers.lua_buffer({ "local a = 1", "local b = a + 1" })
		vim.api.nvim_buf_set_name(0, vim.fn.getcwd() .. "/nvim/tests/walkthrough-fixture.lua")
		vim.cmd("VantageWalkthrough how does this start?")
		vim.cmd("1,2VantageWalkthrough explain how b is derived")
	end, { threadId = "W1" })
	eq(captured[1].type, "walkthrough")
	eq(captured[1].text, "how does this start?")
	eq(captured[1].anchor, nil)
	eq(captured[2].text, "explain how b is derived")
	eq(captured[2].anchor.startLine, 1)
	eq(captured[2].anchor.endLine, 2)
end)
