local M = {}

local function read_float_text()
	local float_buf = require("vantage.ui").last_float_buf()
	if not float_buf or not vim.api.nvim_buf_is_valid(float_buf) then
		return nil
	end

	return table.concat(vim.api.nvim_buf_get_lines(float_buf, 0, -1, false), "\n")
end

local function annotation_texts(marks)
	local texts = {}
	for _, mark in ipairs(marks) do
		local details = mark[4] or {}
		local virt_text = details.virt_text or {}
		for _, chunk in ipairs(virt_text) do
			table.insert(texts, chunk[1])
		end
	end
	return texts
end

local function visible_mark_count(marks)
	local start_line = vim.fn.line("w0") - 1
	local end_line = vim.fn.line("w$") - 1
	local count = 0

	for _, mark in ipairs(marks) do
		local line = mark[2]
		if line >= start_line and line <= end_line then
			count = count + 1
		end
	end

	return count
end

local function sample_buffer_lines()
	local lines = {}
	for index = 1, 30 do
		table.insert(lines, "-- prefix line " .. tostring(index))
	end

	local code_start_line = #lines
	vim.list_extend(lines, {
		"local total = 0",
		"for index = 1, 3 do",
		"  total = total + index",
		"end",
		"print(total)",
	})

	for index = 1, 40 do
		table.insert(lines, "-- tail line " .. tostring(index))
	end

	return lines, code_start_line
end

local function write_artifact(artifact)
	local path = vim.g.vantage_e2e_artifact_path
	if not path or path == "" then
		return nil
	end

	vim.fn.mkdir(vim.fn.fnamemodify(path, ":h"), "p")
	vim.fn.writefile({ vim.json.encode(artifact) }, path)
	return path
end

local function fail(message)
	vim.api.nvim_err_writeln(message)
	vim.cmd("silent! bufdo setlocal nomodified")
	vim.cmd("cquit")
end

local function wait_budget_ms()
	local value = tonumber(vim.g.vantage_e2e_wait_ms or "")
	if value and value > 0 then
		return value
	end

	return 5000
end

function M.run()
	local annotations = require("vantage.annotations")
	local state = require("vantage.state")
	local target_buf = vim.api.nvim_get_current_buf()
	local wait_ms = wait_budget_ms()
	local lines, code_start_line = sample_buffer_lines()

	vim.bo.filetype = "lua"
	vim.api.nvim_buf_set_name(target_buf, vim.fn.getcwd() .. "/nvim/tests/e2e-sample.lua")
	vim.api.nvim_buf_set_lines(target_buf, 0, -1, false, lines)
	vim.api.nvim_win_set_cursor(0, { code_start_line + 1, 0 })
	vim.cmd("normal! zt")

	vim.cmd("VantageAnnotate")
	vim.wait(wait_ms, function()
		return #annotations.current_marks(target_buf) > 0 or read_float_text() ~= nil
	end, 50)

	local marks = annotations.current_marks(target_buf)
	local visible_marks = visible_mark_count(marks)
	local artifact = {
		backend = state.config.backend,
		filetype = vim.bo[target_buf].filetype,
		buffer = vim.api.nvim_buf_get_lines(target_buf, 0, -1, false),
		visibleStartLine = vim.fn.line("w0") - 1,
		visibleEndLine = vim.fn.line("w$") - 1,
		markCount = #marks,
		visibleMarkCount = visible_marks,
		annotationTexts = annotation_texts(marks),
		waitMs = wait_ms,
		floatText = read_float_text(),
	}
	local artifact_path = write_artifact(artifact)

	if #marks == 0 then
		fail("expected VantageAnnotate to render annotation extmarks; artifact: " .. tostring(artifact_path))
	end

	if visible_marks == 0 then
		fail("expected VantageAnnotate to render annotation extmarks in the visible window; artifact: " .. tostring(artifact_path))
	end

	local texts = annotation_texts(marks)
	if #texts == 0 then
		fail("expected annotation extmarks to include virtual text; artifact: " .. tostring(artifact_path))
	end

	vim.cmd("silent! bufdo setlocal nomodified")
end

return M
