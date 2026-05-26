local backend = require("vantage.backend")
local buffer_edit = require("vantage.buffer_edit")
local context = require("vantage.context")
local ui = require("vantage.ui")

local M = {}

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

local function request_markdown(method, params)
	backend.request(method, params, handle_markdown_response)
end

local function range_context(opts)
	if opts and type(opts.range) == "number" and opts.range > 0 then
		return context.line_range(opts.line1 - 1, opts.line2 - 1)
	end

	return nil
end

local function scoped_context(opts)
	return range_context(opts) or context.current_line()
end

local function command_text(opts, label)
	local text = opts and opts.args or ""
	if text:match("%S") == nil then
		return nil, "Vantage: " .. label .. " requires text."
	end
	return text, nil
end

function M.explain(opts)
	request_markdown("explainSelection", scoped_context(opts))
end

function M.question(opts)
	local question, err = command_text(opts, "question")
	if not question then
		vim.notify(err, vim.log.levels.ERROR)
		return
	end

	local params = scoped_context(opts)
	params.selectedText = params.selectedText or params.text
	params.question = question
	request_markdown("questionSelection", params)
end

function M.edit(opts)
	local instruction, err = command_text(opts, "edit")
	if not instruction then
		vim.notify(err, vim.log.levels.ERROR)
		return
	end

	local bufnr = vim.api.nvim_get_current_buf()
	local params = scoped_context(opts)
	params.selectedText = params.selectedText or params.text
	params.instruction = instruction

	backend.request("editSelection", params, function(response)
		if not response or not response.ok then
			ui.show_markdown(error_markdown(response))
			return
		end

		if not response.result or response.result.kind ~= "edit" then
			ui.show_markdown("## Error\n\nBackend returned an invalid edit response.")
			return
		end

		local applied, apply_err = buffer_edit.apply(bufnr, params.range, response.result.replacementText)
		if not applied then
			ui.show_markdown("## Error\n\n" .. tostring(apply_err))
			return
		end

		vim.notify("Vantage: applied edit replacing " .. tostring(applied.line_count) .. " line(s)", vim.log.levels.INFO)
	end)
end

function M.review_current_hunk()
	local params = context.visible()
	params.hunkText = params.text
	request_markdown("reviewCurrentHunk", params)
end

function M.reset_agent_session()
	request_markdown("agentSessionReset", context.current_line())
end

function M.show_agent_session_status()
	request_markdown("agentSessionStatus", context.current_line())
end

return M
