local state = require("learn.state")

local M = {}

function M.setup(config)
	state.setup(config)
end

function M.set_lens(mode, text)
	state.set_lens(mode, text)
end

function M.get_lens()
	return state.get_lens()
end

function M.clear_lens()
	state.clear_lens()
end

return M
