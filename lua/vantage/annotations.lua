local M = {}

local namespace = vim.api.nvim_create_namespace("vantage_annotations")

function M.is_enabled(bufnr)
	return #M.current_marks(bufnr or 0) > 0
end

function M.clear(bufnr)
	vim.api.nvim_buf_clear_namespace(bufnr or 0, namespace, 0, -1)
end

local function mark_position(annotation)
	local line = 0
	local character = 0
	if annotation.range then
		if annotation.range.startLine then
			line = annotation.range.startLine
		end
		if annotation.range.startCharacter then
			character = annotation.range.startCharacter
		end
	end
	return line, character
end

local function remove_existing_at(bufnr, line, character)
	for _, mark in ipairs(vim.api.nvim_buf_get_extmarks(bufnr, namespace, 0, -1, {})) do
		if mark[2] == line and mark[3] == character then
			vim.api.nvim_buf_del_extmark(bufnr, namespace, mark[1])
		end
	end
end

function M.render(bufnr, annotations)
	bufnr = bufnr or 0
	local line_count = vim.api.nvim_buf_line_count(bufnr)
	local rendered = 0

	for _, annotation in ipairs(annotations or {}) do
		local line, character = mark_position(annotation)

		if type(line) == "number" and line >= 0 and line < line_count and annotation.text and annotation.text ~= "" then
			remove_existing_at(bufnr, line, character)
			vim.api.nvim_buf_set_extmark(bufnr, namespace, line, character, {
				virt_text = { { annotation.text, "Comment" } },
			})
			rendered = rendered + 1
		end
	end

	return rendered
end

function M.current_marks(bufnr)
	return vim.api.nvim_buf_get_extmarks(bufnr or 0, namespace, 0, -1, { details = true })
end

return M
