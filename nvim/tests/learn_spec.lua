local M = {}
local tests = {}

local function test(name, fn)
	table.insert(tests, { name = name, fn = fn })
end

local function eq(actual, expected)
	assert(vim.deep_equal(actual, expected), "expected " .. vim.inspect(expected) .. " but got " .. vim.inspect(actual))
end

local function close_floating_windows()
	for _, win in ipairs(vim.api.nvim_list_wins()) do
		if vim.api.nvim_win_get_config(win).relative ~= "" then
			pcall(vim.api.nvim_win_close, win, true)
		end
	end
end

local function fresh_buffer()
	close_floating_windows()
	vim.cmd("silent! %bwipeout!")
	vim.cmd("enew!")
	vim.api.nvim_win_set_cursor(0, { 1, 0 })
end

local function last_float_text()
	local float_buf = require("learn.ui").last_float_buf()
	if not float_buf or not vim.api.nvim_buf_is_valid(float_buf) then
		return nil
	end

	return table.concat(vim.api.nvim_buf_get_lines(float_buf, 0, -1, false), "\n")
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
	local marks = annotations.current_marks(0)
	assert(#marks > 0, "expected annotation marks")
	local virt_text = marks[1][4].virt_text
	assert(virt_text and virt_text[1] and virt_text[1][1]:match("Fake annotation"), vim.inspect(marks))
	commands.toggle_annotations()
	assert(#annotations.current_marks(0) == 0, "expected annotations to clear")
end)

test("stdio backend handles multiple line-split stdout callbacks", function()
	local learn = require("learn")
	local backend = require("learn.backend")
	local responses = {}
	learn.setup({
		backend = {
			mode = "stdio",
			command = {
				"sh",
				"-c",
				[[printf '%s\n%s\n' '{"id":"1","ok":true,"result":{"kind":"explanation","markdown":"one"}}' '{"id":"2","ok":true,"result":{"kind":"explanation","markdown":"two"}}']],
			},
		},
	})

	backend.request("explainSelection", {}, function(result)
		responses[result.id] = result
	end)
	backend.request("explainSelection", {}, function(result)
		responses[result.id] = result
	end)

	vim.wait(1000, function()
		return responses["1"] ~= nil and responses["2"] ~= nil
	end)
	backend.stop()

	assert(responses["1"] ~= nil, "expected first stdio callback to fire")
	assert(responses["2"] ~= nil, "expected second stdio callback to fire")
	eq(responses["1"].result, { kind = "explanation", markdown = "one" })
	eq(responses["2"].result, { kind = "explanation", markdown = "two" })
end)

test("stdio backend opens a float through explain_current_line", function()
	local learn = require("learn")
	local commands = require("learn.commands")
	local backend = require("learn.backend")

	local ok, err = pcall(function()
		backend.stop()
		vim.wait(100, function()
			return false
		end)

		learn.setup({
			backend = {
				mode = "stdio",
				command = { "node", "server/out/neovim/stdio-server.js" },
			},
		})
		learn.set_lens("learning", "I am learning Lua syntax")

		fresh_buffer()
		vim.bo.filetype = "lua"
		vim.api.nvim_buf_set_lines(0, 0, -1, false, { "local value = 42" })

		commands.explain_current_line()
		vim.wait(2000, function()
			local text = last_float_text()
			return text and text:match("Fake provider") ~= nil
		end)

		local text = last_float_text()
		assert(text ~= nil, "expected stdio float buffer")
		assert(text:match("Fake provider"), text)
	end)

	backend.stop()
	assert(ok, err)
end)

test("stdio backend renders non-empty annotation virtual text", function()
	local learn = require("learn")
	local commands = require("learn.commands")
	local annotations = require("learn.annotations")
	local backend = require("learn.backend")

	local ok, err = pcall(function()
		backend.stop()
		annotations.clear(0)
		learn.setup({
			backend = {
				mode = "stdio",
				command = { "node", "server/out/neovim/stdio-server.js" },
			},
		})

		fresh_buffer()
		vim.bo.filetype = "lua"
		vim.api.nvim_buf_set_lines(0, 0, -1, false, {
			"local a = 1",
			"local b = a + 1",
		})

		commands.toggle_annotations()
		vim.wait(2000, function()
			local marks = annotations.current_marks(0)
			if #marks == 0 or not marks[1][4] or not marks[1][4].virt_text then
				return false
			end
			local text = marks[1][4].virt_text[1] and marks[1][4].virt_text[1][1]
			return text and text:match("Fake provider annotation") ~= nil
		end)

		local marks = annotations.current_marks(0)
		assert(#marks > 0, "expected stdio annotation marks")
		local virt_text = marks[1][4].virt_text
		assert(virt_text and virt_text[1] and virt_text[1][1]:match("Fake provider annotation"), vim.inspect(marks))
	end)

	annotations.clear(0)
	backend.stop()
	assert(ok, err)
end)

test("stdio backend error float shows readable message", function()
	local learn = require("learn")
	local commands = require("learn.commands")
	local backend = require("learn.backend")

	local ok, err = pcall(function()
		backend.stop()
		learn.setup({
			backend = {
				mode = "stdio",
				command = {
					"node",
					"-e",
					[=[
process.stdin.setEncoding('utf8');
let pending = '';
process.stdin.on('data', (chunk) => {
  pending += chunk;
  const lines = pending.split('\n');
  pending = lines.pop() || '';
  for (const line of lines) {
    if (!line.trim()) continue;
    const request = JSON.parse(line);
    console.log(JSON.stringify({
      id: request.id,
      ok: false,
      error: { code: 'bad_request', message: 'Readable backend error' }
    }));
  }
});
]=],
				},
			},
		})

		fresh_buffer()
		vim.bo.filetype = "lua"
		vim.api.nvim_buf_set_lines(0, 0, -1, false, { "local value = 42" })

		commands.explain_current_line()
		vim.wait(2000, function()
			local text = last_float_text()
			return text and text:match("Readable backend error") ~= nil
		end)

		local text = last_float_text()
		assert(text ~= nil, "expected error float buffer")
		assert(text:match("Readable backend error"), text)
		assert(not text:match("table: 0x"), text)
	end)

	backend.stop()
	assert(ok, err)
end)

function M.run()
	local failures = {}
	for _, item in ipairs(tests) do
		local ok, err = pcall(item.fn)
		if not ok then
			table.insert(failures, item.name .. ": " .. tostring(err))
		end
	end

	vim.cmd("silent! bufdo setlocal nomodified")

	if #failures > 0 then
		error(table.concat(failures, "\n"))
	end

	print("learn.nvim tests passed: " .. tostring(#tests))
end

return M
