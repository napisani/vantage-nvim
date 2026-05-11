local M = {}

function M.run()
	local state = require("learn.state")
	local expected_mode = vim.env.LEARN_DEV_PROVIDER == "codex" and "stdio" or "fake"
	assert(state.config.backend.mode == expected_mode, "expected dev init to use " .. expected_mode .. " backend")
	assert(vim.fn.exists(":LearnExplainLine") == 2, "expected LearnExplainLine command")

	vim.api.nvim_buf_set_lines(0, 0, -1, false, { "local value = 42" })
	vim.bo.filetype = "lua"

	if expected_mode == "fake" then
		vim.cmd("LearnExplainLine")

		local float_buf = require("learn.ui").last_float_buf()
		assert(float_buf and vim.api.nvim_buf_is_valid(float_buf), "expected explanation float")
		local text = table.concat(vim.api.nvim_buf_get_lines(float_buf, 0, -1, false), "\n")
		assert(text:match("Fake provider"), text)
	end

	vim.cmd("silent! bufdo setlocal nomodified")
end

return M
