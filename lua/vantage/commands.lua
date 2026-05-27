local annotations = require("vantage.annotations")
local agent_context = require("vantage.agent_context")
local backend = require("vantage.backend")
local context = require("vantage.context")
local input_ui = require("vantage.input")
local model_command = require("vantage.model_command")
local state = require("vantage.state")
local status_view = require("vantage.status")
local ui = require("vantage.ui")

local M = {}
local LINE_ANNOTATION_LIMIT = 1
local SCOPE_ANNOTATION_PERCENT = 0.25
local SCOPE_ANNOTATION_MIN = 1
local SCOPE_ANNOTATION_MAX = 12
local BUFFER_ANNOTATION_PERCENT = 0.15
local BUFFER_ANNOTATION_MIN = 3
local BUFFER_ANNOTATION_MAX = 24
local annotation_request = {
	status = "idle",
	token = 0,
	started_at = 0,
	agent = nil,
	backend_id = nil,
	details = {},
	progress_history = {},
	progress_stage = nil,
	progress_message = nil,
	progress_details = nil,
}
local last_annotation_status = {
	status = "idle",
	message = "No annotation request has completed yet.",
}
local complete_annotation_request

local function set_annotation_status(status)
	last_annotation_status = vim.tbl_deep_extend("force", {}, status or {})
	last_annotation_status.updated_at = vim.loop.hrtime()
end

local function copy_table(value)
	if type(value) ~= "table" then
		return nil
	end
	return vim.deepcopy(value)
end

local function annotation_count(value)
	if type(value) == "table" then
		return #value
	end
	return 0
end

local function annotation_agent()
	local backend_config = state.config.backend or {}
	local mode = backend_config.mode or "stdio"
	if mode == "development" then
		return {
			name = "development",
			label = "development",
			trace = nil,
		}
	end

	local agent_config = state.config.agent or {}
	local provider = agent_config.provider or "openai"
	local model = agent_config.model or "gpt-4o-mini"
	local trace = agent_config.trace and agent_config.trace.response_path or nil
	local label = provider .. "/" .. model

	return {
		name = "pi",
		label = label,
		trace = trace,
	}
end

local function waiting_message_ms()
	local commands = state.config.commands or {}
	local config = commands.annotate or {}
	local value = config.waiting_message_ms
	if type(value) == "number" and value >= 0 then
		return value
	end
	return 30000
end

local function annotation_request_timeout_ms()
	local commands = state.config.commands or {}
	local annotate = commands.annotate or {}
	local options = annotate.options or {}
	local value = options.timeoutMs
	if type(value) == "number" and value > 0 then
		return value
	end
	return 300000
end

local function elapsed_seconds(started_at)
	if not started_at or started_at == 0 then
		return 0
	end
	return math.max(0, (vim.loop.hrtime() - started_at) / 1000000000)
end

local function format_elapsed(seconds)
	if seconds < 10 then
		return string.format("%.1fs", seconds)
	end
	return tostring(math.floor(seconds + 0.5)) .. "s"
end

local function trace_suffix(agent)
	if agent and agent.trace and agent.trace ~= "" then
		return "; response trace: " .. agent.trace
	end
	return ""
end

local function agent_label(agent)
	return agent and agent.label or "unknown"
end

local function annotation_progress_fields()
	local fields = {}
	if annotation_request.progress_stage then
		fields.progress_stage = annotation_request.progress_stage
	end
	if annotation_request.progress_message then
		fields.progress_message = annotation_request.progress_message
	end
	if annotation_request.progress_details then
		fields.progress_details = copy_table(annotation_request.progress_details)
	end
	if annotation_request.progress_history and #annotation_request.progress_history > 0 then
		fields.progress_history = copy_table(annotation_request.progress_history)
	end
	return fields
end

local function annotation_status_details()
	return vim.tbl_deep_extend(
		"force",
		{},
		annotation_request.details or {},
		annotation_progress_fields(),
		{
			backend_id = annotation_request.backend_id,
		}
	)
end

