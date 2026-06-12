local backend = require("vantage.backend")
local buffer_edit = require("vantage.buffer_edit")
local context = require("vantage.context")
local prompt_authoring = require("vantage.prompt_authoring")
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
		return context.line_range(opts.line1, opts.line2)
	end

	return nil
end

local function scoped_context(opts)
	return range_context(opts) or context.current_line()
end

local function request_question(params, question)
	params.selectedText = params.selectedText or params.text
	params.question = question
	request_markdown("questionSelection", params)
end

local function request_edit(bufnr, params, instruction)
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

function M.explain(opts)
	request_markdown("explainSelection", scoped_context(opts))
end

function M.question(opts)
	local params = scoped_context(opts)
	prompt_authoring.resolve({
		kind = "question",
		params = params,
		command_opts = opts,
		on_submit = function(question)
			request_question(params, question)
		end,
	})
end

function M.edit(opts)
	local bufnr = vim.api.nvim_get_current_buf()
	local params = scoped_context(opts)

	prompt_authoring.resolve({
		kind = "edit",
		params = params,
		command_opts = opts,
		on_submit = function(instruction)
			request_edit(bufnr, params, instruction)
		end,
	})
end

local function quickfix_filename(workspace_root, file_path)
	if file_path:sub(1, 1) == "/" then
		return file_path
	end
	if workspace_root and workspace_root ~= "" then
		return workspace_root .. "/" .. file_path
	end
	return file_path
end

local function open_search_results(response, workspace_root)
	if not response or not response.ok then
		ui.show_markdown(error_markdown(response))
		return
	end
	if not response.result or response.result.kind ~= "locations" then
		ui.show_markdown("## Error\n\nBackend returned an invalid search response.")
		return
	end

	local items = {}
	for _, location in ipairs(response.result.locations or {}) do
		table.insert(items, {
			filename = quickfix_filename(workspace_root, location.filePath or ""),
			lnum = location.startLine or 1,
			col = location.startCharacter or 1,
			text = location.explanation or "",
		})
	end

	vim.fn.setqflist({}, "r", { title = #items == 0 and "Vantage Search: no results" or "Vantage Search", items = items })
	if #items == 0 then
		vim.notify("Vantage: no search results found", vim.log.levels.INFO)
		return
	end
	vim.cmd("copen")
end

local function request_search(params, query)
	params.query = query
	params.selectedText = params.selectedText or params.text
	backend.request("searchLocations", params, function(response)
		open_search_results(response, params.workspaceRoot)
	end)
end

function M.search(opts)
	local params = scoped_context(opts)
	prompt_authoring.resolve({
		kind = "search",
		params = params,
		command_opts = opts,
		empty_message = "Vantage: search requires a prompt",
		on_submit = function(query)
			request_search(params, query)
		end,
	})
end

function M.agent_cancel()
	request_markdown("agentCancel", context.current_line())
end

function M.reset_agent_session()
	request_markdown("agentSessionReset", context.current_line())
end

return M
