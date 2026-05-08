local state = require("learn.state")
local M = {}

local function cursor()
	local pos = vim.api.nvim_win_get_cursor(0)
	return { line = pos[1] - 1, character = pos[2] }
end

local function range_for_lines(start_line, end_line, lines)
	local last_line = lines[#lines] or ""
	return {
		startLine = start_line,
		startCharacter = 0,
		endLine = end_line,
		endCharacter = #last_line,
	}
end

function M.visible()
	local start_line = vim.fn.line("w0") - 1
	local end_line = vim.fn.line("w$") - 1
	local lines = vim.api.nvim_buf_get_lines(0, start_line, end_line + 1, false)

	return {
		filePath = vim.fn.bufname(0),
		language = vim.bo.filetype ~= "" and vim.bo.filetype or "text",
		text = table.concat(lines, "\n"),
		cursor = cursor(),
		visibleRange = range_for_lines(start_line, end_line, lines),
		lens = state.get_lens(),
	}
end

function M.selection()
	local start_pos = vim.fn.getpos("'<")
	local end_pos = vim.fn.getpos("'>")
	local start_line = start_pos[2] - 1
	local end_line = end_pos[2] - 1
	local lines = vim.api.nvim_buf_get_lines(0, start_line, end_line + 1, false)
	local selected = table.concat(lines, "\n")
	local visible = M.visible()

	visible.range = range_for_lines(start_line, end_line, lines)
	visible.selectedText = selected
	return visible
end

function M.current_line_as_selection()
	local line = vim.api.nvim_get_current_line()
	local pos = cursor()
	local visible = M.visible()

	visible.range = {
		startLine = pos.line,
		startCharacter = 0,
		endLine = pos.line,
		endCharacter = #line,
	}
	visible.selectedText = line
	return visible
end

return M