local function push_annotation_progress(token, progress)
	if annotation_request.status ~= "loading" or annotation_request.token ~= token then
		return
	end

	progress = progress or {}
	local event = {
		stage = progress.stage or "progress",
		message = progress.message,
		details = progress.details,
		elapsed = format_elapsed(elapsed_seconds(annotation_request.started_at)),
	}
	table.insert(annotation_request.progress_history, event)
	while #annotation_request.progress_history > 8 do
		table.remove(annotation_request.progress_history, 1)
	end

	annotation_request.progress_stage = event.stage
	annotation_request.progress_message = event.message
	annotation_request.progress_details = event.details
	set_annotation_status(vim.tbl_deep_extend("force", annotation_status_details(), {
		status = "loading",
		agent = agent_label(annotation_request.agent),
		elapsed = event.elapsed,
		message = event.message or ("Annotation request reached " .. event.stage .. "."),
		trace = annotation_request.agent and annotation_request.agent.trace or nil,
	}))
end

local function split_lines(text)
	if text == "" then
		return { "" }
	end

	local lines = {}
	for line in (text .. "\n"):gmatch("(.-)\n") do
		table.insert(lines, line)
	end
	return lines
end

local function line_count(text)
	return #split_lines(text or "")
end

local function trim_start(text)
	return (text or ""):gsub("^%s+", "")
end

local function is_annotation_candidate(line)
	local trimmed = trim_start(line)
	return trimmed ~= ""
		and not vim.startswith(trimmed, "--")
		and not vim.startswith(trimmed, "//")
		and not vim.startswith(trimmed, "#")
		and not vim.startswith(trimmed, "/*")
		and not vim.startswith(trimmed, "*")
end

local function annotation_candidate_lines(params)
	local lines = split_lines(params.text or "")
	local candidates = {}

	for index, line in ipairs(lines) do
		if line and is_annotation_candidate(line) then
			table.insert(candidates, { line = index - 1, text = line })
		end
	end

	return candidates
end

local function telemetry_suffix(result)
	local telemetry = result and result.telemetry
	if type(telemetry) ~= "table" then
		return ""
	end

	local details = {}
	if type(telemetry.totalDurationMs) == "number" then
		table.insert(details, "runtime " .. format_elapsed(telemetry.totalDurationMs / 1000))
	end
	if type(telemetry.promptEvalCount) == "number" then
		table.insert(details, "prompt tokens " .. tostring(telemetry.promptEvalCount))
	end
	if type(telemetry.evalCount) == "number" then
		table.insert(details, "output tokens " .. tostring(telemetry.evalCount))
	end
	if type(telemetry.promptChars) == "number" then
		table.insert(details, "prompt chars " .. tostring(telemetry.promptChars))
	end

	if #details == 0 then
		return ""
	end
	return " (" .. table.concat(details, ", ") .. ")"
end

local function error_markdown(response)
	local message = "Unknown backend error."
	if response and response.error then
		if type(response.error) == "table" and response.error.message then
			message = response.error.message
		else
			message = response.error
		end
	end
	return "## Error\n\n" .. tostring(message)
end

local function no_annotations_markdown()
	return table.concat({
		"## No annotations",
		"",
		"The agent runtime did not return visible annotations for this window.",
	}, "\n")
end

local function parse_positive_integer(text)
	local value = tonumber(text)
	if value and value > 0 and math.floor(value) == value then
		return value
	end
	return nil
end

local function trim(text)
	return (text or ""):gsub("^%s+", ""):gsub("%s+$", "")
end

local function range_context(opts)
	if opts and type(opts.range) == "number" and opts.range > 0 then
		return context.line_range(opts.line1 - 1, opts.line2 - 1)
	end

	return nil
end

local function parse_annotation_options(opts)
	local args = opts and opts.fargs or {}
	local parsed = {
		scope = nil,
		max_annotations = nil,
	}

	for _, arg in ipairs(args) do
		local max_annotations = parse_positive_integer(arg)
		if max_annotations then
			parsed.max_annotations = max_annotations
		elseif arg == "line" or arg == "visible" or arg == "buffer" then
			parsed.scope = arg
		else
			return nil, 'unsupported annotation option "' .. tostring(arg) .. '"'
		end
	end

	return parsed, nil
end

local function annotation_context(opts, annotation_options)
	if annotation_options.scope == "line" then
		return context.current_line(), "line"
	end

	if annotation_options.scope == "visible" then
		return context.visible(), "visible"
	end

	if annotation_options.scope == "buffer" then
		return context.buffer(), "buffer"
	end

	local selected_range = range_context(opts)
	if selected_range then
		return selected_range, "range"
	end

	return context.current_line(), "line"
end

