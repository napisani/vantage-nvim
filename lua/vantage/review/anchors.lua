-- Where a thread's anchor is now. Order: the anchor as stored (the agent's
-- report replaces it), an extmark that followed edits in an open buffer, the
-- quoted text found near the old line, else the old lines marked as moved.
local paths = require("vantage.paths")

local M = {}

local namespace = vim.api.nvim_create_namespace("vantage_review_anchor")
local SEARCH_RADIUS = 200

-- key -> { bufnr, mark } ; key changes whenever the stored anchor changes.
local tracked = {}

local function key_of(id, anchor)
	return table.concat({ id, anchor.path, anchor.startLine, anchor.endLine, vim.fn.sha256(anchor.text or "") }, ":")
end

local function first_line(text)
	return vim.trim(vim.split(text or "", "\n", { plain = true })[1] or "")
end

---The loaded buffer for a workspace-relative path, if any.
---@param root string
---@param path string
---@return integer?
function M.buffer_for(root, path)
	local target = paths.normalize(paths.resolve(root, path))
	for _, bufnr in ipairs(vim.api.nvim_list_bufs()) do
		if vim.api.nvim_buf_is_loaded(bufnr) and paths.normalize(vim.api.nvim_buf_get_name(bufnr)) == target then
			return bufnr
		end
	end
	return nil
end

local function find_text(bufnr, anchor)
	local wanted = first_line(anchor.text)
	if wanted == "" then
		return nil
	end
	local count = vim.api.nvim_buf_line_count(bufnr)
	local from = math.max(1, anchor.startLine - SEARCH_RADIUS)
	local to = math.min(count, anchor.startLine + SEARCH_RADIUS)
	local lines = vim.api.nvim_buf_get_lines(bufnr, from - 1, to, false)
	local best, best_distance
	for index, line in ipairs(lines) do
		if vim.trim(line) == wanted then
			local lnum = from + index - 1
			local distance = math.abs(lnum - anchor.startLine)
			if not best or distance < best_distance then
				best, best_distance = lnum, distance
			end
		end
	end
	return best
end

local function line_matches(bufnr, lnum, anchor)
	local wanted = first_line(anchor.text)
	if wanted == "" then
		return true
	end
	local line = vim.api.nvim_buf_get_lines(bufnr, lnum - 1, lnum, false)[1]
	return line ~= nil and vim.trim(line) == wanted
end

local function track(key, bufnr, start_line, end_line)
	local count = vim.api.nvim_buf_line_count(bufnr)
	local start_row = math.min(start_line, count) - 1
	local end_row = math.min(end_line, count) - 1
	local mark = vim.api.nvim_buf_set_extmark(bufnr, namespace, start_row, 0, { end_row = end_row, right_gravity = false, end_right_gravity = true })
	tracked[key] = { bufnr = bufnr, mark = mark }
end

local function from_mark(key)
	local entry = tracked[key]
	if not entry or not vim.api.nvim_buf_is_valid(entry.bufnr) then
		tracked[key] = nil
		return nil
	end
	local pos = vim.api.nvim_buf_get_extmark_by_id(entry.bufnr, namespace, entry.mark, { details = true })
	if not pos or not pos[1] then
		tracked[key] = nil
		return nil
	end
	local end_row = pos[3] and pos[3].end_row or pos[1]
	return entry.bufnr, pos[1] + 1, end_row + 1
end

---@class VantageResolvedAnchor
---@field path string
---@field start_line integer
---@field end_line integer
---@field bufnr integer? the loaded buffer holding the lines, when there is one
---@field moved boolean the quoted text was not found; the lines are a guess

---@param root string
---@param id string thread id
---@param anchor table the stored anchor
---@return VantageResolvedAnchor
function M.resolve(root, id, anchor)
	local result = { path = anchor.path, start_line = anchor.startLine, end_line = anchor.endLine, moved = false }
	if anchor.side == "base" then
		return result
	end
	local key = key_of(id, anchor)
	local bufnr, start_line, end_line = from_mark(key)
	if bufnr then
		result.bufnr, result.start_line, result.end_line = bufnr, start_line, end_line
		return result
	end
	bufnr = M.buffer_for(root, anchor.path)
	if not bufnr then
		return result
	end
	result.bufnr = bufnr
	local span = anchor.endLine - anchor.startLine
	if not line_matches(bufnr, anchor.startLine, anchor) then
		local found = find_text(bufnr, anchor)
		if found then
			result.start_line, result.end_line = found, found + span
		else
			result.moved = true
		end
	end
	if not result.moved then
		track(key, bufnr, result.start_line, result.end_line)
	end
	return result
end

---Drops extmarks in a buffer whose text was replaced from disk, so the next
---resolve searches the quoted text again.
---@param bufnr integer
function M.forget_buffer(bufnr)
	for key, entry in pairs(tracked) do
		if entry.bufnr == bufnr then
			tracked[key] = nil
		end
	end
	if vim.api.nvim_buf_is_valid(bufnr) then
		vim.api.nvim_buf_clear_namespace(bufnr, namespace, 0, -1)
	end
end

local function diffview_side(bufnr)
	local ok, lib = pcall(require, "diffview.lib")
	local view = ok and lib.get_current_view and lib.get_current_view() or nil
	local layout = view and view.cur_layout
	if not layout or not layout.a or not layout.a.file then
		return nil
	end
	if layout.a.file.bufnr == bufnr then
		return "base", layout.a.file.path
	end
	if layout.b and layout.b.file and layout.b.file.bufnr == bufnr then
		return "current", layout.b.file.path
	end
	return nil
end

---An anchor for lines of the current buffer, or nil when the buffer is not a
---file in the workspace.
---@param params table context params (workspaceRoot, filePath, range)
---@return table? anchor
function M.from_context(params)
	local range = params.range
	if not range then
		return nil
	end
	local bufnr = vim.api.nvim_get_current_buf()
	local side, path = diffview_side(bufnr)
	if not path then
		path = paths.relative(params.workspaceRoot, params.filePath or "")
		side = "current"
	end
	if not path then
		return nil
	end
	return {
		path = path,
		startLine = range.startLine,
		endLine = range.endLine,
		side = side,
		text = params.selectedText or "",
	}
end

local group = vim.api.nvim_create_augroup("vantage_review_anchors", { clear = true })
vim.api.nvim_create_autocmd("BufReadPost", {
	group = group,
	callback = function(args)
		M.forget_buffer(args.buf)
	end,
})

return M
