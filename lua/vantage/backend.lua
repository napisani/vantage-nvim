local state = require("vantage.state")

local M = {}

local job_id = nil
local job_generation = 0
local next_id = 1
local pending = {}
local stdout_buffer = ""

local function title_case(value)
	local text = value or "text"
	return text:gsub("^%l", string.upper)
end

local function development_response(method, params)
	params = params or {}

	if method == "explainSelection" then
		local language = title_case(params.language)
		local lens = params.lens and params.lens.text or "No learning lens set."
		local selected_code = params.selectedText or params.text or ""
		local context_summary = params.contextSummary or "Visible editor context."
		if params.agentContext then
			local truncated = params.agentContext.truncated and ", truncated" or ""
			context_summary = "Agent context: "
				.. tostring(params.agentContext.path or "unknown")
				.. " ("
				.. tostring(#(params.agentContext.content or ""))
				.. " chars"
				.. truncated
				.. ")"
		end

		return {
			kind = "explanation",
			markdown = table.concat({
				"## Explanation",
				"",
				"Development agent runtime response for **" .. language .. "**.",
				"",
				"Lens: " .. lens,
				"",
				"```" .. (params.language or ""),
				selected_code,
				"```",
				"",
				"Context: " .. context_summary,
			}, "\n"),
		}
	end

	if method == "questionSelection" then
		return {
			kind = "explanation",
			markdown = table.concat({
				"## Answer",
				"",
				"Development agent runtime response for **" .. title_case(params.language) .. "**.",
				"",
				"Question: " .. tostring(params.question or ""),
				"",
				"```" .. (params.language or ""),
				params.selectedText or params.text or "",
				"```",
			}, "\n"),
		}
	end

	if method == "editSelection" then
		return {
			kind = "edit",
			replacementText = params.selectedText or params.text or "",
		}
	end

	if method == "annotateRange" then
		local start_line = 0
		if params.visibleRange and params.visibleRange.startLine then
			start_line = params.visibleRange.startLine
		end

		return {
			kind = "annotations",
			annotations = {
				{
					text = "Development annotation.",
					detailMarkdown = "## Annotation\n\nDevelopment annotation detail.",
					severity = "info",
					range = {
						startLine = start_line,
						startCharacter = 0,
						endLine = start_line,
						endCharacter = 0,
					},
				},
			},
		}
	end

	if method == "searchLocations" then
		return {
			kind = "locations",
			locations = {
				{
					filePath = params.filePath or "",
					startLine = params.range and params.range.startLine or params.cursor and params.cursor.line or 1,
					startCharacter = params.range and params.range.startCharacter or params.cursor and params.cursor.character or 1,
					explanation = "Development search result for: " .. tostring(params.query or ""),
				},
			},
		}
	end

	if method == "agentCancel" then
		return {
			kind = "explanation",
			markdown = "## Vantage Agent\n\nDevelopment agent runtime cancel.",
		}
	end

	if method == "agentSessionReset" then
		return {
			kind = "explanation",
			markdown = "## Vantage Agent Session\n\nDevelopment agent runtime session reset.",
		}
	end

	if method == "agentSessionStatus" then
		return {
			kind = "explanation",
			markdown = "## Vantage Agent Session\n\nDevelopment agent runtime session status.\n\nTurn count: 0",
		}
	end

	if method == "agentSessionOutput" then
		return {
			kind = "explanation",
			markdown = "## Vantage Session Output\n\n### development · completed\n\nDevelopment backend session output.",
		}
	end

	if method == "listSkills" then
		return {
			kind = "skills",
			skills = {
				{
					name = "development-skill",
					description = "Development backend placeholder skill.",
					filePath = "/development/SKILL.md",
					source = "development",
				},
			},
		}
	end

	return {
		kind = "error",
		markdown = "## Error\n\nUnknown development backend method: " .. tostring(method),
	}
end

local function invoke_callback(callback, response)
	if callback then
		callback(response)
	end
end

local function invoke_progress(callback, progress)
	if callback then
		callback(progress)
	end
end

local function backend_error(id, code, message)
	return {
		id = id,
		ok = false,
		error = {
			code = code,
			message = message,
		},
	}
end

local function fail_pending(code, message)
	local callbacks = pending
	pending = {}
	for id, request in pairs(callbacks) do
		vim.schedule(function()
			invoke_callback(request.callback, backend_error(id, code, message))
		end)
	end
end

local function json_object(value)
	if type(value) ~= "table" or vim.tbl_isempty(value) then
		return vim.empty_dict()
	end
	return vim.deepcopy(value)
end

local function agent_options_config(value)
	local options = json_object(value)
	if type(options.metadata) == "table" and vim.tbl_isempty(options.metadata) then
		options.metadata = vim.empty_dict()
	end
	if type(options.headers) == "table" and vim.tbl_isempty(options.headers) then
		options.headers = vim.empty_dict()
	end
	return options
end

local function command_config(value)
	value = value or {}
	return {
		include_lens = value.include_lens,
		options = agent_options_config(value.options),
	}
end

local function auth_config(value)
	if type(value) ~= "table" then
		return nil
	end

	local config = {}
	if value.path ~= nil then
		config.path = value.path
	end
	if vim.tbl_isempty(config) then
		return vim.empty_dict()
	end
	return config
end

local function session_config(value)
	value = value or {}
	return {
		enabled = value.enabled,
		max_turns = value.max_turns,
		cacheRetention = value.cacheRetention,
	}
end

local function session_output_config(value)
	value = value or {}
	return {
		history_limit = value.history_limit,
	}
end

local function annotate_command_config(value)
	local config = command_config(value)
	if type(value) == "table" then
		config.waiting_message_ms = value.waiting_message_ms
	end
	return config
end

local function request_config()
	local agent = vim.deepcopy(state.config.agent or {})
	agent.options = agent_options_config(agent.options)
	agent.auth = auth_config(agent.auth)
	agent.session = session_config(agent.session)
	agent.session_output = session_output_config(agent.session_output)
	if type(agent.trace) == "table" and vim.tbl_isempty(agent.trace) then
		agent.trace = vim.empty_dict()
	end

	local commands = state.config.commands or {}
	return {
		agent = agent,
		commands = {
			explain = command_config(commands.explain),
			question = command_config(commands.question),
			edit = command_config(commands.edit),
			annotate = annotate_command_config(commands.annotate),
			search = command_config(commands.search),
		},
	}
end

local function handle_stdout_line(line)
	if line == "" then
		return
	end

	local ok, decoded = pcall(vim.json.decode, line)
	if not ok or type(decoded) ~= "table" then
		return
	end

	if decoded.type == "progress" then
		local request = pending[decoded.id]
		if request and request.on_progress then
			local progress = decoded.progress or {}
			vim.schedule(function()
				invoke_progress(request.on_progress, progress)
			end)
		end
		return
	end

	local request = pending[decoded.id]
	if request then
		pending[decoded.id] = nil
		vim.schedule(function()
			invoke_callback(request.callback, decoded)
		end)
	end
end

local function handle_stdout(job, data, generation)
	if job_id ~= job or job_generation ~= generation then
		return
	end

	if not data then
		return
	end

	local function flush_line()
		if stdout_buffer ~= "" then
			handle_stdout_line(stdout_buffer)
			stdout_buffer = ""
		end
	end

	local function append_chunk(chunk)
		stdout_buffer = stdout_buffer .. chunk
		while true do
			local newline = stdout_buffer:find("\n", 1, true)
			if not newline then
				break
			end
			local line = stdout_buffer:sub(1, newline - 1)
			stdout_buffer = stdout_buffer:sub(newline + 1)
			handle_stdout_line(line)
		end
	end

	for index, chunk in ipairs(data) do
		if index > 1 then
			flush_line()
		end
		append_chunk(chunk)
	end

	if data[#data] == "" then
		flush_line()
	end
end

local function start_stdio()
	if job_id then
		return nil
	end

	local command = state.config.backend.command
	if not command then
		return "backend.command is required for stdio mode"
	end

	job_generation = job_generation + 1
	local generation = job_generation
	local started = vim.fn.jobstart(command, {
		stdout_buffered = false,
		on_stdout = function(job, data)
			handle_stdout(job, data, generation)
		end,
		on_exit = function(job)
			if job_id ~= job or job_generation ~= generation then
				return
			end

			job_id = nil
			stdout_buffer = ""
			fail_pending("backend_exit", "Vantage backend exited before responding.")
		end,
	})

	if started <= 0 then
		return "failed to start backend command"
	end

	job_id = started
	return nil
end

function M.request(method, params, callback, options)
	if state.config.backend.mode == "development" then
		invoke_callback(callback, {
			id = "development",
			ok = true,
			result = development_response(method, params),
		})
		return "development"
	end

	local start_error = start_stdio()
	if start_error then
		invoke_callback(callback, {
			id = nil,
			ok = false,
			error = start_error,
		})
		return nil
	end

	local id = tostring(next_id)
	next_id = next_id + 1
	pending[id] = {
		callback = callback,
		on_progress = options and options.on_progress or nil,
	}

	local message = vim.json.encode({
		id = id,
		method = method,
		config = request_config(),
		params = params or {},
	}) .. "\n"

	local sent = vim.fn.chansend(job_id, message)
	if sent <= 0 then
		pending[id] = nil
		invoke_callback(callback, backend_error(id, "send_failed", "Failed to send request to Vantage backend."))
		return nil
	end

	return id
end

function M.cancel(id)
	if not id or id == "development" then
		return
	end

	pending[id] = nil
	if not job_id then
		return
	end

	local message = vim.json.encode({
		id = "cancel-" .. tostring(id),
		method = "cancelRequest",
		params = { id = tostring(id) },
	}) .. "\n"

	vim.fn.chansend(job_id, message)
end

function M.stop()
	if job_id then
		vim.fn.jobstop(job_id)
	end

	job_generation = job_generation + 1
	job_id = nil
	pending = {}
	stdout_buffer = ""
end

return M
