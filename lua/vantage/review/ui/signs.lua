-- Signs and a short end-of-line note on every anchored, unresolved thread.
local anchors = require("vantage.review.anchors")
local paths = require("vantage.paths")
local review = require("vantage.review")
local state = require("vantage.state")
local statuses = require("vantage.review.statuses")

local M = {}

local namespace = vim.api.nvim_create_namespace("vantage_review_signs")

local function sign_text()
	local config = state.config.review or {}
	return config.sign_text or "▍"
end

local function note(thread)
	local last = thread.messages[#thread.messages]
	local text = last and last.text or ""
	text = (vim.split(text, "\n", { plain = true })[1] or ""):sub(1, 60)
	return string.format("%s %s: %s", thread.id, thread.status, text)
end

---Draws the signs for one buffer from the current state.
---@param bufnr integer
function M.render(bufnr)
	if not vim.api.nvim_buf_is_valid(bufnr) or not vim.api.nvim_buf_is_loaded(bufnr) then
		return
	end
	vim.api.nvim_buf_clear_namespace(bufnr, namespace, 0, -1)
	local current = review.state()
	local root = review.connection().root
	if not current or not root or vim.bo[bufnr].buftype ~= "" then
		return
	end
	local path = paths.relative(root, vim.api.nvim_buf_get_name(bufnr))
	if not path then
		return
	end
	local count = vim.api.nvim_buf_line_count(bufnr)
	for _, thread in ipairs(current.threads) do
		local anchor = thread.anchor
		if anchor and anchor.path == path and anchor.side == "current" and not thread.resolved then
			local where = anchors.resolve(root, thread.id, anchor)
			if where.start_line <= count then
				local hl = statuses.highlight(thread.status)
				vim.api.nvim_buf_set_extmark(bufnr, namespace, where.start_line - 1, 0, {
					end_row = math.min(where.end_line, count) - 1,
					sign_text = sign_text(),
					sign_hl_group = hl,
					virt_text = { { (where.moved and "moved? " or "") .. note(thread), hl } },
					virt_text_pos = "eol",
				})
			end
		end
	end
end

function M.render_all()
	for _, bufnr in ipairs(vim.api.nvim_list_bufs()) do
		M.render(bufnr)
	end
end

---Thread marks in a buffer, sorted by line: `{ id, line }`.
---@param bufnr integer
---@return { id: string, line: integer }[]
function M.marks(bufnr)
	local current = review.state()
	local root = review.connection().root
	if not current or not root then
		return {}
	end
	local path = paths.relative(root, vim.api.nvim_buf_get_name(bufnr))
	local found = {}
	for _, thread in ipairs(current.threads) do
		local anchor = thread.anchor
		if path and anchor and anchor.path == path and anchor.side == "current" and not thread.resolved then
			local where = anchors.resolve(root, thread.id, anchor)
			table.insert(found, { id = thread.id, line = where.start_line, end_line = where.end_line })
		end
	end
	table.sort(found, function(a, b)
		return a.line < b.line
	end)
	return found
end

---The thread anchored on the cursor line of the current buffer.
---@return string? id
function M.at_cursor()
	local line = vim.api.nvim_win_get_cursor(0)[1]
	for _, mark in ipairs(M.marks(vim.api.nvim_get_current_buf())) do
		if line >= mark.line and line <= mark.end_line then
			return mark.id
		end
	end
	return nil
end

---Moves the cursor to the next (or previous) thread in this buffer.
---@param direction 1|-1
---@return boolean moved
function M.jump(direction)
	local line = vim.api.nvim_win_get_cursor(0)[1]
	local marks = M.marks(vim.api.nvim_get_current_buf())
	local target
	if direction > 0 then
		for _, mark in ipairs(marks) do
			if mark.line > line then
				target = mark
				break
			end
		end
	else
		for index = #marks, 1, -1 do
			if marks[index].line < line then
				target = marks[index]
				break
			end
		end
	end
	if not target then
		return false
	end
	vim.api.nvim_win_set_cursor(0, { target.line, 0 })
	return true
end

local group = vim.api.nvim_create_augroup("vantage_review_signs", { clear = true })
vim.api.nvim_create_autocmd("User", {
	group = group,
	pattern = "VantageReviewChanged",
	callback = function()
		M.render_all()
	end,
})
vim.api.nvim_create_autocmd({ "BufWinEnter", "BufReadPost" }, {
	group = group,
	callback = function(args)
		M.render(args.buf)
	end,
})

return M
