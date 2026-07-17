local state = require("vantage.state")
local commands = require("vantage.commands")

local M = {
	CommandNames = commands.CommandNames,
}

function M.setup(config)
	state.setup(config)
	commands.register()
end

function M.set_lens(mode, text)
	commands.set_lens(mode, text)
end

function M.get_lens()
	return state.get_lens()
end

function M.clear_lens()
	commands.clear_lens()
end

function M.prompt_lens(mode)
	commands.prompt_lens(mode)
end

function M.explain(opts)
	commands.explain(opts or {})
end

function M.question(opts)
	commands.question(opts or {})
end

function M.edit(opts)
	commands.edit(opts or {})
end

function M.annotate(opts)
	commands.annotate(opts or {})
end

function M.clear_annotations()
	commands.clear_annotations()
end

function M.load_walkthrough()
	commands.load_walkthrough()
end

function M.search(opts)
	commands.search(opts or {})
end

function M.generate_walkthrough(opts)
	commands.generate_walkthrough(opts or {})
end

function M.agent_cancel()
	commands.agent_cancel()
end

function M.agent_reset()
	commands.reset_agent_session()
end

function M.status()
	commands.show_status()
end

function M.session_output()
	commands.session_output()
end

return M
