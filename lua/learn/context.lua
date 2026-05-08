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

local function utf8_char_end(line, start_character)
	local first_byte = string.byte(line, start_character + 1)
	if first_byte == nil then
		return start_character
	end

	local length = 1
	if first_byte >= 0xF0 then
		length = 4
	elseif first_byte >= 0xE0 then
		length = 3
	elseif first_byte >= 0xC0 then
		length = 2
	end

	return math.min(start_character + length, #line)
end

local function mark_range(mark)
	local line = mark[2] - 1
	local start_character = mark[3] - 1
	local line_text = vim.api.nvim_buf_get_lines(0, line, line + 1, false)[1] or ""

	return {
		line = line,
		startCharacter = start_character,
		endCharacter = utf8_char_end(line_text, start_character),
	}
end

local function normalize_range(start_mark, end_mark)
	if
		start_mark.line > end_mark.line
		or (start_mark.line == end_mark.line and start_mark.startCharacter > end_mark.startCharacter)
	then
		return end_mark.line, end_mark.startCharacter, start_mark.line, start_mark.endCharacter
	end

	return start_mark.line, start_mark.startCharacter, end_mark.line, end_mark.endCharacter
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
	local start_mark = mark_range(vim.fn.getpos("'<"))
	local end_mark = mark_range(vim.fn.getpos("'>"))
	local start_line, start_character, end_line, end_character = normalize_range(start_mark, end_mark)

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
