local annotations = require("vantage.annotations")
local backend = require("vantage.backend")
local context = require("vantage.context")
local state = require("vantage.state")
local ui = require("vantage.ui")

local M = {}
local DEFAULT_ANNOTATION_LIMIT = 3
local LINE_ANNOTATION_LIMIT = 1
local annotation_request = {
	status = "idle",
	token = 0,
	started_at = 0,
	provider = nil,
	backend_id = nil,
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

local function annotation_count(value)
	if type(value) == "table" then
		return #value
	end
	return 0
end

local function annotation_provider()
	local backend_config = state.config.backend or {}
	local mode = backend_config.mode or "stdio"
	local name = mode
	local provider_config = state.config.provider or {}
	if mode == "fake" then
		name = "fake"
	else
		name = provider_config.name or "fake"
	end
	if name == "" then
		name = mode
	end

	local model = nil
	local trace = nil
	if name == "ollama" then
		local ollama = provider_config.ollama or {}
		model = ollama.model
		trace = ollama.trace_response_path
	elseif name == "codex" then
		local codex = provider_config.codex or {}
		model = codex.model
		trace = codex.trace_response_path
	elseif name == "chatgpt" then
		local chatgpt = provider_config.chatgpt or {}
		model = chatgpt.model
		trace = chatgpt.trace_response_path
	elseif name == "pi" then
		local pi = provider_config.pi or {}
		local pi_provider = pi.provider or "openai"
		model = pi.model
		if not model or model == "" then
			model = "gpt-4o-mini"
		end
		model = pi_provider .. "/" .. model
		trace = pi.trace_response_path
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

local function annotation_timeout_ms(provider)
	local provider_config = state.config.provider or {}
	local name = provider and provider.name
	local settings = name and provider_config[name] or nil
	local value = settings and settings.annotation_timeout_ms
	if type(value) == "number" and value > 0 then
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

local function provider_label(provider)
	return provider and provider.label or "unknown"
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
		scope = nil,
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

	return parsed, nil
end

local function annotation_context(opts, annotation_options)
	if annotation_options.scope == "line" then
		return context.current_line(), "line"
	end

	if annotation_options.scope == "visible" then
		return context.visible(), "range"
	end

	local selected_range = range_context(opts)
	if selected_range then
		return selected_range, "range"
	end

	return context.current_line(), "line"
end

local function annotation_limit(annotation_options, scope_kind)
	if annotation_options.max_annotations then
		return annotation_options.max_annotations
	end
	if scope_kind == "line" then
		return LINE_ANNOTATION_LIMIT
	end
	return DEFAULT_ANNOTATION_LIMIT
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
	set_annotation_status({
		status = "cancelled",
		provider = provider_label(provider),
		elapsed = elapsed,
		message = "Annotation request cancelled after " .. elapsed .. ".",
		trace = provider and provider.trace or nil,
	})
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

	set_annotation_status({
		status = "loading",
		provider = provider_label(provider),
		message = "Annotation request is still waiting for " .. provider_label(provider) .. ".",
		trace = provider and provider.trace or nil,
	})
	vim.notify("Vantage: requesting annotations from " .. provider.label, vim.log.levels.INFO)
	vim.defer_fn(function()
		if annotation_request.status == "loading" and annotation_request.token == token then
			local elapsed = format_elapsed(elapsed_seconds(annotation_request.started_at))
			set_annotation_status({
				status = "loading",
				provider = provider_label(provider),
				elapsed = elapsed,
				message = "Annotation request is still waiting after " .. elapsed .. ".",
				trace = provider and provider.trace or nil,
			})
			vim.notify(
				"Vantage: still waiting for annotations from " .. provider.label .. " after " .. elapsed .. trace_suffix(provider),
				vim.log.levels.WARN
			)
		end
	end, waiting_message_ms())

	return token
end

local function schedule_annotation_timeout(token, provider)
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
		set_annotation_status({
			status = "failed",
			provider = provider_label(provider),
			elapsed = elapsed,
			error = error_message,
			message = error_message,
			trace = provider and provider.trace or nil,
		})
		vim.notify(
			"Vantage: annotation request from "
				.. provider.label
				.. " timed out after "
				.. elapsed
				.. trace_suffix(provider),
			vim.log.levels.ERROR
		)
		ui.show_markdown("## Error\n\n" .. error_message)
	end, annotation_timeout_ms(provider))
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
		status.status = "loading"
		status.provider = provider_label(annotation_request.provider)
		status.elapsed = elapsed
		status.message = "Annotation request is still waiting after " .. elapsed .. "."
		status.trace = annotation_request.provider and annotation_request.provider.trace or status.trace
	end
	return status
