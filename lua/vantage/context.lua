local state = require("vantage.state")
local agent_context = require("vantage.agent_context")
local M = {}

local function cursor()
	local pos = vim.api.nvim_win_get_cursor(0)
	return { line = pos[1], character = pos[2] + 1 }
end

local function range_for_lines(start_line, end_line, lines)
	local last_line = lines[#lines] or ""
	return {
		startLine = start_line,
		startCharacter = 1,
		endLine = end_line,
		endCharacter = math.max(1, #last_line),
	}
end

function M.visible()
	local start_line = vim.fn.line("w0")
	local end_line = vim.fn.line("w$")
	local lines = vim.api.nvim_buf_get_lines(0, start_line - 1, end_line, false)
	local snapshot = agent_context.snapshot()

	return {
		workspaceRoot = snapshot.workspace_root,
		filePath = vim.api.nvim_buf_get_name(0),
		language = vim.bo.filetype ~= "" and vim.bo.filetype or "text",
		text = table.concat(lines, "\n"),
		cursor = cursor(),
		visibleRange = range_for_lines(start_line, end_line, lines),
		lens = state.get_lens(),
		agentContext = snapshot.context,
	}
end

function M.buffer()
	local line_count = vim.api.nvim_buf_line_count(0)
	local lines = vim.api.nvim_buf_get_lines(0, 0, line_count, false)
	local snapshot = agent_context.snapshot()

	return {
		workspaceRoot = snapshot.workspace_root,
		filePath = vim.api.nvim_buf_get_name(0),
		language = vim.bo.filetype ~= "" and vim.bo.filetype or "text",
		text = table.concat(lines, "\n"),
		cursor = cursor(),
		visibleRange = range_for_lines(1, math.max(1, line_count), lines),
		lens = state.get_lens(),
		agentContext = snapshot.context,
	}
end

function M.line_range(start_line, end_line)
	local line_count = vim.api.nvim_buf_line_count(0)
	local first_line = math.max(1, math.min(start_line, end_line))
	local last_line = math.min(line_count, math.max(start_line, end_line))
	local lines = vim.api.nvim_buf_get_lines(0, first_line - 1, last_line, false)
	local text = table.concat(lines, "\n")
	local range = range_for_lines(first_line, last_line, lines)
	local snapshot = agent_context.snapshot()

	return {
		workspaceRoot = snapshot.workspace_root,
		filePath = vim.api.nvim_buf_get_name(0),
		language = vim.bo.filetype ~= "" and vim.bo.filetype or "text",
		text = text,
		cursor = cursor(),
		visibleRange = range,
		range = range,
		selectedText = text,
		lens = state.get_lens(),
		agentContext = snapshot.context,
	}
end

function M.current_line()
	local pos = cursor()
	return M.line_range(pos.line, pos.line)
end

return M