local function percentage_budget(candidate_count, percent, minimum, maximum)
	local budget = math.ceil(math.max(0, candidate_count or 0) * percent)
	return math.max(minimum, math.min(maximum, budget))
end

local function annotation_limit(annotation_options, scope_kind, candidate_count)
	if annotation_options.max_annotations then
		return annotation_options.max_annotations
	end
	if scope_kind == "line" then
		return LINE_ANNOTATION_LIMIT
	end
	if scope_kind == "buffer" then
		return percentage_budget(candidate_count, BUFFER_ANNOTATION_PERCENT, BUFFER_ANNOTATION_MIN, BUFFER_ANNOTATION_MAX)
	end
	return percentage_budget(candidate_count, SCOPE_ANNOTATION_PERCENT, SCOPE_ANNOTATION_MIN, SCOPE_ANNOTATION_MAX)
end

local function cancel_annotation_request(message_prefix)
	if annotation_request.status ~= "loading" then
		return false
	end

	local agent = annotation_request.agent or annotation_agent()
	local elapsed = format_elapsed(elapsed_seconds(annotation_request.started_at))
	backend.cancel(annotation_request.backend_id)
	annotation_request.status = "idle"
	annotation_request.token = annotation_request.token + 1
	annotation_request.backend_id = nil
	set_annotation_status(vim.tbl_deep_extend("force", annotation_status_details(), {
		status = "cancelled",
		agent = agent_label(agent),
		elapsed = elapsed,
		message = "Annotation request cancelled after " .. elapsed .. ".",
		trace = agent and agent.trace or nil,
	}))
	if message_prefix then
		vim.notify(message_prefix .. " " .. agent.label .. " after " .. elapsed, vim.log.levels.INFO)
	end
	return true
end

local function begin_annotation_request(agent, details)
	annotation_request.status = "loading"
	annotation_request.token = annotation_request.token + 1
	annotation_request.started_at = vim.loop.hrtime()
	annotation_request.agent = agent
	annotation_request.backend_id = nil
	annotation_request.details = details or {}
	annotation_request.progress_history = {}
	annotation_request.progress_stage = nil
	annotation_request.progress_message = nil
	annotation_request.progress_details = nil
	local token = annotation_request.token

	set_annotation_status(vim.tbl_deep_extend("force", annotation_status_details(), {
		status = "loading",
		agent = agent_label(agent),
		message = "Annotation request is still waiting for " .. agent_label(agent) .. ".",
		trace = agent and agent.trace or nil,
	}))
	vim.notify("Vantage: requesting annotations from " .. agent.label, vim.log.levels.INFO)
	vim.defer_fn(function()
		if annotation_request.status == "loading" and annotation_request.token == token then
			local elapsed = format_elapsed(elapsed_seconds(annotation_request.started_at))
			set_annotation_status(vim.tbl_deep_extend("force", annotation_status_details(), {
				status = "loading",
				agent = agent_label(agent),
				elapsed = elapsed,
				message = "Annotation request is still waiting after " .. elapsed .. ".",
				trace = agent and agent.trace or nil,
			}))
			vim.notify(
				"Vantage: still waiting for annotations from " .. agent.label .. " after " .. elapsed .. trace_suffix(agent),
				vim.log.levels.WARN
			)
		end
	end, waiting_message_ms())

	return token
end

local function schedule_annotation_timeout(token, agent)
	vim.defer_fn(function()
		if annotation_request.status ~= "loading" or annotation_request.token ~= token then
			return
		end

		local backend_id = annotation_request.backend_id
		if backend_id then
			backend.cancel(backend_id)
		end

		local elapsed = complete_annotation_request(token)
		if not elapsed then
			return
		end

		local error_message = "Annotation request timed out after " .. elapsed .. " without a backend response."
		set_annotation_status(vim.tbl_deep_extend("force", annotation_status_details(), {
			status = "failed",
			agent = agent_label(agent),
			elapsed = elapsed,
			error = error_message,
			message = error_message,
			trace = agent and agent.trace or nil,
		}))
		vim.notify(
			"Vantage: annotation request from "
				.. agent.label
				.. " timed out after "
				.. elapsed
				.. trace_suffix(agent),
			vim.log.levels.ERROR
		)
		ui.show_markdown("## Error\n\n" .. error_message)
	end, annotation_request_timeout_ms())
end