end

function M.show_annotation_status()
	local status = M.annotation_status()
	local lines = {
		"## Vantage Annotation Status",
		"",
		"- Status: " .. tostring(status.status or "unknown"),
	}
	if status.provider then
		table.insert(lines, "- Provider: " .. tostring(status.provider))
	end
	if status.elapsed then
		table.insert(lines, "- Elapsed: " .. tostring(status.elapsed))
	end
	if status.received ~= nil then
		table.insert(lines, "- Provider annotations returned: " .. tostring(status.received))
	end
	if status.rendered ~= nil then
		table.insert(lines, "- Buffer annotations rendered: " .. tostring(status.rendered))
	end
	if status.skipped ~= nil then
		table.insert(lines, "- Returned annotations skipped: " .. tostring(status.skipped))
	end
	if status.trace then
		table.insert(lines, "- Response trace: `" .. tostring(status.trace) .. "`")
	end
	if status.error then
		table.insert(lines, "")
		table.insert(lines, "### Error")
		table.insert(lines, "")
		table.insert(lines, tostring(status.error))
	end
	if status.message then
		table.insert(lines, "")
		table.insert(lines, tostring(status.message))
	end

	ui.show_markdown(table.concat(lines, "\n"))
	vim.notify("Vantage annotation status: " .. tostring(status.status or "unknown"), vim.log.levels.INFO)
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
	local params, scope_kind = annotation_context(opts, annotation_options)
	params.scopeText = params.text
	params.maxAnnotations = annotation_limit(annotation_options, scope_kind)
	local candidate_lines = annotation_candidate_lines(params)
	if #candidate_lines > 0 and #candidate_lines <= params.maxAnnotations then
		params.candidateLines = candidate_lines
	end
	local provider = annotation_provider()
	local token = begin_annotation_request(provider)
	schedule_annotation_timeout(token, provider)

	local backend_id = backend.request("annotateRange", params, function(response)
		local elapsed = complete_annotation_request(token)
		if not elapsed then
			return
		end

		if not response or not response.ok then
			local error_message = error_markdown(response):gsub("^## Error\n\n", "")
			set_annotation_status({
				status = "failed",
				provider = provider_label(provider),
				elapsed = elapsed,
				error = error_message,
				message = "Annotation request failed after " .. elapsed .. ".",
				trace = provider and provider.trace or nil,
			})
			vim.notify(
				"Vantage: annotation request from " .. provider.label .. " failed after " .. elapsed .. trace_suffix(provider),
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
				message = "Provider returned no annotations."
			else
				message = "Provider returned " .. tostring(received_count) .. " annotation(s), but they were not visible in this buffer."
			end
			set_annotation_status({
				status = "no_visible_annotations",
				provider = provider_label(provider),
				elapsed = elapsed,
				received = received_count,
				rendered = count,
				skipped = skipped,
				message = message,
				trace = provider and provider.trace or nil,
			})
			vim.notify(
				"Vantage: "
					.. provider.label
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
		set_annotation_status({
			status = "rendered",
			provider = provider_label(provider),
			elapsed = elapsed,
			received = received_count,
			rendered = count,
			skipped = math.max(0, received_count - count),
			message = "Rendered " .. tostring(count) .. " annotation" .. suffix .. ".",
			trace = provider and provider.trace or nil,
		})
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

	recreate_command("VantageAnnotationStatus", function()
		M.show_annotation_status()
	end)

	recreate_command("VantageReviewHunk", function()
		M.review_current_hunk()
	end)
end

return M
