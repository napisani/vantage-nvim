-- One thread as a read-only buffer: a peek float at the cursor, or a bottom
-- split named vantage://thread/<id> that stays while you move around the code.
local review = require("vantage.review")
local statuses = require("vantage.review.statuses")
local state = require("vantage.state")

local M = {}

local split_win = nil
local peek_win = nil

local KIND = { question = "question", change = "change request", walkthrough = "walkthrough request", diffTour = "diff tour request" }

local function config()
	return state.config.review or {}
end

local function keymaps()
	local defaults = { reply = "r", resolve = "x", quickfix = "Q", cancel = "C", close = "q", jump = "gd" }
	return vim.tbl_extend("force", defaults, (config().keymaps or {}).thread or {})
end

local function where(anchor)
	if not anchor then
		return "the workspace as a whole"
	end
	local span = anchor.endLine > anchor.startLine and (anchor.startLine .. "-" .. anchor.endLine) or tostring(anchor.startLine)
	return string.format("%s:%s (%s)", anchor.path, span, anchor.side == "base" and "base side" or "current code")
end

local function clock(at)
	return (at or ""):match("T(%d%d:%d%d)") or ""
end

---The thread as markdown lines.
---@param thread table
---@return string[]
function M.lines(thread)
	local lines = {
		string.format("# %s · %s · %s%s", thread.id, KIND[thread.kind] or thread.kind, thread.status, thread.resolved and " · resolved" or ""),
		where(thread.anchor),
	}
	if thread.lens then
		table.insert(lines, "lens: " .. thread.lens)
	end
	if thread.anchor and thread.anchor.text ~= "" then
		table.insert(lines, "")
		for _, line in ipairs(vim.split(thread.anchor.text, "\n", { plain = true })) do
			table.insert(lines, "> " .. line)
		end
	end
	for _, message in ipairs(thread.messages) do
		table.insert(lines, "")
		table.insert(lines, string.format("## %s · %s", message.role == "user" and "you" or "agent", clock(message.at)))
		vim.list_extend(lines, vim.split(message.text, "\n", { plain = true }))
		if message.refs and #message.refs > 0 then
			table.insert(lines, "")
			for _, ref in ipairs(message.refs) do
				local span = ref.endLine > ref.startLine and (ref.startLine .. "-" .. ref.endLine) or tostring(ref.startLine)
				table.insert(lines, string.format("- %s:%s%s", ref.path, span, ref.note and (" · " .. ref.note) or ""))
			end
		end
	end
	if statuses.with_agent(thread.status) then
		table.insert(lines, "")
		table.insert(lines, thread.status == "working" and "_the agent is working on it_" or "_waiting for the agent_")
	end
	return lines
end

local function fill(buf, thread)
	vim.bo[buf].modifiable = true
	vim.api.nvim_buf_set_lines(buf, 0, -1, false, M.lines(thread))
	vim.bo[buf].modifiable = false
	vim.bo[buf].modified = false
end

local function thread_buffer(id)
	local name = "vantage://thread/" .. id
	local buf = vim.fn.bufnr(name)
	if buf == -1 then
		buf = vim.api.nvim_create_buf(true, true)
		vim.api.nvim_buf_set_name(buf, name)
		vim.bo[buf].buftype = "nofile"
		vim.bo[buf].bufhidden = "hide"
		vim.bo[buf].swapfile = false
		vim.bo[buf].filetype = "markdown"
		vim.b[buf].vantage_thread_id = id
		M.attach_keymaps(buf, id)
	end
	return buf
end

---Binds the thread keys on a buffer that shows thread `id`.
---@param buf integer
---@param id string
function M.attach_keymaps(buf, id)
	local maps = keymaps()
	local function api()
		return require("vantage")
	end
	local bindings = {
		{ maps.reply, function() api().reply({ thread_id = id }) end, "Reply to the thread (edit when pending)" },
		{ maps.resolve, function() api().resolve({ thread_id = id }) end, "Toggle resolved" },
		{ maps.quickfix, function() api().thread_refs_to_quickfix(id) end, "Answer locations to quickfix" },
		{ maps.cancel, function() api().cancel({ thread_id = id }) end, "Cancel the request" },
		{ maps.jump, function() M.jump_to_anchor(id) end, "Go to the anchored code" },
		{ maps.close, function() M.close() end, "Close the thread view" },
	}
	for _, binding in ipairs(bindings) do
		if binding[1] and binding[1] ~= "" then
			vim.keymap.set("n", binding[1], binding[2], { buffer = buf, silent = true, nowait = true, desc = "Vantage: " .. binding[3] })
		end
	end
end

