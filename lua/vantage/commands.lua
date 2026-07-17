local annotation_command = require("vantage.annotation_command")
local agent_context = require("vantage.agent_context")
local backend = require("vantage.backend")
local CommandNames = require("vantage.command_names")
local context = require("vantage.context")
local input_ui = require("vantage.input")
local model_command = require("vantage.model_command")
local state = require("vantage.state")
local session_output = require("vantage.session_output")
local status_view = require("vantage.status")
local ui = require("vantage.ui")
local walkthrough = require("vantage.walkthrough")

local M = {
	CommandNames = CommandNames,
}

local function trim(text)
	return (text or ""):gsub("^%s+", ""):gsub("%s+$", "")
end

function M.annotation_status()
	return annotation_command.status()
end

function M.agent_context_status()
	return agent_context.snapshot()
end

local function agent_status_markdown(response)
	if response and response.ok and response.result and response.result.markdown then
		return response.result.markdown
	end
	local message = "Unknown backend error."
	if response and response.error then
		message = response.error.message or response.error
	end
	return "## Vantage Agent Session\n\n### Error\n\n" .. tostring(message)
end

function M.show_status()
	backend.request("agentSessionStatus", context.current_line(), function(response)
		ui.show_markdown(status_view.combined({
			agent_markdown = agent_status_markdown(response),
			agent_context = M.agent_context_status(),
			annotation = M.annotation_status(),
		}))
		vim.notify("Vantage status shown", vim.log.levels.INFO)
	end)
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

function M.prompt_lens(mode)
	prompt_lens(mode or "general")
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
	annotation_command.clear()
end

function M.annotate(opts)
	annotation_command.annotate(opts)
end

function M.load_walkthrough()
	walkthrough.load()
end

function M.search(opts)
	model_command.search(opts)
end

function M.generate_walkthrough(opts)
	model_command.generate_walkthrough(opts)
end

function M.agent_cancel()
	model_command.agent_cancel()
end

function M.reset_agent_session()
	model_command.reset_agent_session()
end

function M.session_output()
	session_output.open()
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
	recreate_command(CommandNames.set_lens, function(opts)
		local active_lens = state.get_lens()
		local mode = opts.fargs[1] or (active_lens and active_lens.mode) or "general"
		local text = trim(table.concat(vim.list_slice(opts.fargs, 2), " "))
		if text == "" then
			prompt_lens(mode)
			return
		end
		M.set_lens(mode, text)
	end, { nargs = "*" })

	recreate_command(CommandNames.clear_lens, function()
		M.clear_lens()
	end)

	delete_commands({ "VantageExplainLine", "VantageExplainSelection" })
	recreate_command(CommandNames.explain, function(opts)
		M.explain(opts)
	end, { range = true })

	recreate_command(CommandNames.question, function(opts)
		M.question(opts)
	end, { range = true, nargs = "*" })

	recreate_command(CommandNames.edit, function(opts)
		M.edit(opts)
	end, { range = true, nargs = "*" })

	delete_commands({ "VantageToggleAnnotations" })
	recreate_command(CommandNames.annotate, function(opts)
		M.annotate(opts)
	end, { range = true, nargs = "*" })

	recreate_command(CommandNames.annotation_clear, function()
		M.clear_annotations()
	end)

	recreate_command(CommandNames.load_walkthrough, function()
		M.load_walkthrough()
	end)

	recreate_command(CommandNames.status, function()
		M.show_status()
	end)

	recreate_command(CommandNames.session_output, function()
		M.session_output()
	end)

	recreate_command(CommandNames.search, function(opts)
		M.search(opts)
	end, { range = true, nargs = "*" })

	recreate_command(CommandNames.generate_walkthrough, function(opts)
		M.generate_walkthrough(opts)
	end, { range = true, nargs = "*" })

	recreate_command(CommandNames.agent_cancel, function()
		M.agent_cancel()
	end)

	recreate_command(CommandNames.agent_reset, function()
		M.reset_agent_session()
	end)

end

return M
