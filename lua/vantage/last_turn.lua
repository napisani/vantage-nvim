local agent_context = require("vantage.agent_context")
local paths = require("vantage.paths")

local M = {}

local DEFAULT_PATH = ".vantage/last-turn.md"

local function configured_path()
	local path = (require("vantage.state").config.last_turn or {}).path
	if type(path) == "string" and path ~= "" then
		return path
	end
	return DEFAULT_PATH
end

function M.resolved_path(root)
	local path = configured_path()
	if path:sub(1, 1) == "/" or path:match("^%a:[/\\]") then
		return paths.normalize(path)
	end
	root = root or agent_context.workspace_root()
	return paths.normalize(root .. "/" .. path)
end

-- :VantageLastTurn — open the adjacent agent's last-turn doc for editing.
-- Returns the buffer, or nil when the doc has not been written yet.
function M.open()
	local path = M.resolved_path()
	if vim.fn.filereadable(path) == 0 then
		vim.notify(
			"Vantage: no last-turn doc at " .. path .. "; run /vantage-last-turn-to-doc in the agent first",
			vim.log.levels.INFO
		)
		return nil
	end

	vim.cmd.edit(vim.fn.fnameescape(path))
	local bufnr = vim.api.nvim_get_current_buf()
	-- The agent keeps editing this doc on later turns, so pick up its writes
	-- whenever Neovim next checks the file instead of prompting.
	vim.bo[bufnr].autoread = true
	vim.cmd.checktime(bufnr)
	return bufnr
end

return M
