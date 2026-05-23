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

local function temp_workspace()
	local root = vim.fn.tempname()
	vim.fn.mkdir(root .. "/.git", "p")
	vim.fn.mkdir(root .. "/.vantage", "p")
	return root
end

local function set_buffer_path(path)
	vim.api.nvim_buf_set_name(0, path)
end

local function writefile(path, text)
	local fd = assert(vim.loop.fs_open(path, "w", 420))
	assert(vim.loop.fs_write(fd, text, 0))
	vim.loop.fs_close(fd)
end

local function last_float_text()
	local float_buf = require("vantage.ui").last_float_buf()
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
	local backend = require("vantage.backend")
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

test("default stdio backend command resolves from plugin root", function()
	local state = require("vantage.state")

	eq(state.config.backend.mode, "stdio")
	eq(state.config.backend.command, {
		"node",
		vim.fn.getcwd() .. "/server/out/neovim/stdio-server.js",
	})
end)

test("stdio backend sends provider config from setup", function()
	local vantage = require("vantage")
	local backend = require("vantage.backend")
	local responses = {}

	backend.stop()
	vantage.setup({
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
      result: { kind: 'explanation', markdown: JSON.stringify(request.config) }
    }));
  }
});
]=],
			},
		},
		provider = {
			name = "ollama",
			ollama = {
				base_url = "http://127.0.0.1:11435",
				model = "qwen-test",
				timeout_ms = 120000,
			},
		},
	})

	backend.request("explainSelection", {}, function(result)
		table.insert(responses, result)
	end)

	vim.wait(3000, function()
		return #responses == 1
	end)
	backend.stop()

	assert(#responses == 1, "expected one stdio response")
	local config = vim.json.decode(responses[1].result.markdown)
	eq(config, {
		provider = {
			name = "ollama",
			ollama = {
				base_url = "http://127.0.0.1:11435",
				model = "qwen-test",
				timeout_ms = 120000,
			},
		},
	})
end)

