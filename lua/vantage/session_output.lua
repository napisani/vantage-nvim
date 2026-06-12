local backend = require("vantage.backend")
local context = require("vantage.context")
local state = require("vantage.state")
local ui = require("vantage.ui")

local M = {}

local current = nil

local function as_list(value)
	if type(value) == "table" then
		return value
	end
	if type(value) == "string" and value ~= "" then
		return { value }
	end
	return {}
end

local function config()
	return ((state.config.ui or {}).session_output or {})
end

local function keymaps()
	local maps = config().keymaps or {}
	return {
		close = as_list(maps.close or "q"),
		toggle_raw = as_list(maps.toggle_raw or "r"),
	}
end

local function close_view(view)
	if view.timer then
		view.timer:stop()
		view.timer:close()
		view.timer = nil
	end
	if view.win and vim.api.nvim_win_is_valid(view.win) then
		vim.api.nvim_win_close(view.win, true)
	end
	if current == view then
		current = nil
	end
end

local function at_bottom(view)
	if not view.win or not vim.api.nvim_win_is_valid(view.win) or not view.buf or not vim.api.nvim_buf_is_valid(view.buf) then
		return false
	end
	local cursor = vim.api.nvim_win_get_cursor(view.win)
	local line_count = vim.api.nvim_buf_line_count(view.buf)
	return cursor[1] >= math.max(1, line_count - 3)
end

local function jump_bottom(view)
	if view.win and vim.api.nvim_win_is_valid(view.win) and view.buf and vim.api.nvim_buf_is_valid(view.buf) then
		local line_count = vim.api.nvim_buf_line_count(view.buf)
		vim.api.nvim_win_set_cursor(view.win, { math.max(1, line_count), 0 })
	end
end

local function set_lines(view, markdown, follow)
	if not view.buf or not vim.api.nvim_buf_is_valid(view.buf) then
		return
	end
	local lines = vim.split(markdown or "", "\n", { plain = true })
	if #lines == 0 then
		lines = { "" }
	end
	vim.api.nvim_buf_set_option(view.buf, "modifiable", true)
	vim.api.nvim_buf_set_lines(view.buf, 0, -1, false, lines)
	vim.api.nvim_buf_set_option(view.buf, "modifiable", false)
	if follow then
		jump_bottom(view)
	end
end

local function request(view)
	local params = context.current_line()
	params.raw = view.raw
	backend.request("agentSessionOutput", params, function(response)
		if current ~= view then
			return
		end
		local markdown
		if not response or not response.ok then
			local message = response and response.error and response.error.message or "Unknown backend error."
			markdown = "## Error\n\n" .. tostring(message)
		elseif response.result and response.result.kind == "explanation" then
			markdown = response.result.markdown or ""
		else
			markdown = "## Error\n\nBackend returned an invalid session output response."
		end
		local follow = not view.loaded_once or at_bottom(view)
		set_lines(view, markdown, follow)
		view.loaded_once = true
	end)
end

local function start_timer(view)
	local refresh_ms = config().refresh_ms or 750
	view.timer = vim.loop.new_timer()
	view.timer:start(0, refresh_ms, function()
		vim.schedule(function()
			if current ~= view or not view.win or not vim.api.nvim_win_is_valid(view.win) then
				close_view(view)
				return
			end
			request(view)
		end)
	end)
end

function M.open()
	if current and current.win and vim.api.nvim_win_is_valid(current.win) then
		vim.api.nvim_set_current_win(current.win)
		jump_bottom(current)
		return current.buf, current.win
	end

	local buf = vim.api.nvim_create_buf(false, true)
	vim.api.nvim_buf_set_option(buf, "bufhidden", "wipe")
	vim.api.nvim_buf_set_option(buf, "filetype", "markdown")
	vim.api.nvim_buf_set_option(buf, "swapfile", false)
	vim.api.nvim_buf_set_lines(buf, 0, -1, false, { "Loading Vantage session output..." })
	vim.api.nvim_buf_set_option(buf, "modifiable", false)
	local win = ui.open_float(buf, { line_count = 20 })
	vim.api.nvim_win_set_option(win, "wrap", true)
	vim.api.nvim_win_set_option(win, "linebreak", true)
	vim.api.nvim_win_set_option(win, "breakindent", true)

	local view = { buf = buf, win = win, raw = false, loaded_once = false, timer = nil }
	current = view

	vim.api.nvim_create_autocmd("BufWipeout", {
		buffer = buf,
		once = true,
		callback = function()
			close_view(view)
		end,
	})

	local maps = keymaps()
	for _, lhs in ipairs(maps.close) do
		vim.keymap.set("n", lhs, function()
			close_view(view)
		end, { buffer = buf, silent = true, desc = "Close Vantage session output" })
	end
	for _, lhs in ipairs(maps.toggle_raw) do
		vim.keymap.set("n", lhs, function()
			view.raw = not view.raw
			request(view)
		end, { buffer = buf, silent = true, desc = "Toggle raw Vantage session output" })
	end

	start_timer(view)
	return buf, win
end

return M
