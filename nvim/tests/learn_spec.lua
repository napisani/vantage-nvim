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

local function lua_buffer(lines)
	fresh_buffer()
	vim.bo.filetype = "lua"
	vim.api.nvim_buf_set_lines(0, 0, -1, false, lines)
end

local function last_float_text()
	local float_buf = require("learn.ui").last_float_buf()
	if not float_buf or not vim.api.nvim_buf_is_valid(float_buf) then
		return nil
	end

	return table.concat(vim.api.nvim_buf_get_lines(float_buf, 0, -1, false), "\n")
end

local function capture_notifications(run)
	local notifications = {}
	local original_notify = vim.notify
	local ok, err = pcall(function()
		vim.notify = function(message)
			table.insert(notifications, message)
		end
		run(notifications)
	end)

	vim.notify = original_notify
	assert(ok, err)
	return notifications
end

local function capture_backend_request(response, run)
	local backend = require("learn.backend")
	local original_request = backend.request
	local captured = {}
	local ok, err = pcall(function()
		backend.request = function(method, params, callback)
			captured.method = method
			captured.params = params
			if response and callback then
				callback(response)
			end
			return "captured-request"
		end
		run(captured)
	end)

	backend.request = original_request
	assert(ok, err)
	return captured
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

test("explain opens a markdown float for the current line", function()
	local learn = require("learn")
	local commands = require("learn.commands")
	learn.setup({ backend = { mode = "fake" } })
	learn.set_lens("learning", "I am learning Lua syntax")

	lua_buffer({ "local value = 42" })

	commands.explain()
	local float_buf = require("learn.ui").last_float_buf()
	assert(float_buf ~= nil, "expected a float buffer")
	local text = table.concat(vim.api.nvim_buf_get_lines(float_buf, 0, -1, false), "\n")
	assert(text:match("Explanation"), text)
	assert(text:match("Lua"), text)
	assert(text:match("local value = 42"), text)
end)

test("LearnExplain accepts an explicit line range", function()
	local learn = require("learn")

	local captured = capture_backend_request({
		ok = true,
		result = {
			kind = "explanation",
			markdown = "Range explanation",
		},
	}, function()
		learn.setup({ backend = { mode = "fake" } })
		lua_buffer({
			"local a = 1",
			"local b = 2",
			"local c = b + 1",
			"return c",
		})

		vim.cmd("2,3LearnExplain")
	end)

	eq(captured.method, "explainSelection")
	eq(captured.params.text, "local b = 2\nlocal c = b + 1")
	eq(captured.params.selectedText, "local b = 2\nlocal c = b + 1")
	eq(captured.params.range, {
		startLine = 1,
		startCharacter = 0,
		endLine = 2,
		endCharacter = 15,
	})
end)

test("registers unified explain command without selection or line variants", function()
	local learn = require("learn")
	learn.setup({ backend = { mode = "fake" } })

	assert(vim.fn.exists(":LearnExplain") == 2, "expected LearnExplain command")
	assert(vim.fn.exists(":LearnExplainSelection") == 0, "expected old selection command to be removed")
	assert(vim.fn.exists(":LearnExplainLine") == 0, "expected old line command to be removed")
end)

