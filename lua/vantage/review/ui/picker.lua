-- Every thread through vim.ui.select, so any picker plugin that overrides it
-- (snacks, fzf-lua, telescope-ui-select) shows them.
local review = require("vantage.review")
local thread_view = require("vantage.review.ui.thread")

local M = {}

---@param entry VantageThreadEntry
---@return string
function M.format(entry)
	local where = entry.path and string.format("%s:%d", entry.path, entry.line) or "workspace"
	return string.format("%-4s %-11s %s  %s%s", entry.id, entry.status, where, entry.title, entry.resolved and "  (resolved)" or "")
end

---@param on_choice fun(entry: VantageThreadEntry)? defaults to opening the thread
function M.pick(on_choice)
	local entries = review.threads()
	if #entries == 0 then
		vim.notify("Vantage: no threads yet", vim.log.levels.INFO)
		return
	end
	vim.ui.select(entries, { prompt = "Vantage threads", format_item = M.format, kind = "vantage_thread" }, function(entry)
		if not entry then
			return
		end
		if on_choice then
			return on_choice(entry)
		end
		thread_view.open(entry.id)
		thread_view.jump_to_anchor(entry.id)
	end)
end

return M
