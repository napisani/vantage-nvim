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

local function fake_response(method, params)
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
				"Fake provider response for **" .. language .. "**.",
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

	if method == "annotateRange" then
		local start_line = 0
		if params.visibleRange and params.visibleRange.startLine then
			start_line = params.visibleRange.startLine
		end

		return {
			kind = "annotations",
			annotations = {
				{
					text = "Fake annotation.",
					detailMarkdown = "## Annotation\n\nFake annotation detail.",
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

	if method == "reviewCurrentHunk" then
		return {
			kind = "review",
			markdown = "## Review\n\nFake review response.",
			findings = {
				{
					message = "Fake finding.",
					severity = "info",
				},
			},
		}
	end

	return {
		kind = "error",
		markdown = "## Error\n\nUnknown fake backend method: " .. tostring(method),
	}
end

local function invoke_callback(callback, response)
	if callback then
		callback(response)
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
	for id, callback in pairs(callbacks) do
		vim.schedule(function()
			invoke_callback(callback, backend_error(id, code, message))
		end)
	end
end

local function handle_stdout_line(line)
	if line == "" then
		return
	end

	local ok, decoded = pcall(vim.json.decode, line)
	if not ok or type(decoded) ~= "table" then
		return
	end

	local callback = pending[decoded.id]
	if callback then
		pending[decoded.id] = nil
		vim.schedule(function()
			invoke_callback(callback, decoded)
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

function M.request(method, params, callback)
	if state.config.backend.mode == "fake" then
		invoke_callback(callback, {
			id = "fake",
			ok = true,
			result = fake_response(method, params),
		})
		return "fake"
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
	pending[id] = callback

	local message = vim.json.encode({
		id = id,
		method = method,
		config = {
			provider = state.config.provider or {},
		},
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
	if not id or id == "fake" then
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
