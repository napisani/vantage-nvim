local annotations = require("vantage.annotations")
local backend = require("vantage.backend")
local context = require("vantage.context")
local state = require("vantage.state")
local ui = require("vantage.ui")

local M = {}
local DEFAULT_ANNOTATION_LIMIT = 3
local LINE_ANNOTATION_LIMIT = 1
local VISIBLE_ANNOTATION_LIMIT = 6
local annotation_request = {
	status = "idle",
	token = 0,
	started_at = 0,
	provider = nil,
	backend_id = nil,
}

local function annotation_provider()
	local backend_config = state.config.backend or {}
	local mode = backend_config.mode or "stdio"
	local name = mode
	if mode ~= "fake" then
		name = vim.env.VANTAGE_PROVIDER or vim.env.VANTAGE_DEV_PROVIDER or mode
	end
	if name == "" then
		name = mode
	end

	local model = nil
	local trace = nil
	if name == "ollama" then
		model = vim.env.VANTAGE_OLLAMA_MODEL
		trace = vim.env.VANTAGE_OLLAMA_TRACE_RESPONSE_PATH
	elseif name == "codex" then
		model = vim.env.VANTAGE_CODEX_MODEL
		trace = vim.env.VANTAGE_CODEX_TRACE_RESPONSE_PATH
	end

	local label = name
	if model and model ~= "" then
		label = label .. " (" .. model .. ")"
	end

	return {
		name = name,
		label = label,
		trace = trace,
	}
end

local function waiting_message_ms()
	local config = state.config.annotations or {}
	local value = config.waiting_message_ms
	if type(value) == "number" and value >= 0 then
		return value
	end
	return 30000
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

local function trace_suffix(provider)
	if provider and provider.trace and provider.trace ~= "" then
		return "; response trace: " .. provider.trace
	end
	return ""
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

