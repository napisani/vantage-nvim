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

local function normalized_path(path)
	return ((vim.loop.fs_realpath(path) or vim.fn.fnamemodify(path, ":p")):gsub("/+$", ""))
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

local function with_ui_input(input_fn, run)
	local original_input = vim.ui.input
	local ok, err = pcall(function()
		vim.ui.input = input_fn
		run()
	end)

	vim.ui.input = original_input
	assert(ok, err)
end

local function with_fn_input(input_fn, run)
	local original_input = vim.fn.input
	local ok, err = pcall(function()
		vim.fn.input = input_fn
		run()
	end)

	vim.fn.input = original_input
	assert(ok, err)
end

test("default stdio backend command resolves from plugin root", function()
	local state = require("vantage.state")

	eq(state.config.backend.mode, "stdio")
	eq(state.config.backend.command, {
		"node",
		vim.fn.getcwd() .. "/server/out/neovim/stdio-server.js",
	})
	eq(state.config.agent.options.timeoutMs, 300000)
	eq(state.config.commands.annotate.options.timeoutMs, 300000)
end)

test("stdio backend sends agent and command config from setup", function()
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
      result: {
        kind: 'explanation',
        markdown: JSON.stringify({
          config: request.config,
            shape: {
              explainOptionsAreArray: Array.isArray(request.config.commands.explain.options),
              questionOptionsAreArray: Array.isArray(request.config.commands.question.options),
              editOptionsAreArray: Array.isArray(request.config.commands.edit.options),
              reviewOptionsAreArray: Array.isArray(request.config.commands.review.options)
            }
        })
      }
    }));
  }
});
]=],
			},
		},
		agent = {
			provider = "anthropic",
			model = "claude-test",
			auth = {
				path = "~/.config/pi-ai/auth.json",
			},
			options = {
				timeoutMs = 120000,
				reasoning = "medium",
			},
		},
		commands = {
			annotate = {
				waiting_message_ms = 10,
				options = {
					timeoutMs = 45000,
				},
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
	local payload = vim.json.decode(responses[1].result.markdown)
	eq(payload.shape, {
		explainOptionsAreArray = false,
		questionOptionsAreArray = false,
		editOptionsAreArray = false,
		reviewOptionsAreArray = false,
	})
	eq(payload.config, {
		agent = {
			runtime = "pi",
			provider = "anthropic",
			model = "claude-test",
			auth = {
				path = "~/.config/pi-ai/auth.json",
			},
			options = {
				maxTokens = 1024,
				timeoutMs = 120000,
				temperature = 0.1,
				reasoning = "medium",
			},
			session = {
				enabled = true,
				max_turns = 12,
				cacheRetention = "short",
			},
		},
		commands = {
			explain = {
				options = {},
			},
			question = {
				options = {},
			},
			edit = {
				options = {},
			},
			annotate = {
				waiting_message_ms = 10,
				options = {
					maxTokens = 256,
					timeoutMs = 45000,
				},
			},
			review = {
				options = {},
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
	vantage.setup({ backend = { mode = "development" } })
	vantage.set_lens("learning", "I am learning Lua syntax")
	eq(vantage.get_lens(), { mode = "learning", text = "I am learning Lua syntax" })
	vantage.clear_lens()
	eq(vantage.get_lens(), nil)
end)

test("context captures visible buffer text", function()
	local vantage = require("vantage")
	local context = require("vantage.context")
	vantage.setup({ backend = { mode = "development" } })

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
		backend = { mode = "development" },
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
	assert(type(snapshot.context.revision) == "string", vim.inspect(snapshot.context))
	assert(type(snapshot.context.ageMs) == "number", vim.inspect(snapshot.context))
	assert(type(snapshot.context.modifiedAt) == "string", vim.inspect(snapshot.context))
end)

test("agent context status reports missing context without failing commands", function()
	local vantage = require("vantage")
	local agent_context = require("vantage.agent_context")
	local root = temp_workspace()

	vantage.setup({ backend = { mode = "development" } })
	fresh_buffer()
	vim.fn.mkdir(root .. "/lua", "p")
	set_buffer_path(root .. "/lua/example.lua")

	local snapshot = agent_context.snapshot()

	eq(snapshot.status, "missing")
	eq(snapshot.exists, false)
	eq(snapshot.context, nil)
end)

test("VantageExplain attaches agent context when available", function()
	local vantage = require("vantage")
	local root = temp_workspace()

	vantage.setup({ backend = { mode = "development" } })
	lua_buffer({ "local value = 42" })
	vim.fn.mkdir(root .. "/lua", "p")
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
	assert(captured.params.agentContext.revision, vim.inspect(captured.params.agentContext))
	eq(captured.params.agentContext.truncated, false)
	eq(captured.params.workspaceRoot, normalized_path(root))
end)

test("agent session reset and status call backend with workspace scope", function()
	local vantage = require("vantage")
	local root = temp_workspace()

	vantage.setup({ backend = { mode = "development" } })
	fresh_buffer()
	vim.fn.mkdir(root .. "/lua", "p")
	writefile(root .. "/lua/example.lua", "local value = 42")
	set_buffer_path(root .. "/lua/example.lua")

	local captured = capture_backend_request({
		ok = true,
		result = { kind = "explanation", markdown = "session reset" },
	}, function()
		vim.cmd("VantageAgentReset")
	end)

	eq(captured.method, "agentSessionReset")
	eq(captured.params.workspaceRoot, normalized_path(root))
	close_floating_windows()

	captured = capture_backend_request({
		ok = true,
		result = { kind = "explanation", markdown = "session status" },
	}, function()
		vim.cmd("VantageAgentStatus")
	end)

	eq(captured.method, "agentSessionStatus")
	eq(captured.params.workspaceRoot, normalized_path(root))
end)

test("VantageContextStatus shows context availability on demand", function()
	local vantage = require("vantage")
	local commands = require("vantage.commands")
	local root = temp_workspace()

	vantage.setup({ backend = { mode = "development" } })
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
	vantage.setup({ backend = { mode = "development" } })

	fresh_buffer()
	vim.api.nvim_buf_set_name(0, "nvim/tests/relative-context.lua")

	local captured = context.visible()
	eq(captured.filePath, vim.fn.getcwd() .. "/nvim/tests/relative-context.lua")
end)

test("explain opens a markdown float for the current line", function()
	local vantage = require("vantage")
	local commands = require("vantage.commands")
	vantage.setup({ backend = { mode = "development" } })
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
		vantage.setup({ backend = { mode = "development" } })
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

test("VantageQuestion asks about the current line", function()
	local vantage = require("vantage")

	local captured = capture_backend_request({
		ok = true,
		result = {
			kind = "explanation",
			markdown = "Question answer",
		},
	}, function()
		vantage.setup({ backend = { mode = "development" } })
		lua_buffer({
			"local a = 1",
			"local b = a + 1",
		})
		vim.api.nvim_win_set_cursor(0, { 2, 0 })

		vim.cmd("VantageQuestion why does this reuse a?")
	end)

	eq(captured.method, "questionSelection")
	eq(captured.params.question, "why does this reuse a?")
	eq(captured.params.text, "local b = a + 1")
	eq(captured.params.selectedText, "local b = a + 1")
end)

test("VantageQuestion prompts for missing question text", function()
	local vantage = require("vantage")

	local captured = capture_backend_request({
		ok = true,
		result = {
			kind = "explanation",
			markdown = "Prompted question answer",
		},
	}, function()
		vantage.setup({ backend = { mode = "development" } })
		lua_buffer({
			"local a = 1",
			"local b = a + 1",
		})
		vim.api.nvim_win_set_cursor(0, { 2, 0 })

		with_ui_input(function(opts, callback)
			eq(opts.prompt, "Vantage question: ")
			callback("why does this reuse a?")
		end, function()
			vim.cmd("VantageQuestion")
		end)
	end)

	eq(captured.method, "questionSelection")
	eq(captured.params.question, "why does this reuse a?")
	eq(captured.params.text, "local b = a + 1")
	eq(captured.params.selectedText, "local b = a + 1")
end)

test("VantageQuestion prompt uses configured vim.ui.input options", function()
	local vantage = require("vantage")

	local captured = capture_backend_request({
		ok = true,
		result = {
			kind = "explanation",
			markdown = "Configured question answer",
		},
	}, function()
		vantage.setup({
			backend = { mode = "development" },
			ui = {
				input = {
					question = {
						prompt = "Ask Vantage: ",
						default = "what changed here?",
						scope = "buffer",
					},
				},
			},
		})
		lua_buffer({
			"local a = 1",
			"local b = a + 1",
		})
		vim.api.nvim_win_set_cursor(0, { 2, 0 })

		with_ui_input(function(opts, callback)
			eq(opts.prompt, "Ask Vantage: ")
			eq(opts.default, "what changed here?")
			eq(opts.scope, "buffer")
			callback("why does this reuse a?")
		end, function()
			vim.cmd("VantageQuestion")
		end)
	end)

	eq(captured.method, "questionSelection")
	eq(captured.params.question, "why does this reuse a?")
	eq(captured.params.text, "local b = a + 1")
end)

test("Vantage prompts can force the ui2 input provider", function()
	local vantage = require("vantage")
	local fn_input_prompts = {}

	local captured = capture_backend_request({
		ok = true,
		result = {
			kind = "explanation",
			markdown = "UI2 question answer",
		},
	}, function()
		vantage.setup({
			backend = { mode = "development" },
			ui = {
				input = {
					provider = "ui2",
					question = {
						prompt = "UI2 question: ",
					},
					lens = {
						prompt = "UI2 lens: ",
					},
				},
			},
		})
		lua_buffer({
			"local a = 1",
			"local b = a + 1",
		})
		vim.api.nvim_win_set_cursor(0, { 2, 0 })

		with_ui_input(function()
			error("expected Vantage to bypass vim.ui.input when ui2 provider is configured")
		end, function()
			with_fn_input(function(opts)
				table.insert(fn_input_prompts, opts.prompt)
				if opts.prompt == "UI2 question: " then
					return "why does this reuse a?"
				end
				if opts.prompt == "UI2 lens: " then
					return "Prefer concrete examples"
				end
				error("unexpected prompt: " .. tostring(opts.prompt))
			end, function()
				vim.cmd("VantageQuestion")
				vim.cmd("VantageSetLens learning")
			end)
		end)
	end)

	eq(fn_input_prompts, { "UI2 question: ", "UI2 lens: " })
	eq(captured.method, "questionSelection")
	eq(captured.params.question, "why does this reuse a?")
	eq(vantage.get_lens(), {
		mode = "learning",
		text = "Prefer concrete examples",
	})
end)

test("VantageQuestion accepts an explicit line range", function()
	local vantage = require("vantage")

	local captured = capture_backend_request({
		ok = true,
		result = {
			kind = "explanation",
			markdown = "Range question answer",
		},
	}, function()
		vantage.setup({ backend = { mode = "development" } })
		lua_buffer({
			"local a = 1",
			"local b = a + 1",
			"return b",
		})

		vim.cmd("1,2VantageQuestion what is the data flow?")
	end)

	eq(captured.method, "questionSelection")
	eq(captured.params.question, "what is the data flow?")
	eq(captured.params.text, "local a = 1\nlocal b = a + 1")
	eq(captured.params.range, {
		startLine = 0,
		startCharacter = 0,
		endLine = 1,
		endCharacter = 15,
	})
end)

test("VantageQuestion prompts for missing question text with an explicit line range", function()
	local vantage = require("vantage")

	local captured = capture_backend_request({
		ok = true,
		result = {
			kind = "explanation",
			markdown = "Prompted range question answer",
		},
	}, function()
		vantage.setup({ backend = { mode = "development" } })
		lua_buffer({
			"local a = 1",
			"local b = a + 1",
			"return b",
		})

		with_ui_input(function(opts, callback)
			eq(opts.prompt, "Vantage question: ")
			callback("what is the data flow?")
		end, function()
			vim.cmd("1,2VantageQuestion")
		end)
	end)

	eq(captured.method, "questionSelection")
	eq(captured.params.question, "what is the data flow?")
	eq(captured.params.text, "local a = 1\nlocal b = a + 1")
	eq(captured.params.range, {
		startLine = 0,
		startCharacter = 0,
		endLine = 1,
		endCharacter = 15,
	})
end)

test("VantageSetLens prompts for missing lens text", function()
	local vantage = require("vantage")

	vantage.setup({ backend = { mode = "development" } })

	with_ui_input(function(opts, callback)
		eq(opts.prompt, "Vantage lens: ")
		callback("I am learning Lua syntax")
	end, function()
		vim.cmd("VantageSetLens learning")
	end)

	eq(vantage.get_lens(), {
		mode = "learning",
		text = "I am learning Lua syntax",
	})
end)

test("VantageSetLens prompt uses configured vim.ui.input options", function()
	local vantage = require("vantage")

	vantage.setup({
		backend = { mode = "development" },
		ui = {
			input = {
				lens = {
					prompt = "Lens: ",
					default = "Review naming clarity",
					scope = "global",
				},
			},
		},
	})

	with_ui_input(function(opts, callback)
		eq(opts.prompt, "Lens: ")
		eq(opts.default, "Review naming clarity")
		eq(opts.scope, "global")
		callback("Check data flow")
	end, function()
		vim.cmd("VantageSetLens review")
	end)

	eq(vantage.get_lens(), {
		mode = "review",
		text = "Check data flow",
	})
end)

test("VantageEdit replaces the current line with the backend edit result", function()
	local vantage = require("vantage")

	local captured = capture_backend_request({
		ok = true,
		result = {
			kind = "edit",
			replacementText = "local count = 1",
		},
	}, function()
		vantage.setup({ backend = { mode = "development" } })
		lua_buffer({
			"local value = 1",
			"return value",
		})
		vim.api.nvim_win_set_cursor(0, { 1, 0 })

		vim.cmd("VantageEdit rename value to count")
	end)

	eq(captured.method, "editSelection")
	eq(captured.params.instruction, "rename value to count")
	eq(vim.api.nvim_buf_get_lines(0, 0, -1, false), {
		"local count = 1",
		"return value",
	})
end)

test("VantageEdit prompts for missing instruction with the ui2 input provider", function()
	local vantage = require("vantage")
	local fn_input_prompts = {}

	local captured = capture_backend_request({
		ok = true,
		result = {
			kind = "edit",
			replacementText = "local count = 1",
		},
	}, function()
		vantage.setup({
			backend = { mode = "development" },
			ui = {
				input = {
					provider = "ui2",
					edit = {
						prompt = "UI2 edit: ",
					},
				},
			},
		})
		lua_buffer({
			"local value = 1",
			"return value",
		})
		vim.api.nvim_win_set_cursor(0, { 1, 0 })

		with_ui_input(function()
			error("expected VantageEdit to bypass vim.ui.input when ui2 provider is configured")
		end, function()
			with_fn_input(function(opts)
				table.insert(fn_input_prompts, opts.prompt)
				return "rename value to count"
			end, function()
				vim.cmd("VantageEdit")
			end)
		end)
	end)

	eq(fn_input_prompts, { "UI2 edit: " })
	eq(captured.method, "editSelection")
	eq(captured.params.instruction, "rename value to count")
	eq(vim.api.nvim_buf_get_lines(0, 0, -1, false), {
		"local count = 1",
		"return value",
	})
end)

test("VantageEdit replaces an explicit line range with the backend edit result", function()
	local vantage = require("vantage")

	local captured = capture_backend_request({
		ok = true,
		result = {
			kind = "edit",
			replacementText = "local total = 3",
		},
	}, function()
		vantage.setup({ backend = { mode = "development" } })
		lua_buffer({
			"local a = 1",
			"local b = 2",
			"return a + b",
		})

		vim.cmd("1,2VantageEdit combine the locals")
	end)

	eq(captured.method, "editSelection")
	eq(captured.params.instruction, "combine the locals")
	eq(captured.params.range, {
		startLine = 0,
		startCharacter = 0,
		endLine = 1,
		endCharacter = 11,
	})
	eq(vim.api.nvim_buf_get_lines(0, 0, -1, false), {
		"local total = 3",
		"return a + b",
	})
end)

test("registers unified explain command without selection or line variants", function()
	local vantage = require("vantage")

	vantage.setup({ backend = { mode = "development" } })

	assert(vim.fn.exists(":VantageExplain") == 2, "expected VantageExplain command")
	assert(vim.fn.exists(":VantageQuestion") == 2, "expected VantageQuestion command")
	assert(vim.fn.exists(":VantageEdit") == 2, "expected VantageEdit command")
	assert(vim.fn.exists(":VantageExplainSelection") == 0, "expected old selection command to be removed")
	assert(vim.fn.exists(":VantageExplainLine") == 0, "expected old line command to be removed")
end)

test("annotate renders and clear_annotations clears extmarks", function()
	local vantage = require("vantage")
	local commands = require("vantage.commands")
	local annotations = require("vantage.annotations")
	vantage.setup({ backend = { mode = "development" } })

	lua_buffer({
		"local a = 1",
		"local b = a + 1",
	})

	commands.annotate()
	local marks = annotations.current_marks(0)
	assert(#marks > 0, "expected annotation marks")
	local virt_lines = marks[1][4].virt_lines
	assert(virt_lines and virt_lines[1] and virt_lines[1][1][1]:match("Development annotation"), vim.inspect(marks))
	eq(marks[1][4].virt_lines_above, true)
	eq(marks[1][4].virt_text, nil)
	commands.clear_annotations()
	assert(#annotations.current_marks(0) == 0, "expected annotations to clear")
end)

test("annotations render as wrapped above-line virtual blocks", function()
	local vantage = require("vantage")
	local annotations = require("vantage.annotations")
	vantage.setup({ backend = { mode = "development" } })

	lua_buffer({
		"local value = compute_value(input)",
	})
	vim.o.columns = 48

	annotations.render(0, {
		{
			text = "The `compute_value` call is where the incoming `input` crosses into domain-specific transformation logic, so this line is the best anchor for understanding the data flow under the lens.",
			severity = "info",
			range = { startLine = 0, startCharacter = 0, endLine = 0, endCharacter = 32 },
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
	vantage.setup({ backend = { mode = "development" } })

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
		table.insert(texts, mark[4].virt_lines[1][1][1])
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
		vantage.setup({ backend = { mode = "development" } })
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

	vantage.setup({ backend = { mode = "development" } })
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

test("annotation status includes request details and backend progress", function()
	local vantage = require("vantage")
	local commands = require("vantage.commands")
	local annotations = require("vantage.annotations")
	local backend = require("vantage.backend")
	local original_request = backend.request

	local ok, err = pcall(function()
		backend.request = function(_method, _params, _callback, options)
			if options and options.on_progress then
				options.on_progress({
					stage = "credentials_check",
					message = "Checking Pi OAuth credentials.",
					details = {
						provider = "openai-codex",
						auth_path = "~/.config/pi/auth.json",
					},
				})
			end
			return "progress-annotations"
		end

		vantage.setup({
			backend = { mode = "stdio" },
			agent = {
				provider = "openai-codex",
				model = "gpt-5.3-codex",
			},
			commands = {
				annotate = {
					options = {
						timeoutMs = 300000,
					},
				},
			},
		})
		annotations.clear(0)
		lua_buffer({ "local value = 42" })

		commands.annotate()

		local status = commands.annotation_status()
		eq(status.status, "loading")
		eq(status.agent, "openai-codex/gpt-5.3-codex")
		eq(status.backend_id, "progress-annotations")
		eq(status.timeout_ms, 300000)
		eq(status.selected_line_count, 1)
		eq(status.max_annotations, 1)
		eq(status.progress_stage, "credentials_check")
		assert(status.progress_message:match("OAuth"), vim.inspect(status))
		assert(#status.progress_history == 1, vim.inspect(status.progress_history))

		commands.clear_annotations()
	end)

	backend.request = original_request
	assert(ok, err)
end)

test("registers explicit annotation commands without toggle command", function()
	local vantage = require("vantage")

	vantage.setup({ backend = { mode = "development" } })

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

		vantage.setup({ backend = { mode = "development" } })
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
			commands = {
				annotate = {
					options = {
						timeoutMs = 20,
					},
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
		vantage.setup({ backend = { mode = "development" } })
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
		vantage.setup({ backend = { mode = "development" } })
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
		vantage.setup({ backend = { mode = "development" } })
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
	eq(captured.params.maxAnnotations, 2)
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

test("VantageAnnotate buffer uses full-buffer scope with percentage budget", function()
	local vantage = require("vantage")
	local commands = require("vantage.commands")
	local annotations = require("vantage.annotations")

	local captured = capture_backend_request(nil, function()
		vantage.setup({ backend = { mode = "development" } })
		annotations.clear(0)
		lua_buffer({
			"-- setup",
			"",
			"local one = 1",
			"local two = one + 1",
			"local three = two + 1",
			"local four = three + 1",
			"local five = four + 1",
			"local six = five + 1",
			"local seven = six + 1",
			"local eight = seven + 1",
			"local nine = eight + 1",
			"local ten = nine + 1",
		})
		vim.api.nvim_win_set_cursor(0, { 5, 0 })

		vim.cmd("VantageAnnotate buffer")
		commands.clear_annotations()
	end)

	annotations.clear(0)
	eq(captured.method, "annotateRange")
	eq(captured.params.maxAnnotations, 3)
	eq(captured.params.scopeText, table.concat({
		"-- setup",
		"",
		"local one = 1",
		"local two = one + 1",
		"local three = two + 1",
		"local four = three + 1",
		"local five = four + 1",
		"local six = five + 1",
		"local seven = six + 1",
		"local eight = seven + 1",
		"local nine = eight + 1",
		"local ten = nine + 1",
	}, "\n"))
	eq(captured.params.visibleRange, {
		startLine = 0,
		startCharacter = 0,
		endLine = 11,
		endCharacter = 20,
	})
	eq(captured.params.candidateLines, nil)
end)

test("VantageAnnotate numeric argument keeps the current-line default scope", function()
	local vantage = require("vantage")
	local commands = require("vantage.commands")
	local annotations = require("vantage.annotations")

	local captured = capture_backend_request(nil, function()
		vantage.setup({ backend = { mode = "development" } })
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
		vantage.setup({ backend = { mode = "development" } })
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
	eq(captured.params.maxAnnotations, 1)
	eq(captured.params.candidateLines, nil)
end)

test("VantageAnnotate range lets the model choose oversized selections", function()
	local vantage = require("vantage")
	local annotations = require("vantage.annotations")

	local captured = capture_backend_request(nil, function()
		vantage.setup({ backend = { mode = "development" } })
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
	eq(captured.params.maxAnnotations, 1)
	eq(captured.params.scopeText, "local a = 1\nlocal b = a + 1\nlocal c = b + 1\nlocal d = c + 1")
	eq(captured.params.visibleRange, {
		startLine = 0,
		startCharacter = 0,
		endLine = 3,
		endCharacter = 15,
	})
	eq(captured.params.candidateLines, nil)
end)

test("annotate waiting status includes agent and elapsed time", function()
	local vantage = require("vantage")
	local commands = require("vantage.commands")
	local backend = require("vantage.backend")
	local original_request = backend.request

	local ok, err = pcall(function()
		backend.request = function()
			-- Keep the request in-flight so the waiting status can fire.
		end

		vantage.setup({
			backend = { mode = "development" },
			commands = {
				annotate = {
					waiting_message_ms = 10,
				},
			},
		})
		lua_buffer({ "local value = 42" })

		capture_notifications(function(notifications)
			commands.annotate()
			local saw_waiting_status = vim.wait(200, function()
				for _, notification in ipairs(notifications) do
					if notification:match("still waiting for annotations from development") and notification:match("after 0%.") then
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
	vantage.setup({ commands = { annotate = { waiting_message_ms = 30000 } } })
	assert(ok, err)
end)

test("pi annotation waiting status includes model target and trace path", function()
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
			agent = {
				trace = {
					response_path = ".nvim-dev/trace/pi-response.txt",
				},
			},
			commands = {
				annotate = {
					waiting_message_ms = 10,
				},
			},
		})
		lua_buffer({ "local value = 42" })

		capture_notifications(function(notifications)
			commands.annotate()
			local saw_waiting_status = vim.wait(200, function()
				for _, notification in ipairs(notifications) do
					if
						notification:match("still waiting for annotations from openai/gpt%-4o%-mini")
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
	vantage.setup({ commands = { annotate = { waiting_message_ms = 30000 } } })
	assert(ok, err)
end)

test("annotation status uses configured model target", function()
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
			agent = {
				provider = "anthropic",
				model = "claude-sonnet-4",
			},
			commands = {
				annotate = {
					waiting_message_ms = 30000,
				},
			},
		})
		lua_buffer({ "local value = 42" })

		local notifications = capture_notifications(function()
			commands.annotate()
			commands.clear_annotations()
		end)

		assert(
			notifications[1] == "Vantage: requesting annotations from anthropic/claude-sonnet-4",
			vim.inspect(notifications)
		)
	end)

	backend.request = original_request
	vantage.setup({ commands = { annotate = { waiting_message_ms = 30000 } } })
	assert(ok, err)
end)

test("annotations skip out-of-range lines", function()
	local vantage = require("vantage")
	local annotations = require("vantage.annotations")
	vantage.setup({ backend = { mode = "development" } })

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
			agent = {
				runtime = "development",
			},
		})
		vantage.set_lens("learning", "I am learning Lua syntax")

		fresh_buffer()
		vim.bo.filetype = "lua"
		vim.api.nvim_buf_set_lines(0, 0, -1, false, { "local value = 42" })

		commands.explain()
		vim.wait(2000, function()
			local text = last_float_text()
			return text and text:match("Development agent runtime") ~= nil
		end)

		local text = last_float_text()
		assert(text ~= nil, "expected stdio float buffer")
		assert(text:match("Development agent runtime"), text)
	end)

	backend.stop()
	assert(ok, err)
end)

test("stdio backend renders non-empty annotation block", function()
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
			agent = {
				runtime = "development",
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
			if #marks == 0 or not marks[1][4] or not marks[1][4].virt_lines then
				return false
			end
			local text = marks[1][4].virt_lines[1] and marks[1][4].virt_lines[1][1][1]
			return text and text:match("Development annotation") ~= nil
		end)

		local marks = annotations.current_marks(0)
		assert(#marks > 0, "expected stdio annotation marks")
		local virt_lines = marks[1][4].virt_lines
		assert(virt_lines and virt_lines[1] and virt_lines[1][1][1]:match("Development annotation"), vim.inspect(marks))
		eq(marks[1][4].virt_lines_above, true)
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