function complete_annotation_request(token)
	if annotation_request.token ~= token or annotation_request.status ~= "loading" then
		return nil
	end

	local elapsed = format_elapsed(elapsed_seconds(annotation_request.started_at))
	annotation_request.status = "idle"
	annotation_request.backend_id = nil
	return elapsed
end

function M.annotation_status()
	local status = vim.deepcopy(last_annotation_status)
	if annotation_request.status == "loading" then
		local elapsed = format_elapsed(elapsed_seconds(annotation_request.started_at))
		status = vim.tbl_deep_extend("force", status, annotation_status_details(), {
			status = "loading",
			agent = agent_label(annotation_request.agent),
			elapsed = elapsed,
			message = annotation_request.progress_message or ("Annotation request is still waiting after " .. elapsed .. "."),
			trace = annotation_request.agent and annotation_request.agent.trace or status.trace,
		})
	end
	return status
end

function M.show_annotation_status()
	local status = M.annotation_status()
	ui.show_markdown(status_view.annotation(status))
	vim.notify("Vantage annotation status: " .. tostring(status.status or "unknown"), vim.log.levels.INFO)
end

function M.agent_context_status()
	return agent_context.snapshot()
end

function M.show_agent_context_status()
	local snapshot = M.agent_context_status()
	ui.show_markdown(status_view.agent_context(snapshot))
	vim.notify("Vantage agent context status: " .. tostring(snapshot.status or "unknown"), vim.log.levels.INFO)
end

function M.set_lens(mode, text)
	state.set_lens(mode, text)
end

local function prompt_lens(mode)
	local active_lens = state.get_lens()
	local default = active_lens and active_lens.mode == mode and active_lens.text or ""
	input_ui.prompt("lens", { default = default }, function(input)
		local text = trim(input)
		if text == "" then
			return
		end
		M.set_lens(mode, text)
	end)
end

function M.clear_lens()
	state.clear_lens()
end

function M.explain(opts)
	model_command.explain(opts)
end

function M.question(opts)
	model_command.question(opts)
end

function M.edit(opts)
	model_command.edit(opts)
end

function M.clear_annotations()
	local bufnr = vim.api.nvim_get_current_buf()
	cancel_annotation_request("Vantage: cancelled annotation request to")
	annotations.clear(bufnr)
	vim.notify("Vantage: cleared annotations", vim.log.levels.INFO)
end

