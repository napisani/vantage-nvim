local M = {}
local tests = {}

local function test(name, fn)
	table.insert(tests, { name = name, fn = fn })
end

local function eq(actual, expected)
	assert(vim.deep_equal(actual, expected), "expected " .. vim.inspect(expected) .. " but got " .. vim.inspect(actual))
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

	vim.cmd("enew")
	vim.bo.filetype = "lua"
	vim.api.nvim_buf_set_name(0, "/tmp/learn-context.lua")
	vim.api.nvim_buf_set_lines(0, 0, -1, false, {
		"local x = 1",
		"local y = x + 1",
		"return y",
	})

	local captured = context.visible()
	eq(captured.language, "lua")
	eq(captured.filePath, "/tmp/learn-context.lua")
	eq(captured.text, "local x = 1\nlocal y = x + 1\nreturn y")
	eq(captured.visibleRange.startLine, 0)
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
