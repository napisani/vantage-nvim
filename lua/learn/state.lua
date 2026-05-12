local M = {}

M.config = {
	backend = {
		mode = "stdio",
		command = { "node", "server/out/neovim/stdio-server.js" },
	},
	annotations = {
		waiting_message_ms = 30000,
	},
}

M.lens = nil

function M.setup(config)
	M.config = vim.tbl_deep_extend("force", M.config, config or {})
end

function M.set_lens(mode, text)
	M.lens = { mode = mode, text = text }
end

function M.get_lens()
	return M.lens
end

function M.clear_lens()
	M.lens = nil
end

return M