test("annotate renders and clear_annotations clears extmarks", function()
	local learn = require("learn")
	local commands = require("learn.commands")
	local annotations = require("learn.annotations")
	learn.setup({ backend = { mode = "fake" } })

	lua_buffer({
		"local a = 1",
		"local b = a + 1",
	})

	commands.annotate()
	local marks = annotations.current_marks(0)
	assert(#marks > 0, "expected annotation marks")
	local virt_text = marks[1][4].virt_text
	assert(virt_text and virt_text[1] and virt_text[1][1]:match("Fake annotation"), vim.inspect(marks))
	assert(marks[1][4].virt_text_pos == nil or marks[1][4].virt_text_pos == "eol", vim.inspect(marks))
	commands.clear_annotations()
	assert(#annotations.current_marks(0) == 0, "expected annotations to clear")
end)

test("annotations render additively and overwrite the exact same position", function()
	local learn = require("learn")
	local annotations = require("learn.annotations")
	learn.setup({ backend = { mode = "fake" } })

	lua_buffer({
		"local a = 1",
		"local b = a + 1",
	})

	annotations.render(0, {
		{
			text = "First line annotation.",
			severity = "info",
			range = { startLine = 0, startCharacter = 0, endLine = 0, endCharacter = 0 },
		},
	})
	annotations.render(0, {
		{
			text = "Second line annotation.",
			severity = "info",
			range = { startLine = 1, startCharacter = 0, endLine = 1, endCharacter = 0 },
		},
	})
	annotations.render(0, {
		{
			text = "Updated first line annotation.",
			severity = "info",
			range = { startLine = 0, startCharacter = 0, endLine = 0, endCharacter = 0 },
		},
	})

	local marks = annotations.current_marks(0)
	assert(#marks == 2, vim.inspect(marks))
	local texts = {}
	for _, mark in ipairs(marks) do
		table.insert(texts, mark[4].virt_text[1][1])
	end
	local combined = table.concat(texts, "\n")
	assert(combined:match("Updated first line annotation"), combined)
	assert(combined:match("Second line annotation"), combined)
	assert(not combined:match("First line annotation%."), combined)
end)

test("annotate reports request progress", function()
	local learn = require("learn")
	local commands = require("learn.commands")
	local annotations = require("learn.annotations")

	local notifications = capture_notifications(function()
		learn.setup({ backend = { mode = "fake" } })
		annotations.clear(0)
		lua_buffer({ "local value = 42" })

		commands.annotate()
	end)

	assert(notifications[1] and notifications[1]:match("requesting annotations"), vim.inspect(notifications))
	assert(notifications[#notifications] and notifications[#notifications]:match("rendered 1 annotation"), vim.inspect(notifications))
end)

test("registers explicit annotation commands without toggle command", function()
	local learn = require("learn")
	learn.setup({ backend = { mode = "fake" } })

	assert(vim.fn.exists(":LearnAnnotate") == 2, "expected LearnAnnotate command")
	assert(vim.fn.exists(":LearnAnnotationClear") == 2, "expected LearnAnnotationClear command")
	assert(vim.fn.exists(":LearnToggleAnnotations") == 0, "expected old toggle command to be removed")
end)

test("annotate cancels an in-flight annotation request and ignores its late response", function()
	local learn = require("learn")
	local commands = require("learn.commands")
	local annotations = require("learn.annotations")
	local backend = require("learn.backend")
	local original_request = backend.request
	local original_cancel = backend.cancel
	local callbacks = {}
	local request_count = 0
	local cancelled_id

	local ok, err = pcall(function()
		backend.request = function(_method, _params, callback)
			request_count = request_count + 1
			callbacks[request_count] = callback
			return "slow-annotations-" .. tostring(request_count)
		end
		backend.cancel = function(id)
			cancelled_id = id
		end

		learn.setup({ backend = { mode = "fake" } })
		annotations.clear(0)
		lua_buffer({ "local value = 42" })

		local notifications = capture_notifications(function()
			commands.annotate()
			commands.annotate()
		end)

		assert(request_count == 2, "expected second annotate to cancel and start a new request")
		assert(cancelled_id == "slow-annotations-1", "expected cancellation to propagate to backend")
		local saw_cancel = false
		for _, notification in ipairs(notifications) do
			saw_cancel = saw_cancel or notification:match("cancelled annotation request") ~= nil
		end
		assert(saw_cancel, vim.inspect(notifications))

		callbacks[1]({
			ok = true,
			result = {
				kind = "annotations",
				annotations = {
					{
						text = "Late annotation",
						severity = "info",
						range = {
							startLine = 0,
							startCharacter = 0,
							endLine = 0,
							endCharacter = 0,
						},
					},
				},
			},
		})

		assert(#annotations.current_marks(0) == 0, "expected cancelled response to be ignored")

		callbacks[2]({
			ok = true,
			result = {
				kind = "annotations",
				annotations = {
					{
						text = "Current annotation",
						severity = "info",
						range = {
							startLine = 0,
							startCharacter = 0,
							endLine = 0,
							endCharacter = 0,
						},
					},
				},
			},
		})
		assert(#annotations.current_marks(0) == 1, "expected second response to render")
	end)

	backend.request = original_request
	backend.cancel = original_cancel
	annotations.clear(0)
	assert(ok, err)
end)

test("annotate sends fast annotation candidate lines", function()
	local learn = require("learn")
	local commands = require("learn.commands")
	local annotations = require("learn.annotations")

	local captured = capture_backend_request(nil, function()
		learn.setup({ backend = { mode = "fake" } })
		annotations.clear(0)
		lua_buffer({
			"-- heading",
			"",
			"local total = 0",
			"for index = 1, 3 do",
			"  total = total + index",
			"end",
		})
		vim.api.nvim_win_set_cursor(0, { 3, 0 })

		commands.annotate()
		commands.clear_annotations()
	end)

	annotations.clear(0)
	eq(captured.params.candidateLines, {
		{ line = 2, text = "local total = 0" },
		{ line = 3, text = "for index = 1, 3 do" },
		{ line = 4, text = "  total = total + index" },
	})
end)

test("LearnAnnotate accepts an explicit line range", function()
	local learn = require("learn")
	local annotations = require("learn.annotations")

	local captured = capture_backend_request({
		ok = true,
		result = {
			kind = "annotations",
			annotations = {
				{
					text = "Range annotation",
					severity = "info",
					range = {
						startLine = 1,
						startCharacter = 0,
						endLine = 1,
						endCharacter = 9,
					},
				},
			},
		},
	}, function()
		learn.setup({ backend = { mode = "fake" } })
		annotations.clear(0)
		lua_buffer({
			"local a = 1",
			"local b = 2",
			"local c = b + 1",
			"return c",
		})

		vim.cmd("2,4LearnAnnotate")
	end)

	annotations.clear(0)
	eq(captured.method, "annotateRange")
	eq(captured.params.scopeText, "local b = 2\nlocal c = b + 1\nreturn c")
	eq(captured.params.visibleRange, {
		startLine = 1,
		startCharacter = 0,
		endLine = 3,
		endCharacter = 8,
	})
	eq(captured.params.range, {
		startLine = 1,
		startCharacter = 0,
		endLine = 3,
		endCharacter = 8,
	})
	eq(captured.params.candidateLines, {
		{ line = 0, text = "local b = 2" },
		{ line = 1, text = "local c = b + 1" },
		{ line = 2, text = "return c" },
	})
end)

test("annotate waiting status includes provider and elapsed time", function()
	local learn = require("learn")
	local commands = require("learn.commands")
	local backend = require("learn.backend")
	local original_request = backend.request

	local ok, err = pcall(function()
		backend.request = function()
			-- Keep the request in-flight so the waiting status can fire.
		end

		learn.setup({
			backend = { mode = "fake" },
			annotations = { waiting_message_ms = 10 },
		})
		lua_buffer({ "local value = 42" })

		capture_notifications(function(notifications)
			commands.annotate()
			local saw_waiting_status = vim.wait(200, function()
				for _, notification in ipairs(notifications) do
					if notification:match("still waiting for annotations from fake") and notification:match("after 0%.") then
						return true
					end
				end
				return false
			end)
			assert(saw_waiting_status, vim.inspect(notifications))
			commands.clear_annotations()
		end)
	end)

	backend.request = original_request
	learn.setup({ annotations = { waiting_message_ms = 30000 } })
	assert(ok, err)
end)

test("annotations skip out-of-range lines", function()
	local learn = require("learn")
	local annotations = require("learn.annotations")
	learn.setup({ backend = { mode = "fake" } })

	lua_buffer({ "only one line" })

	local count = annotations.render(0, {
		{
			text = "Out of range.",
			range = {
				startLine = 99,
				startCharacter = 0,
				endLine = 99,
				endCharacter = 0,
			},
		},
	})

	assert(count == 0, "expected no rendered annotations")
	assert(#annotations.current_marks(0) == 0, "expected out-of-range annotation to be skipped")
	assert(not annotations.is_enabled(), "expected annotations to stay disabled")
end)

test("annotate shows a readable empty-result message", function()
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
      ok: true,
      result: { kind: 'annotations', annotations: [] }
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

		commands.annotate()
		vim.wait(2000, function()
			local text = last_float_text()
			return text and text:match("No annotations") ~= nil
		end)

		local text = last_float_text()
		assert(text ~= nil, "expected no-annotations float")
		assert(text:match("No annotations"), text)
		assert(#annotations.current_marks(0) == 0, "expected no annotation marks")
		assert(not annotations.is_enabled(), "expected annotations to stay disabled")
	end)

	backend.stop()
	assert(ok, err)
end)

test("stdio backend handles multiple line-split stdout callbacks", function()
	local learn = require("learn")
	local backend = require("learn.backend")
	local responses = {}
	backend.stop()
	vim.wait(100, function()
		return false
	end)

	learn.setup({
		backend = {
			mode = "stdio",
			command = {
				"node",
				"-e",
				[=[
process.stdin.setEncoding('utf8');
process.stdin.resume();
let pending = '';
let count = 0;
let writing = false;
const queue = [];
function flushQueue() {
  if (writing || queue.length === 0) return;
  writing = true;
  const response = queue.shift();
  process.stdout.write(response.slice(0, 12));
  setTimeout(() => {
    process.stdout.write(response.slice(12));
    writing = false;
    flushQueue();
  }, 5);
}
process.stdin.on('data', (chunk) => {
  pending += chunk;
  const lines = pending.split('\n');
  pending = lines.pop() || '';
  for (const line of lines) {
    if (!line.trim()) continue;
    count += 1;
    const request = JSON.parse(line);
    const response = JSON.stringify({
      id: request.id,
      ok: true,
      result: { kind: 'explanation', markdown: count === 1 ? 'one' : 'two' }
    }) + '\n';
    queue.push(response);
    flushQueue();
  }
});
]=],
			},
		},
	})

	backend.request("explainSelection", {}, function(result)
		table.insert(responses, result)
	end)
	backend.request("explainSelection", {}, function(result)
		table.insert(responses, result)
	end)

	vim.wait(3000, function()
		return #responses == 2
	end)
	backend.stop()

	assert(#responses == 2, "expected two stdio callbacks to fire")
	eq(responses[1].result, { kind = "explanation", markdown = "one" })
	eq(responses[2].result, { kind = "explanation", markdown = "two" })
end)

test("stdio backend opens a float through explain", function()
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

		commands.explain()
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

		commands.annotate()
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

		commands.explain()
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
