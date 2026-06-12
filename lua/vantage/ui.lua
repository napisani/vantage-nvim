local state = require("vantage.state")

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

local function dimension(value, total, fallback, minimum, padding)
	minimum = minimum or 1
	padding = padding or 0
	if type(value) == "number" then
		if value > 0 and value <= 1 then
			return math.max(minimum, math.floor(total * value))
		end
		return math.max(minimum, math.min(math.floor(value), total - padding))
	end
	if type(fallback) == "number" and fallback > 0 and fallback <= 1 then
		return math.max(minimum, math.floor(total * fallback))
	end
	return math.max(minimum, math.min(fallback or total, total - padding))
end

local function output_config()
	local ui = state.config.ui or {}
	return ui.output or {}
end

function M.float_options(opts)
	opts = opts or {}
	local config = vim.tbl_deep_extend("force", output_config(), opts.config or {})
	local columns = vim.o.columns
	local rows = vim.o.lines
	local width = dimension(opts.width or config.width, columns, 0.82, 20, 4)
	local max_height = math.max(1, rows - 6)
	local desired_height = opts.height or config.height
	local height = dimension(desired_height, rows, 0.72, 1, 6)
	if opts.line_count then
		height = math.min(height, math.max(1, opts.line_count))
	end
	height = math.min(height, max_height)
	local row = math.max(0, math.floor((rows - height) / 3))
	local col = math.max(0, math.floor((columns - width) / 2))
	return {
		relative = "editor",
		width = width,
		height = height,
		row = row,
		col = col,
		style = "minimal",
		border = config.border or "rounded",
	}
end

function M.open_float(buf, opts)
	local win = vim.api.nvim_open_win(buf, opts and opts.enter ~= false, M.float_options(opts))
	last_buf = buf
	last_win = win
	return win
end

local function apply_readable_window_options(win, wrap)
	vim.api.nvim_win_set_option(win, "wrap", wrap ~= false)
	vim.api.nvim_win_set_option(win, "linebreak", true)
	vim.api.nvim_win_set_option(win, "breakindent", true)
end

function M.show_markdown(markdown, opts)
	close_last_float()

	local lines = markdown_lines(markdown)
	local buf = vim.api.nvim_create_buf(false, true)
	vim.api.nvim_buf_set_option(buf, "bufhidden", "wipe")
	vim.api.nvim_buf_set_option(buf, "filetype", "markdown")
	vim.api.nvim_buf_set_option(buf, "swapfile", false)
	vim.api.nvim_buf_set_lines(buf, 0, -1, false, lines)
	vim.api.nvim_buf_set_option(buf, "modifiable", false)

	local config = output_config()
	local win = M.open_float(buf, vim.tbl_extend("force", opts or {}, { line_count = #lines }))
	apply_readable_window_options(win, config.wrap)

	vim.keymap.set("n", "q", function()
		if vim.api.nvim_win_is_valid(win) then
			vim.api.nvim_win_close(win, true)
		end
	end, { buffer = buf, silent = true })

	return buf, win
end

function M.last_float_buf()
	return last_buf
end

function M.last_float_win()
	return last_win
end

return M