function M.annotate(opts)
	cancel_annotation_request("Vantage: cancelled annotation request to")

	local bufnr = vim.api.nvim_get_current_buf()
	local annotation_options, parse_error = parse_annotation_options(opts)
	if not annotation_options then
		vim.notify("Vantage: " .. parse_error, vim.log.levels.ERROR)
		return
	end
	local params, scope_kind = annotation_context(opts, annotation_options)
	params.scopeText = params.text
	local candidate_lines = annotation_candidate_lines(params)
	params.maxAnnotations = annotation_limit(annotation_options, scope_kind, #candidate_lines)
	if #candidate_lines > 0 and #candidate_lines <= params.maxAnnotations then
		params.candidateLines = candidate_lines
	end
	local agent = annotation_agent()
	local request_details = {
		method = "annotateRange",
		scope = annotation_options.scope or scope_kind,
		scope_kind = scope_kind,
		selected_line_count = line_count(params.scopeText or params.text or ""),
		max_annotations = params.maxAnnotations,
		candidate_line_count = #candidate_lines,
		timeout_ms = annotation_request_timeout_ms(),
		waiting_message_ms = waiting_message_ms(),
		backend_mode = state.config.backend and state.config.backend.mode or "stdio",
		file_path = params.filePath,
		workspace_root = params.workspaceRoot,
	}
	local token = begin_annotation_request(agent, request_details)
	schedule_annotation_timeout(token, agent)

	local backend_id = backend.request("annotateRange", params, function(response)
		local elapsed = complete_annotation_request(token)
		if not elapsed then
			return
		end

		if not response or not response.ok then
			local error_message = error_markdown(response):gsub("^## Error\n\n", "")
			set_annotation_status(vim.tbl_deep_extend("force", annotation_status_details(), {
				status = "failed",
				agent = agent_label(agent),
				elapsed = elapsed,
				error = error_message,
				message = "Annotation request failed after " .. elapsed .. ".",
				trace = agent and agent.trace or nil,
			}))
			vim.notify(
				"Vantage: annotation request from " .. agent.label .. " failed after " .. elapsed .. trace_suffix(agent),
				vim.log.levels.ERROR
			)
			ui.show_markdown(error_markdown(response))
			return
		end

		local returned_annotations = response.result.annotations or {}
		local received_count = annotation_count(returned_annotations)
		local count = annotations.render(bufnr, returned_annotations)
		if count == 0 then
			local skipped = math.max(0, received_count - count)
			local message
			if received_count == 0 then
				message = "Agent runtime returned no annotations."
			else
				message = "Agent runtime returned "
					.. tostring(received_count)
					.. " annotation(s), but they were not visible in this buffer."
			end
			set_annotation_status(vim.tbl_deep_extend("force", annotation_status_details(), {
				status = "no_visible_annotations",
				agent = agent_label(agent),
				elapsed = elapsed,
				received = received_count,
				rendered = count,
				skipped = skipped,
				message = message,
				trace = agent and agent.trace or nil,
			}))
			vim.notify(
				"Vantage: "
					.. agent.label
					.. " rendered 0 of "
					.. tostring(received_count)
					.. " returned annotations after "
					.. elapsed,
				vim.log.levels.WARN
			)
			ui.show_markdown(no_annotations_markdown())
			return
		end

		local suffix = count == 1 and "" or "s"
		set_annotation_status(vim.tbl_deep_extend("force", annotation_status_details(), {
			status = "rendered",
			agent = agent_label(agent),
			elapsed = elapsed,
			received = received_count,
			rendered = count,
			skipped = math.max(0, received_count - count),
			message = "Rendered " .. tostring(count) .. " annotation" .. suffix .. ".",
			trace = agent and agent.trace or nil,
		}))
		vim.notify(
			"Vantage: rendered "
				.. tostring(count)
				.. " annotation"
				.. suffix
				.. " from "
				.. agent.label
				.. " in "
				.. elapsed
				.. telemetry_suffix(response.result),
			vim.log.levels.INFO
		)
	end, {
		on_progress = function(progress)
			push_annotation_progress(token, progress)
		end,
	})
	if annotation_request.token == token and annotation_request.status == "loading" then
		annotation_request.backend_id = backend_id
	end
end

function M.review_current_hunk()
	model_command.review_current_hunk()
end

function M.reset_agent_session()
	model_command.reset_agent_session()
end

function M.show_agent_session_status()
	model_command.show_agent_session_status()
end

local function recreate_command(name, command, opts)
	pcall(vim.api.nvim_del_user_command, name)
	vim.api.nvim_create_user_command(name, command, opts or {})
end

local function delete_commands(names)
	for _, name in ipairs(names) do
		pcall(vim.api.nvim_del_user_command, name)
	end
end

function M.register()
	recreate_command("VantageSetLens", function(opts)
		local active_lens = state.get_lens()
		local mode = opts.fargs[1] or (active_lens and active_lens.mode) or "general"
		local text = trim(table.concat(vim.list_slice(opts.fargs, 2), " "))
		if text == "" then
			prompt_lens(mode)
			return
		end
		M.set_lens(mode, text)
	end, { nargs = "*" })

	recreate_command("VantageClearLens", function()
		M.clear_lens()
	end)

	delete_commands({ "VantageExplainLine", "VantageExplainSelection" })
	recreate_command("VantageExplain", function(opts)
		M.explain(opts)
	end, { range = true })

	recreate_command("VantageQuestion", function(opts)
		M.question(opts)
	end, { range = true, nargs = "*" })

	recreate_command("VantageEdit", function(opts)
		M.edit(opts)
	end, { range = true, nargs = "*" })

	delete_commands({ "VantageToggleAnnotations" })
	recreate_command("VantageAnnotate", function(opts)
		M.annotate(opts)
	end, { range = true, nargs = "*" })

	recreate_command("VantageAnnotationClear", function()
		M.clear_annotations()
	end)

	recreate_command("VantageAnnotationStatus", function()
		M.show_annotation_status()
	end)

	recreate_command("VantageContextStatus", function()
		M.show_agent_context_status()
	end)

	recreate_command("VantageAgentReset", function()
		M.reset_agent_session()
	end)

	recreate_command("VantageAgentStatus", function()
		M.show_agent_session_status()
	end)

	recreate_command("VantageReviewHunk", function()
		M.review_current_hunk()
	end)
end

return M
