local M = {}

local last_buf = nil
local last_win = nil

local function close_last_float()
	if last_win and vim.api.nvim_win_is_valid(last_win) then
		vim.api.nvim_win_close(last_win, true)
	end
end

local function markdown_lines(markdown)
	local lines = vim.split(markdown or "", "\n", { plain = true })
	if #lines == 0 then
		return { "" }
	end
	return lines
end

function M.show_markdown(markdown)
	close_last_float()

	local lines = markdown_lines(markdown)
	local buf = vim.api.nvim_create_buf(false, true)
	vim.api.nvim_buf_set_option(buf, "bufhidden", "wipe")
	vim.api.nvim_buf_set_option(buf, "filetype", "markdown")
	vim.api.nvim_buf_set_option(buf, "swapfile", false)
	vim.api.nvim_buf_set_lines(buf, 0, -1, false, lines)

	local columns = vim.o.columns
	local rows = vim.o.lines
	local width = math.max(20, math.min(80, columns - 4))
	local height = math.max(1, math.min(#lines, rows - 6))
	local row = math.max(0, math.floor((rows - height) / 3))
	local col = math.max(0, math.floor((columns - width) / 2))

	local win = vim.api.nvim_open_win(buf, true, {
		relative = "editor",
		width = width,
		height = height,
		row = row,
		col = col,
		style = "minimal",
		border = "rounded",
	})

	vim.keymap.set("n", "q", function()
		if vim.api.nvim_win_is_valid(win) then
			vim.api.nvim_win_close(win, true)
		end
	end, { buffer = buf, silent = true })

	last_buf = buf
	last_win = win
	return buf, win
end

function M.last_float_buf()
	return last_buf
end

return M
