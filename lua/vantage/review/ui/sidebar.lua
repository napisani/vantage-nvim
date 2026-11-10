-- The review sidebar: every thread grouped by status in a right split. Enter
-- opens the thread in the bottom split and shows its code; focus stays here.
local review = require("vantage.review")
local statuses = require("vantage.review.statuses")
local state = require("vantage.state")
local thread_view = require("vantage.review.ui.thread")

local M = {}

local NAME = "vantage://review"
local win = nil
local rows = {}


local function config()
	return state.config.review or {}
end

local function keymaps()
	local defaults = { open = "<CR>", reply = "r", resolve = "x", edit = "e", delete = "dd", send = "S", recall = "R", cancel = "C", close = "q" }
	return vim.tbl_extend("force", defaults, (config().keymaps or {}).sidebar or {})
end

local function header(current)
	local connection = review.connection()
	local lines = {}
	if not current then
		table.insert(lines, "Vantage · " .. connection.status)
		return lines
	end
	local agent = current.agent
	table.insert(lines, string.format("Vantage · %s · %s", agent.sessionName or agent.sessionId, agent.busy and "● working" or "○ idle"))
	if current.base then
		local target = current.base.target.kind == "worktree" and "worktree" or current.base.target.commit:sub(1, 12)
		table.insert(lines, string.format("base %s (%s) → %s", current.base.ref, current.base.mergeBase:sub(1, 12), target))
	end
	local maps = keymaps()
	table.insert(lines, string.format("%s open · %s reply · %s resolve · %s send round · %s close", maps.open, maps.reply, maps.resolve, maps.send, maps.close))
	return lines
end

local function row(entry)
	local where = entry.path and string.format("%s:%d", entry.path, entry.line) or "workspace"
	return string.format("  %s %s  %s", entry.id, where, entry.title)
end

---The sidebar's lines and the thread id on each row.
---@return string[] lines, table<integer, string> ids
function M.lines()
	local current = review.state()
	local lines = header(current)
	local ids = {}
	local entries = review.threads()
	local resolved = {}
	for _, group in ipairs(statuses.GROUPS) do
		local members = {}
		for _, entry in ipairs(entries) do
			if statuses.group(entry.status) == group.key and not entry.resolved then
				table.insert(members, entry)
			end
		end
		if #members > 0 then
			table.insert(lines, "")
			table.insert(lines, string.format("%s (%d)", group.title, #members))
			for _, entry in ipairs(members) do
				table.insert(lines, row(entry))
				ids[#lines] = entry.id
			end
		end
	end
	for _, entry in ipairs(entries) do
		if entry.resolved then
			table.insert(resolved, entry)
		end
	end
	if #resolved > 0 then
		table.insert(lines, "")
		table.insert(lines, string.format("Resolved (%d)", #resolved))
		for _, entry in ipairs(resolved) do
			table.insert(lines, row(entry))
			ids[#lines] = entry.id
		end
	end
	return lines, ids
end

local function buffer()
	local buf = vim.fn.bufnr(NAME)
	if buf ~= -1 then
		return buf
	end
	buf = vim.api.nvim_create_buf(false, true)
	vim.api.nvim_buf_set_name(buf, NAME)
	vim.bo[buf].buftype = "nofile"
	vim.bo[buf].bufhidden = "hide"
	vim.bo[buf].swapfile = false
	vim.bo[buf].filetype = "vantage_review"
	local maps = keymaps()
	local function id()
		return M.id_at_cursor()
	end
	local function with_id(fn)
		return function()
			local thread_id = id()
			if thread_id then
				fn(thread_id)
			end
		end
	end
	local api = function()
		return require("vantage")
	end
	local bindings = {
		{ maps.open, with_id(function(thread_id)
			thread_view.open(thread_id)
			thread_view.jump_to_anchor(thread_id, true)
		end), "Open thread" },
		{ maps.reply, with_id(function(thread_id) api().reply({ thread_id = thread_id }) end), "Reply" },
		{ maps.resolve, with_id(function(thread_id) api().resolve({ thread_id = thread_id }) end), "Toggle resolved" },
		{ maps.edit, with_id(function(thread_id) api().reply({ thread_id = thread_id }) end), "Edit pending request" },
		{ maps.delete, with_id(function(thread_id) api().delete_request(thread_id) end), "Delete pending request" },
		{ maps.cancel, with_id(function(thread_id) api().cancel({ thread_id = thread_id }) end), "Cancel" },
		{ maps.send, function() api().send_round() end, "Send round" },
		{ maps.recall, function() api().recall_round() end, "Recall round" },
		{ maps.close, function() M.close() end, "Close sidebar" },
	}
	for _, binding in ipairs(bindings) do
		if binding[1] and binding[1] ~= "" then
			vim.keymap.set("n", binding[1], binding[2], { buffer = buf, silent = true, nowait = true, desc = "Vantage: " .. binding[3] })
		end
	end
	return buf
end

function M.refresh()
	local buf = vim.fn.bufnr(NAME)
	if buf == -1 then
		return
	end
	local lines, ids = M.lines()
	rows = ids
	vim.bo[buf].modifiable = true
	vim.api.nvim_buf_set_lines(buf, 0, -1, false, lines)
	vim.bo[buf].modifiable = false
end

---The thread id on the cursor row of the sidebar.
---@return string?
function M.id_at_cursor()
	if vim.api.nvim_buf_get_name(0) ~= vim.fn.fnamemodify(NAME, ":p") and vim.api.nvim_buf_get_name(0) ~= NAME then
		return nil
	end
	return rows[vim.api.nvim_win_get_cursor(0)[1]]
end

function M.is_open()
	return win ~= nil and vim.api.nvim_win_is_valid(win)
end

function M.open()
	local buf = buffer()
	M.refresh()
	if M.is_open() then
		vim.api.nvim_set_current_win(win)
		return win
	end
	vim.cmd("botright vertical " .. tostring(config().sidebar_width or 40) .. "split")
	win = vim.api.nvim_get_current_win()
	vim.api.nvim_win_set_buf(win, buf)
	vim.wo[win].winfixwidth = true
	vim.wo[win].number = false
	vim.wo[win].relativenumber = false
	vim.wo[win].signcolumn = "no"
	vim.wo[win].wrap = false
	vim.wo[win].cursorline = true
	return win
end

function M.close()
	if M.is_open() then
		pcall(vim.api.nvim_win_close, win, true)
	end
	win = nil
end

---@return boolean open after toggling
function M.toggle()
	if M.is_open() then
		M.close()
		return false
	end
	M.open()
	return true
end

local group = vim.api.nvim_create_augroup("vantage_review_sidebar", { clear = true })
vim.api.nvim_create_autocmd("User", {
	group = group,
	pattern = "VantageReviewChanged",
	callback = function()
		M.refresh()
	end,
})

return M