local function annotation_candidate_lines(params, max_annotations)
	max_annotations = max_annotations or DEFAULT_ANNOTATION_LIMIT
	local lines = split_lines(params.text or "")
	local visible_start = params.visibleRange and params.visibleRange.startLine or 0
	local cursor_line = params.cursor and params.cursor.line or visible_start
	local cursor_index = math.max(1, math.min(#lines, cursor_line - visible_start + 1))
	local candidates = {}

	local function add(index)
		if #candidates >= max_annotations then
			return
		end
		local line = lines[index]
		if line and is_annotation_candidate(line) then
			table.insert(candidates, { line = index - 1, text = line })
		end
	end

	for index = cursor_index, #lines do
		add(index)
	end
	for index = cursor_index - 1, 1, -1 do
		add(index)
	end

	table.sort(candidates, function(left, right)
		return left.line < right.line
	end)
	return candidates
end

local function telemetry_suffix(result)
	local telemetry = result and result.telemetry
	if type(telemetry) ~= "table" then
		return ""
	end

	local details = {}
	if type(telemetry.totalDurationMs) == "number" then
		table.insert(details, "provider " .. format_elapsed(telemetry.totalDurationMs / 1000))
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

local function handle_markdown_response(response)
	if not response or not response.ok then
		ui.show_markdown(error_markdown(response))
		return
	end

	ui.show_markdown(response.result.markdown or "")
end

local function no_annotations_markdown()
	return table.concat({
		"## No annotations",
		"",
		"The provider did not return visible annotations for this window.",
	}, "\n")
end

local function request_markdown(method, params)
	backend.request(method, params, handle_markdown_response)
end

local function range_context(opts)
	if opts and type(opts.range) == "number" and opts.range > 0 then
		return context.line_range(opts.line1 - 1, opts.line2 - 1)
	end

	return nil
end

local function parse_positive_integer(text)
	local value = tonumber(text)
	if value and value > 0 and math.floor(value) == value then
		return value
	end
	return nil
end

local function parse_annotation_options(opts)
	local args = opts and opts.fargs or {}
	local parsed = {
		scope = "nearby",
		max_annotations = nil,
	}

	for _, arg in ipairs(args) do
		local max_annotations = parse_positive_integer(arg)
		if max_annotations then
			parsed.max_annotations = max_annotations
		elseif arg == "line" or arg == "visible" then
			parsed.scope = arg
		else
			return nil, 'unsupported annotation option "' .. tostring(arg) .. '"'
		end
	end

	if not parsed.max_annotations then
		if parsed.scope == "line" then
			parsed.max_annotations = LINE_ANNOTATION_LIMIT
		elseif parsed.scope == "visible" then
			parsed.max_annotations = VISIBLE_ANNOTATION_LIMIT
		else
			parsed.max_annotations = DEFAULT_ANNOTATION_LIMIT
		end
	end

	return parsed, nil
end

local function annotation_context(opts, annotation_options)
	if annotation_options.scope == "line" then
		return context.current_line()
	end

	if annotation_options.scope == "visible" then
		return context.visible()
	end

	return range_context(opts) or context.visible()
end

local function explanation_context(opts)
	return range_context(opts) or context.current_line()
end

local function cancel_annotation_request(message_prefix)
	if annotation_request.status ~= "loading" then
		return false
	end

	local provider = annotation_request.provider or annotation_provider()
	local elapsed = format_elapsed(elapsed_seconds(annotation_request.started_at))
	backend.cancel(annotation_request.backend_id)
	annotation_request.status = "idle"
	annotation_request.token = annotation_request.token + 1
	annotation_request.backend_id = nil
	if message_prefix then
		vim.notify(message_prefix .. " " .. provider.label .. " after " .. elapsed, vim.log.levels.INFO)
	end
	return true
end

local function begin_annotation_request(provider)
	annotation_request.status = "loading"
	annotation_request.token = annotation_request.token + 1
	annotation_request.started_at = vim.loop.hrtime()
	annotation_request.provider = provider
	annotation_request.backend_id = nil
	local token = annotation_request.token

	vim.notify("Vantage: requesting annotations from " .. provider.label, vim.log.levels.INFO)
	vim.defer_fn(function()
		if annotation_request.status == "loading" and annotation_request.token == token then
			local elapsed = format_elapsed(elapsed_seconds(annotation_request.started_at))
			vim.notify(
				"Vantage: still waiting for annotations from " .. provider.label .. " after " .. elapsed .. trace_suffix(provider),
				vim.log.levels.WARN
			)
		end
	end, waiting_message_ms())

	return token
end

local function complete_annotation_request(token)
	if annotation_request.token ~= token or annotation_request.status ~= "loading" then
		return nil
	end

	local elapsed = format_elapsed(elapsed_seconds(annotation_request.started_at))
	annotation_request.status = "idle"
	annotation_request.backend_id = nil
	return elapsed
end

function M.set_lens(mode, text)
	state.set_lens(mode, text)
end

function M.clear_lens()
	state.clear_lens()
end

function M.explain(opts)
	request_markdown("explainSelection", explanation_context(opts))
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
	local params = annotation_context(opts, annotation_options)
	params.scopeText = params.text
	params.maxAnnotations = annotation_options.max_annotations
	params.candidateLines = annotation_candidate_lines(params, annotation_options.max_annotations)
	local provider = annotation_provider()
	local token = begin_annotation_request(provider)

	local backend_id = backend.request("annotateRange", params, function(response)
		local elapsed = complete_annotation_request(token)
		if not elapsed then
			return
		end

		if not response or not response.ok then
			vim.notify(
				"Vantage: annotation request from " .. provider.label .. " failed after " .. elapsed .. trace_suffix(provider),
				vim.log.levels.ERROR
			)
			ui.show_markdown(error_markdown(response))
			return
		end

		local count = annotations.render(bufnr, response.result.annotations or {})
		if count == 0 then
			vim.notify(
				"Vantage: " .. provider.label .. " returned no visible annotations after " .. elapsed,
				vim.log.levels.WARN
			)
			ui.show_markdown(no_annotations_markdown())
			return
		end

		local suffix = count == 1 and "" or "s"
		vim.notify(
			"Vantage: rendered "
				.. tostring(count)
				.. " annotation"
				.. suffix
				.. " from "
				.. provider.label
				.. " in "
				.. elapsed
				.. telemetry_suffix(response.result),
			vim.log.levels.INFO
		)
	end)
	if annotation_request.token == token and annotation_request.status == "loading" then
		annotation_request.backend_id = backend_id
	end
end

function M.review_current_hunk()
	local params = context.visible()
	params.hunkText = params.text
	request_markdown("reviewCurrentHunk", params)
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
	delete_commands({
		"LearnSetLens",
		"LearnClearLens",
		"LearnExplain",
		"LearnExplainLine",
		"LearnExplainSelection",
		"LearnAnnotate",
		"LearnAnnotationClear",
		"LearnToggleAnnotations",
		"LearnReviewHunk",
	})

	recreate_command("VantageSetLens", function(opts)
		local mode = opts.fargs[1]
		local text = table.concat(vim.list_slice(opts.fargs, 2), " ")
		M.set_lens(mode, text)
	end, { nargs = "+" })

	recreate_command("VantageClearLens", function()
		M.clear_lens()
	end)

	delete_commands({ "VantageExplainLine", "VantageExplainSelection" })
	recreate_command("VantageExplain", function(opts)
		M.explain(opts)
	end, { range = true })

	delete_commands({ "VantageToggleAnnotations" })
	recreate_command("VantageAnnotate", function(opts)
		M.annotate(opts)
	end, { range = true, nargs = "*" })

	recreate_command("VantageAnnotationClear", function()
		M.clear_annotations()
	end)

	recreate_command("VantageReviewHunk", function()
		M.review_current_hunk()
	end)
end

return M
