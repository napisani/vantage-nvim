local backend = require("vantage.backend")
local buffer_edit = require("vantage.buffer_edit")
local context = require("vantage.context")
local prompt_buffer = require("vantage.prompt_buffer")
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

local function trim(text)
	return (text or ""):gsub("^%s+", ""):gsub("%s+$", "")
end

local function optional_command_text(opts)
	local text = trim(opts and opts.args or "")
	if text:match("%S") == nil then
		return nil
	end
	return text
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
	local question = optional_command_text(opts)
	if question then
		request_question(params, question)
		return
	end

	prompt_buffer.open({
		kind = "question",
		params = params,
		on_submit = function(input)
			input = optional_command_text({ args = input })
			if not input then
				return
			end
			request_question(params, input)
		end,
	})
end

function M.edit(opts)
	local bufnr = vim.api.nvim_get_current_buf()
	local params = scoped_context(opts)

	local instruction = optional_command_text(opts)
	if instruction then
		request_edit(bufnr, params, instruction)
		return
	end

	prompt_buffer.open({
		kind = "edit",
		params = params,
		on_submit = function(input)
			input = optional_command_text({ args = input })
			if not input then
				return
			end

			request_edit(bufnr, params, input)
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
	local query = optional_command_text(opts)
	if query then
		request_search(params, query)
		return
	end
	prompt_buffer.open({
		kind = "search",
		params = params,
		on_submit = function(input)
			input = optional_command_text({ args = input })
			if not input then
				vim.notify("Vantage: search requires a prompt", vim.log.levels.WARN)
				return
			end
			request_search(params, input)
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
