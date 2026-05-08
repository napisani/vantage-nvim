local state = require("learn.state")
local commands = require("learn.commands")

local M = {}

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

return M
