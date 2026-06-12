local M = {}

local function replacement_lines(text)
	local normalized = (text or ""):gsub("\r\n", "\n"):gsub("\r", "\n")
	local lines = vim.split(normalized, "\n", { plain = true })
	if #lines > 1 and lines[#lines] == "" then
		table.remove(lines, #lines)
	end
	return lines
end

function M.apply(bufnr, range, replacement_text)
	if type(range) ~= "table" then
		return nil, "Missing edit range."
	end
	if type(replacement_text) ~= "string" or replacement_text:match("%S") == nil then
		return nil, "Agent returned an empty edit."
	end

	local line_count = vim.api.nvim_buf_line_count(bufnr)
	local start_line = range.startLine
	local end_line = range.endLine
	if type(start_line) ~= "number" or type(end_line) ~= "number" or start_line < 1 or end_line < start_line then
		return nil, "Invalid edit range."
	end
	if start_line > line_count then
		return nil, "Edit range starts outside the buffer."
	end

	local start_index = start_line - 1
	local end_index = math.min(end_line, line_count)
	local lines = replacement_lines(replacement_text)
	vim.api.nvim_buf_set_lines(bufnr, start_index, end_index, false, lines)
	return {
		replaced_start_line = start_line,
		replaced_end_line = end_line,
		line_count = #lines,
	}
end

return M
