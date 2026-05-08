local M = {}
local tests = {}

local function test(name, fn)
	table.insert(tests, { name = name, fn = fn })
end

local function eq(actual, expected)
	assert(vim.deep_equal(actual, expected), "expected " .. vim.inspect(expected) .. " but got " .. vim.inspect(actual))
end

local function fresh_buffer()
	vim.cmd("silent! %bwipeout!")
	vim.cmd("enew!")
end

test("state stores and clears a lens", function()
	local learn = require("learn")
	learn.setup({ backend = { mode = "fake" } })
	learn.set_lens("learning", "I am learning Lua syntax")
	eq(learn.get_lens(), { mode = "learning", text = "I am learning Lua syntax" })
	learn.clear_lens()
	eq(learn.get_lens(), nil)
end)

test("context captures visible buffer text", function()
	local learn = require("learn")
	local context = require("learn.context")
	learn.setup({ backend = { mode = "fake" } })

	fresh_buffer()
	vim.bo.filetype = "lua"
	vim.api.nvim_buf_set_name(0, vim.fn.getcwd() .. "/nvim/tests/learn-context.lua")
	vim.api.nvim_buf_set_lines(0, 0, -1, false, {
		"local x = 1",
		"local y = x + 1",
		"return y",
	})

	local captured = context.visible()
	eq(captured.language, "lua")
	eq(captured.filePath, vim.fn.getcwd() .. "/nvim/tests/learn-context.lua")
	eq(captured.text, "local x = 1\nlocal y = x + 1\nreturn y")
	eq(captured.visibleRange.startLine, 0)
end)

test("context uses absolute file path for relative buffer name", function()
	local learn = require("learn")
	local context = require("learn.context")
	learn.setup({ backend = { mode = "fake" } })

	fresh_buffer()
	vim.api.nvim_buf_set_name(0, "nvim/tests/relative-context.lua")

	local captured = context.visible()
	eq(captured.filePath, vim.fn.getcwd() .. "/nvim/tests/relative-context.lua")
end)

test("selection captures only selected text within a line", function()
	local learn = require("learn")
	local context = require("learn.context")
	learn.setup({ backend = { mode = "fake" } })

	fresh_buffer()
	vim.api.nvim_buf_set_lines(0, 0, -1, false, {
		"local value = compute_result()",
	})
	vim.fn.setpos("'<", { 0, 1, 7, 0 })
	vim.fn.setpos("'>", { 0, 1, 11, 0 })

	local captured = context.selection()
	eq(captured.selectedText, "value")
	eq(captured.range, {
		startLine = 0,
		startCharacter = 6,
		endLine = 0,
		endCharacter = 11,
	})
end)

test("selection includes the full final multibyte character", function()
	local learn = require("learn")
	local context = require("learn.context")
	learn.setup({ backend = { mode = "fake" } })

	fresh_buffer()
	vim.api.nvim_buf_set_lines(0, 0, -1, false, {
		"drink café today",
	})
	vim.fn.setpos("'<", { 0, 1, 7, 0 })
	vim.fn.setpos("'>", { 0, 1, 10, 0 })

	local captured = context.selection()
	eq(captured.selectedText, "café")
	eq(captured.range, {
		startLine = 0,
		startCharacter = 6,
		endLine = 0,
		endCharacter = 11,
	})
end)

test("selection normalizes reversed multi-line marks", function()
	local learn = require("learn")
	local context = require("learn.context")
	learn.setup({ backend = { mode = "fake" } })

	fresh_buffer()
	vim.api.nvim_buf_set_lines(0, 0, -1, false, {
		"abcDEFG",
		"HIJKLmn",
	})
	vim.fn.setpos("'<", { 0, 2, 5, 0 })
	vim.fn.setpos("'>", { 0, 1, 4, 0 })

	local captured = context.selection()
	eq(captured.selectedText, "DEFG\nHIJKL")
	eq(captured.range, {
		startLine = 0,
		startCharacter = 3,
		endLine = 1,
		endCharacter = 5,
	})
end)

test("explain_current_line opens a markdown float", function()
	local learn = require("learn")
	local commands = require("learn.commands")
	learn.setup({ backend = { mode = "fake" } })
	learn.set_lens("learning", "I am learning Lua syntax")

	fresh_buffer()
	vim.bo.filetype = "lua"
	vim.api.nvim_buf_set_lines(0, 0, -1, false, { "local value = 42" })

	commands.explain_current_line()
	local float_buf = require("learn.ui").last_float_buf()
	assert(float_buf ~= nil, "expected a float buffer")
	local text = table.concat(vim.api.nvim_buf_get_lines(float_buf, 0, -1, false), "\n")
	assert(text:match("Explanation"), text)
	assert(text:match("Lua"), text)
end)

test("toggle_annotations renders and clears extmarks", function()
	local learn = require("learn")
	local commands = require("learn.commands")
	local annotations = require("learn.annotations")
	learn.setup({ backend = { mode = "fake" } })

	fresh_buffer()
	vim.bo.filetype = "lua"
	vim.api.nvim_buf_set_lines(0, 0, -1, false, {
		"local a = 1",
		"local b = a + 1",
	})

	commands.toggle_annotations()
	assert(#annotations.current_marks(0) > 0, "expected annotation marks")
	commands.toggle_annotations()
	assert(#annotations.current_marks(0) == 0, "expected annotations to clear")
end)

function M.run()
	local failures = {}
	for _, item in ipairs(tests) do
		local ok, err = pcall(item.fn)
		if not ok then
			table.insert(failures, item.name .. ": " .. tostring(err))
		end
	end

	if #failures > 0 then
		error(table.concat(failures, "\n"))
	end

	vim.cmd("silent! bufdo setlocal nomodified")
	print("learn.nvim tests passed: " .. tostring(#tests))
end

return M
