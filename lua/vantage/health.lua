-- :checkhealth vantage: Neovim, git, Diffview, and whether a Pi agent with
-- pi-vantage-nvim answers for this workspace.
local M = {}

local function check_neovim()
	if vim.fn.has("nvim-0.10") == 1 then
		vim.health.ok("Neovim " .. tostring(vim.version()))
	else
		vim.health.error("Neovim 0.10 or newer is required")
	end
	if vim.fn.executable("git") == 1 then
		vim.health.ok("git found")
	else
		vim.health.error("git not found on PATH", "Review bases and changed-file lists need git.")
	end
	if vim.fn.exists(":DiffviewOpen") == 2 or pcall(require, "diffview") then
		vim.health.ok("Diffview available for diff tours and review files")
	else
		vim.health.info("Diffview not loaded; diff tours need diffview.nvim")
	end
end

local function check_agent()
	local paths = require("vantage.paths")
	local protocol = require("vantage.review.protocol")
	local root = paths.workspace_root()
	vim.health.info("Workspace: " .. root)
	vim.health.info("Socket directory: " .. protocol.socket_directory() .. " (prefix " .. protocol.workspace_prefix(root) .. ")")
	local done, candidates, refused = false, {}, nil
	require("vantage.review.client").discover(root, function(err, found)
		candidates = found or {}
		refused = err
		done = true
	end)
	vim.wait(3000, function()
		return done
	end, 20)
	if refused then
		vim.health.error(refused, "Remove that path and restart pi; it recreates the directory owner-only.")
	elseif not done then
		vim.health.warn("Agent discovery timed out")
	elseif #candidates == 0 then
		vim.health.warn(
			"No Pi agent with pi-vantage-nvim answers for this workspace",
			"Start `pi` in " .. root .. " with the pi-vantage-nvim extension installed (`pi install <vantage-nvim dir>`)."
		)
	else
		for _, candidate in ipairs(candidates) do
			vim.health.ok(string.format("Pi agent: %s (pid %d), protocol %d", candidate.session_name or candidate.session_id, candidate.pid, protocol.VERSION))
		end
	end
	local connection = require("vantage.review").connection()
	vim.health.info("Connection: " .. connection.status .. (connection.socket and (" via " .. connection.socket) or ""))
end

function M.check()
	vim.health.start("vantage.nvim")
	check_neovim()
	vim.health.start("Adjacent Pi agent")
	check_agent()
end

return M
