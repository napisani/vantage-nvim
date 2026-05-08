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

local function normalize_range(start_line, start_character, end_line, end_character)
	if start_line > end_line or (start_line == end_line and start_character > end_character) then
		return end_line, end_character, start_line, start_character
	end

	return start_line, start_character, end_line, end_character
end

local function selected_text(lines, start_character, end_character)
	if #lines == 0 then
		return ""
	end

	if #lines == 1 then
		return string.sub(lines[1], start_character + 1, end_character)
	end

	lines[1] = string.sub(lines[1], start_character + 1)
	lines[#lines] = string.sub(lines[#lines], 1, end_character)
	return table.concat(lines, "\n")
end

function M.visible()
	local start_line = vim.fn.line("w0") - 1
	local end_line = vim.fn.line("w$") - 1
	local lines = vim.api.nvim_buf_get_lines(0, start_line, end_line + 1, false)

	return {
		filePath = vim.api.nvim_buf_get_name(0),
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
	local start_character = start_pos[3] - 1
	local end_character = end_pos[3]

	start_line, start_character, end_line, end_character =
		normalize_range(start_line, start_character, end_line, end_character)

	local lines = vim.api.nvim_buf_get_lines(0, start_line, end_line + 1, false)
	local visible = M.visible()

	visible.range = {
		startLine = start_line,
		startCharacter = start_character,
		endLine = end_line,
		endCharacter = end_character,
	}
	visible.selectedText = selected_text(lines, start_character, end_character)
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