test("stdio backend reports exit to pending callbacks", function()
	local vantage = require("vantage")
	local backend = require("vantage.backend")
	local responses = {}

	backend.stop()
	vantage.setup({
		backend = {
			mode = "stdio",
			command = {
				"node",
				"-e",
				[=[
process.stdin.resume();
process.stdin.on('data', () => process.exit(7));
]=],
			},
		},
	})

	backend.request("explainSelection", {}, function(result)
		table.insert(responses, result)
	end)

	vim.wait(2000, function()
		return #responses == 1
	end)
	backend.stop()

	assert(#responses == 1, "expected backend exit to invoke pending callback")
	assert(responses[1].ok == false, vim.inspect(responses[1]))
	assert(tostring(responses[1].error.message):match("exited"), vim.inspect(responses[1]))
end)

test("state stores and clears a lens", function()
	local vantage = require("vantage")
	vantage.setup({ backend = { mode = "fake" } })
	vantage.set_lens("learning", "I am learning Lua syntax")
	eq(vantage.get_lens(), { mode = "learning", text = "I am learning Lua syntax" })
	vantage.clear_lens()
	eq(vantage.get_lens(), nil)
end)

test("context captures visible buffer text", function()
	local vantage = require("vantage")
	local context = require("vantage.context")
	vantage.setup({ backend = { mode = "fake" } })

	fresh_buffer()
	vim.bo.filetype = "lua"
	vim.api.nvim_buf_set_name(0, vim.fn.getcwd() .. "/nvim/tests/vantage-context.lua")
	vim.api.nvim_buf_set_lines(0, 0, -1, false, {
		"local x = 1",
		"local y = x + 1",
		"return y",
	})

	local captured = context.visible()
	eq(captured.language, "lua")
	eq(captured.filePath, vim.fn.getcwd() .. "/nvim/tests/vantage-context.lua")
	eq(captured.text, "local x = 1\nlocal y = x + 1\nreturn y")
	eq(captured.visibleRange.startLine, 0)
end)

test("agent context reads workspace markdown with tail truncation metadata", function()
	local vantage = require("vantage")
	local agent_context = require("vantage.agent_context")
	local root = temp_workspace()
	local context_path = root .. "/.vantage/agent-context.md"

	vantage.setup({
		backend = { mode = "fake" },
		agent_context = {
			max_bytes = 18,
		},
	})

	fresh_buffer()
	set_buffer_path(root .. "/lua/example.lua")
	writefile(context_path, "# Agent Task Context\n\n## Recent Progress\nImplemented reader")

	local snapshot = agent_context.snapshot()

	eq(snapshot.status, "included")
	eq(snapshot.workspace_root, root)
	eq(snapshot.path, context_path)
	eq(snapshot.exists, true)
	eq(snapshot.truncated, true)
	eq(snapshot.included_bytes, 18)
	eq(snapshot.context.path, context_path)
	eq(snapshot.context.truncated, true)
	eq(snapshot.context.content, "Implemented reader")
	assert(type(snapshot.context.ageMs) == "number", vim.inspect(snapshot.context))
	assert(type(snapshot.context.modifiedAt) == "string", vim.inspect(snapshot.context))
end)

test("agent context status reports missing context without failing commands", function()
	local vantage = require("vantage")
	local agent_context = require("vantage.agent_context")
	local root = temp_workspace()

	vantage.setup({ backend = { mode = "fake" } })
	fresh_buffer()
	set_buffer_path(root .. "/lua/example.lua")

	local snapshot = agent_context.snapshot()

	eq(snapshot.status, "missing")
	eq(snapshot.exists, false)
	eq(snapshot.context, nil)
end)

test("VantageExplain attaches agent context when available", function()
	local vantage = require("vantage")
	local root = temp_workspace()

	vantage.setup({ backend = { mode = "fake" } })
	lua_buffer({ "local value = 42" })
	set_buffer_path(root .. "/lua/example.lua")
	writefile(root .. "/.vantage/agent-context.md", "# Agent Task Context\n\n## Goal\nExplain reader")

	local captured = capture_backend_request({
		ok = true,
		result = { kind = "explanation", markdown = "ok" },
	}, function()
		vim.cmd("VantageExplain")
	end)

	eq(captured.method, "explainSelection")
	assert(captured.params.agentContext, vim.inspect(captured.params))
	eq(captured.params.agentContext.content, "# Agent Task Context\n\n## Goal\nExplain reader")
	eq(captured.params.agentContext.truncated, false)
end)

test("VantageContextStatus shows context availability on demand", function()
	local vantage = require("vantage")
	local commands = require("vantage.commands")
	local root = temp_workspace()

	vantage.setup({ backend = { mode = "fake" } })
	fresh_buffer()
	set_buffer_path(root .. "/lua/example.lua")
	writefile(root .. "/.vantage/agent-context.md", "# Agent Task Context\n\n## Goal\nShow status")

	commands.show_agent_context_status()

	local text = last_float_text()
	assert(text ~= nil, "expected context status float")
	assert(text:match("Vantage Agent Context Status"), text)
	assert(text:match("Status: included"), text)
	assert(text:match("%.vantage/agent%-context%.md"), text)
end)

test("context uses absolute file path for relative buffer name", function()
	local vantage = require("vantage")
	local context = require("vantage.context")
	vantage.setup({ backend = { mode = "fake" } })

	fresh_buffer()
	vim.api.nvim_buf_set_name(0, "nvim/tests/relative-context.lua")

	local captured = context.visible()
	eq(captured.filePath, vim.fn.getcwd() .. "/nvim/tests/relative-context.lua")
end)

test("explain opens a markdown float for the current line", function()
	local vantage = require("vantage")
	local commands = require("vantage.commands")
	vantage.setup({ backend = { mode = "fake" } })
	vantage.set_lens("learning", "I am learning Lua syntax")

	lua_buffer({ "local value = 42" })

	commands.explain()
	local float_buf = require("vantage.ui").last_float_buf()
	assert(float_buf ~= nil, "expected a float buffer")
	local text = table.concat(vim.api.nvim_buf_get_lines(float_buf, 0, -1, false), "\n")
	assert(text:match("Explanation"), text)
	assert(text:match("Lua"), text)
	assert(text:match("local value = 42"), text)
end)

test("VantageExplain accepts an explicit line range", function()
	local vantage = require("vantage")

	local captured = capture_backend_request({
		ok = true,
		result = {
			kind = "explanation",
			markdown = "Range explanation",
		},
	}, function()
		vantage.setup({ backend = { mode = "fake" } })
		lua_buffer({
			"local a = 1",
			"local b = 2",
			"local c = b + 1",
			"return c",
		})

		vim.cmd("2,3VantageExplain")
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
	local vantage = require("vantage")

	vantage.setup({ backend = { mode = "fake" } })

	assert(vim.fn.exists(":VantageExplain") == 2, "expected VantageExplain command")
	assert(vim.fn.exists(":VantageExplainSelection") == 0, "expected old selection command to be removed")
	assert(vim.fn.exists(":VantageExplainLine") == 0, "expected old line command to be removed")
end)

test("annotate renders and clear_annotations clears extmarks", function()
	local vantage = require("vantage")
	local commands = require("vantage.commands")
	local annotations = require("vantage.annotations")
	vantage.setup({ backend = { mode = "fake" } })

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
	local vantage = require("vantage")
	local annotations = require("vantage.annotations")
	vantage.setup({ backend = { mode = "fake" } })

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
	local vantage = require("vantage")
	local commands = require("vantage.commands")
	local annotations = require("vantage.annotations")

	local notifications = capture_notifications(function()
		vantage.setup({ backend = { mode = "fake" } })
		annotations.clear(0)
		lua_buffer({ "local value = 42" })

		commands.annotate()
	end)

	assert(notifications[1] and notifications[1]:match("requesting annotations"), vim.inspect(notifications))
	assert(notifications[#notifications] and notifications[#notifications]:match("rendered 1 annotation"), vim.inspect(notifications))
	local status = commands.annotation_status()
	eq(status.status, "rendered")
	eq(status.received, 1)
	eq(status.rendered, 1)
end)

test("annotation status reports returned annotations that did not render", function()
	local vantage = require("vantage")
	local commands = require("vantage.commands")
	local annotations = require("vantage.annotations")

	vantage.setup({ backend = { mode = "fake" } })
	annotations.clear(0)
	lua_buffer({ "local value = 42" })

	capture_backend_request({
		ok = true,
		result = {
			kind = "annotations",
			annotations = {
				{
					text = "Out of range annotation",
					severity = "info",
					range = {
						startLine = 99,
						startCharacter = 0,
						endLine = 99,
						endCharacter = 0,
					},
				},
			},
		},
	}, function()
		commands.annotate()
	end)

	local status = commands.annotation_status()
	eq(status.status, "no_visible_annotations")
	eq(status.received, 1)
	eq(status.rendered, 0)
	eq(status.skipped, 1)
	assert(status.message:match("not visible"), status.message)
end)

test("registers explicit annotation commands without toggle command", function()
	local vantage = require("vantage")

	vantage.setup({ backend = { mode = "fake" } })

	assert(vim.fn.exists(":VantageAnnotate") == 2, "expected VantageAnnotate command")
	assert(vim.fn.exists(":VantageAnnotationClear") == 2, "expected VantageAnnotationClear command")
	assert(vim.fn.exists(":VantageToggleAnnotations") == 0, "expected old toggle command to be removed")
end)

test("annotate cancels an in-flight annotation request and ignores its late response", function()
	local vantage = require("vantage")
	local commands = require("vantage.commands")
	local annotations = require("vantage.annotations")
	local backend = require("vantage.backend")
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

		vantage.setup({ backend = { mode = "fake" } })
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

test("annotate times out when the backend leaves the request pending", function()
	local vantage = require("vantage")
	local commands = require("vantage.commands")
	local backend = require("vantage.backend")
	local original_request = backend.request
	local original_cancel = backend.cancel
	local cancelled_id

	local ok, err = pcall(function()
		backend.request = function()
			return "orphaned-annotations"
		end
		backend.cancel = function(id)
			cancelled_id = id
		end

		vantage.setup({
			backend = { mode = "stdio" },
			provider = {
				name = "pi",
				pi = {
					provider = "openai",
					model = "gpt-4o-mini",
					annotation_timeout_ms = 20,
				},
			},
		})
		lua_buffer({ "local value = 42" })

		commands.annotate()
		vim.wait(500, function()
			return commands.annotation_status().status == "failed"
		end)

		local status = commands.annotation_status()
		eq(status.status, "failed")
		assert(status.error:match("timed out"), vim.inspect(status))
		assert(cancelled_id == "orphaned-annotations", "expected timeout to cancel backend request")
	end)

	backend.request = original_request
	backend.cancel = original_cancel
	assert(ok, err)
end)

test("annotate defaults to the current line", function()
	local vantage = require("vantage")
	local commands = require("vantage.commands")
	local annotations = require("vantage.annotations")

	local captured = capture_backend_request(nil, function()
		vantage.setup({ backend = { mode = "fake" } })
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
	eq(captured.params.text, "local total = 0")
	eq(captured.params.scopeText, "local total = 0")
	eq(captured.params.visibleRange, {
		startLine = 2,
		startCharacter = 0,
		endLine = 2,
		endCharacter = 15,
	})
	eq(captured.params.maxAnnotations, 1)
	eq(captured.params.candidateLines, {
		{ line = 0, text = "local total = 0" },
	})
end)

test("VantageAnnotate line scopes annotation to the current line", function()
	local vantage = require("vantage")
	local commands = require("vantage.commands")
	local annotations = require("vantage.annotations")

	local captured = capture_backend_request(nil, function()
		vantage.setup({ backend = { mode = "fake" } })
		annotations.clear(0)
		lua_buffer({
			"local before = 1",
			"local target = before + 1",
			"local after = target + 1",
		})
		vim.api.nvim_win_set_cursor(0, { 2, 0 })

		vim.cmd("VantageAnnotate line")
		commands.clear_annotations()
	end)

	annotations.clear(0)
	eq(captured.method, "annotateRange")
	eq(captured.params.text, "local target = before + 1")
	eq(captured.params.scopeText, "local target = before + 1")
	eq(captured.params.visibleRange, {
		startLine = 1,
		startCharacter = 0,
		endLine = 1,
		endCharacter = 25,
	})
	eq(captured.params.maxAnnotations, 1)
	eq(captured.params.candidateLines, {
		{ line = 0, text = "local target = before + 1" },
	})
end)

test("VantageAnnotate visible uses the visible range and lets the model choose oversized scopes", function()
	local vantage = require("vantage")
	local commands = require("vantage.commands")
	local annotations = require("vantage.annotations")

	local captured = capture_backend_request(nil, function()
		vantage.setup({ backend = { mode = "fake" } })
		annotations.clear(0)
		lua_buffer({
			"local one = 1",
			"local two = one + 1",
			"local three = two + 1",
			"local four = three + 1",
			"local five = four + 1",
			"local six = five + 1",
			"local seven = six + 1",
		})
		vim.api.nvim_win_set_cursor(0, { 1, 0 })

		vim.cmd("VantageAnnotate visible")
		commands.clear_annotations()
	end)

	annotations.clear(0)
	eq(captured.params.maxAnnotations, 3)
	eq(captured.params.scopeText, table.concat({
		"local one = 1",
		"local two = one + 1",
		"local three = two + 1",
		"local four = three + 1",
		"local five = four + 1",
		"local six = five + 1",
		"local seven = six + 1",
	}, "\n"))
	eq(captured.params.visibleRange, {
		startLine = 0,
		startCharacter = 0,
		endLine = 6,
		endCharacter = 21,
	})
	eq(captured.params.candidateLines, nil)
end)

test("VantageAnnotate numeric argument keeps the current-line default scope", function()
	local vantage = require("vantage")
	local commands = require("vantage.commands")
	local annotations = require("vantage.annotations")

	local captured = capture_backend_request(nil, function()
		vantage.setup({ backend = { mode = "fake" } })
		annotations.clear(0)
		lua_buffer({
			"local one = 1",
			"local two = one + 1",
			"local three = two + 1",
			"local four = three + 1",
			"local five = four + 1",
			"local six = five + 1",
		})
		vim.api.nvim_win_set_cursor(0, { 2, 0 })

		vim.cmd("VantageAnnotate 5")
		commands.clear_annotations()
	end)

	annotations.clear(0)
	eq(captured.params.maxAnnotations, 5)
	eq(captured.params.scopeText, "local two = one + 1")
	eq(captured.params.candidateLines, {
		{ line = 0, text = "local two = one + 1" },
	})
end)

test("VantageAnnotate accepts an explicit line range", function()
	local vantage = require("vantage")
	local annotations = require("vantage.annotations")

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
		vantage.setup({ backend = { mode = "fake" } })
		annotations.clear(0)
		lua_buffer({
			"local a = 1",
			"local b = 2",
			"local c = b + 1",
			"return c",
		})

		vim.cmd("2,4VantageAnnotate")
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

test("VantageAnnotate range lets the model choose oversized selections", function()
	local vantage = require("vantage")
	local annotations = require("vantage.annotations")

	local captured = capture_backend_request(nil, function()
		vantage.setup({ backend = { mode = "fake" } })
		annotations.clear(0)
		lua_buffer({
			"local a = 1",
			"local b = a + 1",
			"local c = b + 1",
			"local d = c + 1",
		})

		vim.cmd("1,4VantageAnnotate")
	end)

	annotations.clear(0)
	eq(captured.method, "annotateRange")
	eq(captured.params.maxAnnotations, 3)
	eq(captured.params.scopeText, "local a = 1\nlocal b = a + 1\nlocal c = b + 1\nlocal d = c + 1")
	eq(captured.params.visibleRange, {
		startLine = 0,
		startCharacter = 0,
		endLine = 3,
		endCharacter = 15,
	})
	eq(captured.params.candidateLines, nil)
end)

test("annotate waiting status includes provider and elapsed time", function()
	local vantage = require("vantage")
	local commands = require("vantage.commands")
	local backend = require("vantage.backend")
	local original_request = backend.request

	local ok, err = pcall(function()
		backend.request = function()
			-- Keep the request in-flight so the waiting status can fire.
		end

		vantage.setup({
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
	vantage.setup({ annotations = { waiting_message_ms = 30000 } })
	assert(ok, err)
end)

test("pi annotation waiting status includes provider model and trace path", function()
	local vantage = require("vantage")
	local commands = require("vantage.commands")
	local backend = require("vantage.backend")
	local original_request = backend.request

	local ok, err = pcall(function()
		backend.request = function()
			-- Keep the request in-flight so the waiting status can fire.
		end

		vantage.setup({
			backend = { mode = "stdio" },
			provider = {
				name = "pi",
				pi = {
					trace_response_path = ".nvim-dev/trace/pi-response.txt",
				},
			},
			annotations = { waiting_message_ms = 10 },
		})
		lua_buffer({ "local value = 42" })

		capture_notifications(function(notifications)
			commands.annotate()
			local saw_waiting_status = vim.wait(200, function()
				for _, notification in ipairs(notifications) do
					if
						notification:match("still waiting for annotations from pi %(openai/gpt%-4o%-mini%)")
						and notification:match("response trace: %.nvim%-dev/trace/pi%-response%.txt")
					then
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
	vantage.setup({ annotations = { waiting_message_ms = 30000 } })
	assert(ok, err)
end)

test("pi annotation status uses configured provider and model", function()
	local vantage = require("vantage")
	local commands = require("vantage.commands")
	local backend = require("vantage.backend")
	local original_request = backend.request

	local ok, err = pcall(function()
		backend.request = function()
			-- Keep the request in-flight so only the start status matters.
		end

		vantage.setup({
			backend = { mode = "stdio" },
			provider = {
				name = "pi",
				pi = {
					provider = "anthropic",
					model = "claude-sonnet-4",
				},
			},
			annotations = { waiting_message_ms = 30000 },
		})
		lua_buffer({ "local value = 42" })

		local notifications = capture_notifications(function()
			commands.annotate()
			commands.clear_annotations()
		end)

		assert(
			notifications[1] == "Vantage: requesting annotations from pi (anthropic/claude-sonnet-4)",
			vim.inspect(notifications)
		)
	end)

	backend.request = original_request
	vantage.setup({ annotations = { waiting_message_ms = 30000 } })
	assert(ok, err)
end)

test("annotations skip out-of-range lines", function()
	local vantage = require("vantage")
	local annotations = require("vantage.annotations")
	vantage.setup({ backend = { mode = "fake" } })

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
	local vantage = require("vantage")
	local commands = require("vantage.commands")
	local annotations = require("vantage.annotations")
	local backend = require("vantage.backend")

	local ok, err = pcall(function()
		backend.stop()
		annotations.clear(0)
		vantage.setup({
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
	local vantage = require("vantage")
	local backend = require("vantage.backend")
	local responses = {}
	backend.stop()
	vim.wait(100, function()
		return false
	end)

	vantage.setup({
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
	local vantage = require("vantage")
	local commands = require("vantage.commands")
	local backend = require("vantage.backend")

	local ok, err = pcall(function()
		backend.stop()
		vim.wait(100, function()
			return false
		end)

		vantage.setup({
			backend = {
				mode = "stdio",
				command = { "node", "server/out/neovim/stdio-server.js" },
			},
		})
		vantage.set_lens("learning", "I am learning Lua syntax")

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
	local vantage = require("vantage")
	local commands = require("vantage.commands")
	local annotations = require("vantage.annotations")
	local backend = require("vantage.backend")

	local ok, err = pcall(function()
		backend.stop()
		annotations.clear(0)
		vantage.setup({
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
	local vantage = require("vantage")
	local commands = require("vantage.commands")
	local backend = require("vantage.backend")

	local ok, err = pcall(function()
		backend.stop()
		vantage.setup({
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

	print("vantage.nvim tests passed: " .. tostring(#tests))
end

return M