local function code_window()
	for _, win in ipairs(vim.api.nvim_tabpage_list_wins(0)) do
		local buf = vim.api.nvim_win_get_buf(win)
		if vim.bo[buf].buftype == "" and vim.api.nvim_win_get_config(win).relative == "" then
			return win
		end
	end
	return nil
end

---Shows the thread's anchored code in a code window, opening the file if needed.
---@param id string
---@param keep_focus boolean? stay in the current window
function M.jump_to_anchor(id, keep_focus)
	local thread = review.thread(id)
	if not thread or not thread.anchor or thread.anchor.side == "base" then
		return
	end
	local root = review.connection().root
	local where = require("vantage.review.anchors").resolve(root, id, thread.anchor)
	local from = vim.api.nvim_get_current_win()
	local win = code_window()
	if not win then
		vim.cmd("aboveleft split")
		win = vim.api.nvim_get_current_win()
	end
	vim.api.nvim_set_current_win(win)
	vim.cmd("edit " .. vim.fn.fnameescape(root .. "/" .. thread.anchor.path))
	local count = vim.api.nvim_buf_line_count(0)
	vim.api.nvim_win_set_cursor(win, { math.min(where.start_line, count), 0 })
	vim.cmd("normal! zz")
	if keep_focus and vim.api.nvim_win_is_valid(from) then
		vim.api.nvim_set_current_win(from)
	end
end

---Opens (or switches) the bottom thread split to thread `id`.
---@param id string
---@return integer? buf
function M.open(id)
	local thread = review.thread(id)
	if not thread then
		vim.notify("Vantage: no thread " .. tostring(id), vim.log.levels.WARN)
		return nil
	end
	local buf = thread_buffer(id)
	fill(buf, thread)
	local from = vim.api.nvim_get_current_win()
	if split_win and vim.api.nvim_win_is_valid(split_win) then
		vim.api.nvim_win_set_buf(split_win, buf)
	else
		vim.cmd("botright " .. tostring(config().thread_split_height or 15) .. "split")
		split_win = vim.api.nvim_get_current_win()
		vim.api.nvim_win_set_buf(split_win, buf)
		vim.wo[split_win].winfixheight = true
		vim.wo[split_win].wrap = true
		vim.wo[split_win].linebreak = true
		if vim.api.nvim_win_is_valid(from) then
			vim.api.nvim_set_current_win(from)
		end
	end
	return buf
end

function M.close()
	if split_win and vim.api.nvim_win_is_valid(split_win) then
		pcall(vim.api.nvim_win_close, split_win, true)
	end
	split_win = nil
end

---The thread shown in the split, if open.
---@return string?
function M.open_id()
	if split_win and vim.api.nvim_win_is_valid(split_win) then
		return vim.b[vim.api.nvim_win_get_buf(split_win)].vantage_thread_id
	end
	return nil
end

local function close_peek()
	if peek_win and vim.api.nvim_win_is_valid(peek_win) then
		pcall(vim.api.nvim_win_close, peek_win, true)
	end
	peek_win = nil
end

---A read-only float at the cursor; closes when the cursor moves.
---@param id string
---@return integer? win
function M.peek(id)
	local thread = review.thread(id)
	if not thread then
		return nil
	end
	close_peek()
	local lines = M.lines(thread)
	local buf = vim.api.nvim_create_buf(false, true)
	vim.bo[buf].bufhidden = "wipe"
	vim.api.nvim_buf_set_lines(buf, 0, -1, false, lines)
	vim.bo[buf].modifiable = false
	vim.bo[buf].filetype = "markdown"
	local width = math.min(math.max(40, math.floor(vim.o.columns * 0.6)), vim.o.columns - 4)
	local height = math.min(#lines, math.max(3, math.floor(vim.o.lines * 0.4)))
	peek_win = vim.api.nvim_open_win(buf, false, { relative = "cursor", row = 1, col = 0, width = width, height = height, style = "minimal", border = "rounded" })
	vim.wo[peek_win].wrap = true
	vim.wo[peek_win].linebreak = true
	vim.api.nvim_create_autocmd({ "CursorMoved", "BufLeave", "InsertEnter" }, {
		buffer = vim.api.nvim_get_current_buf(),
		once = true,
		callback = close_peek,
	})
	return peek_win
end

local group = vim.api.nvim_create_augroup("vantage_review_thread", { clear = true })
vim.api.nvim_create_autocmd("User", {
	group = group,
	pattern = "VantageReviewChanged",
	callback = function()
		for _, buf in ipairs(vim.api.nvim_list_bufs()) do
			local id = vim.api.nvim_buf_is_valid(buf) and vim.b[buf].vantage_thread_id
			if id then
				local thread = review.thread(id)
				if thread then
					fill(buf, thread)
				end
			end
		end
	end,
})

return M
