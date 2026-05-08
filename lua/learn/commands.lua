local annotations = require("learn.annotations")
local backend = require("learn.backend")
local context = require("learn.context")
local state = require("learn.state")
local ui = require("learn.ui")

local M = {}

local function error_markdown(response)
	local message = "Unknown backend error."
	if response and response.error then
		message = response.error
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

function M.set_lens(mode, text)
	state.set_lens(mode, text)
end

function M.clear_lens()
	state.clear_lens()
end

function M.explain_current_line()
	request_markdown("explainSelection", context.current_line_as_selection())
end

function M.explain_selection()
	request_markdown("explainSelection", context.selection())
end

function M.toggle_annotations()
	local bufnr = vim.api.nvim_get_current_buf()
	if annotations.is_enabled() then
		annotations.clear(bufnr)
		return
	end

	local params = context.visible()
	params.scopeText = params.text
	backend.request("annotateRange", params, function(response)
		if not response or not response.ok then
			ui.show_markdown(error_markdown(response))
			return
		end

		annotations.render(bufnr, response.result.annotations or {})
	end)
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

function M.register()
	recreate_command("LearnSetLens", function(opts)
		local mode = opts.fargs[1]
		local text = table.concat(vim.list_slice(opts.fargs, 2), " ")
		M.set_lens(mode, text)
	end, { nargs = "+" })

	recreate_command("LearnClearLens", function()
		M.clear_lens()
	end)

	recreate_command("LearnExplainLine", function()
		M.explain_current_line()
	end)

	recreate_command("LearnExplainSelection", function()
		M.explain_selection()
	end, { range = true })

	recreate_command("LearnToggleAnnotations", function()
		M.toggle_annotations()
	end)

	recreate_command("LearnReviewHunk", function()
		M.review_current_hunk()
	end)
end

return M
