-- Reloads unmodified buffers from disk when the agent reports a change request
-- done, so buffers, anchors and signs match what it wrote. Buffers with unsaved
-- edits are left alone; Neovim warns about them when they are next focused.
local review = require("vantage.review")

local M = {}

-- thread id -> status in the last state seen
local seen = {}

local function reload_unmodified()
	for _, buf in ipairs(vim.api.nvim_list_bufs()) do
		if vim.api.nvim_buf_is_loaded(buf) and vim.bo[buf].buftype == "" and not vim.bo[buf].modified and vim.api.nvim_buf_get_name(buf) ~= "" then
			-- Buffer-local autoread so the reload never prompts, whatever the user's global setting.
			vim.api.nvim_buf_call(buf, function()
				vim.cmd("setlocal autoread | silent! checktime " .. buf .. " | setlocal autoread<")
			end)
		end
	end
end

---Compares the state with the last one seen; reloads when a change request
---became done. Returns whether it reloaded.
---@return boolean
function M.sync()
	local current = review.state()
	local next_seen = {}
	local finished = false
	for _, thread in ipairs(current and current.threads or {}) do
		next_seen[thread.id] = thread.status
		local before = seen[thread.id]
		if thread.kind == "change" and thread.status == "done" and before ~= nil and before ~= "done" then
			finished = true
		end
	end
	seen = next_seen
	if finished then
		reload_unmodified()
	end
	return finished
end

local group = vim.api.nvim_create_augroup("vantage_review_reload", { clear = true })
vim.api.nvim_create_autocmd("User", {
	group = group,
	pattern = "VantageReviewChanged",
	callback = function()
		M.sync()
	end,
})

return M
