local M = {}

function M.run()
	local state = require("vantage.state")
	local expected_mode = (
				vim.g.vantage_dev_provider == "codex"
				or vim.g.vantage_dev_provider == "ollama"
				or vim.g.vantage_dev_provider == "chatgpt"
				or vim.g.vantage_dev_provider == "pi"
			)
			and "stdio"
		or "fake"
	assert(state.config.backend.mode == expected_mode, "expected dev init to use " .. expected_mode .. " backend")
	assert((state.config.provider or {}).name == (vim.g.vantage_dev_provider or "fake"), "expected provider config")
	assert(vim.fn.exists(":VantageExplain") == 2, "expected VantageExplain command")

	vim.api.nvim_buf_set_lines(0, 0, -1, false, { "local value = 42" })
	vim.bo.filetype = "lua"

	if expected_mode == "fake" then
		vim.cmd("VantageExplain")

		local float_buf = require("vantage.ui").last_float_buf()
		assert(float_buf and vim.api.nvim_buf_is_valid(float_buf), "expected explanation float")
		local text = table.concat(vim.api.nvim_buf_get_lines(float_buf, 0, -1, false), "\n")
		assert(text:match("Fake provider"), text)
	end

	vim.cmd("silent! bufdo setlocal nomodified")
end

return M
