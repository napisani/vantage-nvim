local M = {}

local namespace = vim.api.nvim_create_namespace("learn_annotations")
local enabled = false

function M.is_enabled()
	return enabled
end

function M.clear(bufnr)
	vim.api.nvim_buf_clear_namespace(bufnr or 0, namespace, 0, -1)
	enabled = false
end

function M.render(bufnr, annotations)
	bufnr = bufnr or 0
	vim.api.nvim_buf_clear_namespace(bufnr, namespace, 0, -1)

	for _, annotation in ipairs(annotations or {}) do
		local line = 0
		if annotation.range and annotation.range.startLine then
			line = annotation.range.startLine
		end

		vim.api.nvim_buf_set_extmark(bufnr, namespace, line, 0, {
			virt_text = { { annotation.message or "", "Comment" } },
			virt_text_pos = "eol",
		})
	end

	enabled = true
end

function M.current_marks(bufnr)
	return vim.api.nvim_buf_get_extmarks(bufnr or 0, namespace, 0, -1, {})
end

return M
