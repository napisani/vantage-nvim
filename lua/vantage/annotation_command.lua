-- :VantageAnnotate: picks the scope and the annotation budget, asks the agent,
-- and draws the blocks it returns. Results stay on screen only.
local annotations = require("vantage.annotations")
local context = require("vantage.context")
local review = require("vantage.review")
local state = require("vantage.state")

local M = {}

local LINE_ANNOTATION_LIMIT = 1
local SCOPE_ANNOTATION_PERCENT = 0.25
local SCOPE_ANNOTATION_MIN = 1
local SCOPE_ANNOTATION_MAX = 12
local BUFFER_ANNOTATION_PERCENT = 0.15
local BUFFER_ANNOTATION_MIN = 3
local BUFFER_ANNOTATION_MAX = 24

-- The annotate request in flight, if any: { annotate_id, bufnr, timer, started }.
local inflight = nil
local last_status = nil

local function timeout_ms()
	local value = (state.config.review or {}).annotate_timeout_ms
	if type(value) == "number" and value > 0 then
		return value
	end
	return 300000
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

local function is_annotation_candidate(line)
	local trimmed = (line or ""):gsub("^%s+", "")
	return trimmed ~= ""
		and not vim.startswith(trimmed, "--")
		and not vim.startswith(trimmed, "//")
		and not vim.startswith(trimmed, "#")
		and not vim.startswith(trimmed, "/*")
		and not vim.startswith(trimmed, "*")
end

local function candidate_lines(params)
	local candidates = {}
	local base_line = params.range and params.range.startLine or params.visibleRange and params.visibleRange.startLine or 1
	for index, line in ipairs(split_lines(params.text or "")) do
		if is_annotation_candidate(line) then
			table.insert(candidates, { line = base_line + index - 1, text = line })
		end
	end
	return candidates
end

local function parse_positive_integer(text)
	local value = tonumber(text)
	if value and value > 0 and math.floor(value) == value then
		return value
	end
	return nil
end

local function parse_options(opts)
	local parsed = { scope = nil, max_annotations = nil }
	for _, arg in ipairs(opts and opts.fargs or {}) do
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

local function scoped_context(opts, options)
	if options.scope == "line" then
		return context.current_line(), "line"
	end
	if options.scope == "visible" then
		return context.visible(), "visible"
	end
	if options.scope == "buffer" then
		return context.buffer(), "buffer"
	end
	local selected = context.selected_range(opts)
	if selected then
		return selected, "range"
	end
	return context.current_line(), "line"
end

local function percentage_budget(count, percent, minimum, maximum)
	local budget = math.ceil(math.max(0, count or 0) * percent)
	return math.max(minimum, math.min(maximum, budget))
end

local function budget(options, scope, count)
	if options.max_annotations then
		return options.max_annotations
	end
	if scope == "line" then
		return LINE_ANNOTATION_LIMIT
	end
	if scope == "buffer" then
		return percentage_budget(count, BUFFER_ANNOTATION_PERCENT, BUFFER_ANNOTATION_MIN, BUFFER_ANNOTATION_MAX)
	end
	return percentage_budget(count, SCOPE_ANNOTATION_PERCENT, SCOPE_ANNOTATION_MIN, SCOPE_ANNOTATION_MAX)
end

---Ends the request in flight. `withdraw` asks the extension to drop it too, so a
---cancelled or timed-out request does not still cost the agent a turn.
local function finish(status, withdraw)
	if inflight then
		if inflight.timer then
			inflight.timer:stop()
			inflight.timer:close()
		end
		if withdraw and inflight.annotate_id then
			review.cancel_annotate(inflight.annotate_id)
		end
	end
	inflight = nil
	last_status = status
end

local function elapsed(started)
	return string.format("%.1fs", (vim.uv.now() - started) / 1000)
end

---The last annotate request's outcome, for :VantageStatus.
---@return table? status { status, message }
function M.status()
	if inflight then
		return { status = "waiting", message = "Waiting for annotations (" .. elapsed(inflight.started) .. ")." }
	end
	return last_status
end

---Abandons the annotate request in flight and withdraws it from the agent.
---@return boolean cancelled
function M.cancel()
	if not inflight then
		return false
	end
	finish({ status = "cancelled", message = "Annotation request cancelled." }, true)
	return true
end

function M.clear()
	M.cancel()
	require("vantage.walkthrough").disarm()
	annotations.clear_all()
	vim.notify("Vantage: cleared annotations", vim.log.levels.INFO)
end

local function on_result(bufnr, started, message)
	if message.kind == "annotateFailed" then
		finish({ status = "failed", message = message.reason })
		vim.notify("Vantage: annotation failed: " .. tostring(message.reason), vim.log.levels.ERROR)
		return
	end
	local blocks = {}
	for _, block in ipairs(message.blocks or {}) do
		table.insert(blocks, { range = { startLine = block.line, startCharacter = 1 }, text = block.text })
	end
	local count = vim.api.nvim_buf_is_valid(bufnr) and annotations.render(bufnr, blocks) or 0
	local time = elapsed(started)
	finish({ status = count > 0 and "rendered" or "no_visible_annotations", message = string.format("Rendered %d of %d annotations in %s.", count, #blocks, time) })
	vim.notify(string.format("Vantage: rendered %d annotation%s in %s", count, count == 1 and "" or "s", time), count > 0 and vim.log.levels.INFO or vim.log.levels.WARN)
end

function M.annotate(opts)
	M.cancel()
	local options, parse_error = parse_options(opts)
	if not options then
		vim.notify("Vantage: " .. parse_error, vim.log.levels.ERROR)
		return
	end
	local bufnr = vim.api.nvim_get_current_buf()
	local params, scope = scoped_context(opts, options)
	local path = require("vantage.paths").relative(params.workspaceRoot, params.filePath or "")
	if not path then
		vim.notify("Vantage: annotate needs a file inside the workspace", vim.log.levels.WARN)
		return
	end
	local candidates = candidate_lines(params)
	if #candidates == 0 then
		vim.notify("Vantage: no code lines to annotate here", vim.log.levels.INFO)
		return
	end
	local lens = state.get_lens()
	local started = vim.uv.now()
	local request = {
		path = path,
		scope = scope,
		lines = candidates,
		budget = budget(options, scope, #candidates),
		lens = lens and lens.text or nil,
	}
	inflight = { bufnr = bufnr, started = started }
	local mine = inflight
	review.annotate(request, function(err, annotate_id)
		if inflight ~= mine then
			-- Cancelled before the extension acknowledged it: withdraw it now.
			if annotate_id then
				review.cancel_annotate(annotate_id)
			end
			return
		end
		if err then
			finish({ status = "failed", message = err })
			vim.notify("Vantage: " .. err, vim.log.levels.ERROR)
			return
		end
		mine.annotate_id = annotate_id
		mine.timer = vim.uv.new_timer()
		mine.timer:start(timeout_ms(), 0, vim.schedule_wrap(function()
			if inflight == mine then
				finish({ status = "timed_out", message = "No annotations after " .. elapsed(started) .. "." }, true)
				vim.notify("Vantage: annotation request timed out", vim.log.levels.WARN)
			end
		end))
		vim.notify(string.format("Vantage: asked the agent to annotate %d line%s (budget %d)", #candidates, #candidates == 1 and "" or "s", request.budget), vim.log.levels.INFO)
	end, function(message)
		if inflight == mine then
			on_result(bufnr, started, message)
		end
	end)
end

return M
