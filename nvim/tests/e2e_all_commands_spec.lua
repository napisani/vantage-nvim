local M = {}

local artifact = {
	cases = {},
	commands = {},
}

local suite = {
	root = nil,
	codebase = nil,
	calculator = nil,
	target_buf = nil,
}

local function repo_root()
	local value = vim.g.vantage_nvim_root
	if value and value ~= "" then
		return value
	end
	return vim.fn.fnamemodify(debug.getinfo(1, "S").source:gsub("^@", ""), ":p:h:h:h")
end

local function artifact_path()
	local path = vim.g.vantage_e2e_artifact_path
	if path and path ~= "" then
		return path
	end
	return repo_root() .. "/.nvim-dev/e2e/model-all-commands.json"
end

local function write_artifact()
	local path = artifact_path()
	vim.fn.mkdir(vim.fn.fnamemodify(path, ":h"), "p")
	vim.fn.writefile({ vim.json.encode(artifact) }, path)
	return path
end

local function target_lines()
	local bufnr = suite.target_buf or vim.api.nvim_get_current_buf()
	return vim.api.nvim_buf_get_lines(bufnr, 0, -1, false)
end

local function fail(message)
	artifact.failure = message
	artifact.finalBuffer = target_lines()
	artifact.finalQuickfix = vim.fn.getqflist()
	artifact.finalLens = require("vantage").get_lens()
	local path = write_artifact()
	vim.api.nvim_err_writeln(message .. "; artifact: " .. path)
	vim.cmd("silent! bufdo setlocal nomodified")
	vim.cmd("cquit")
end

local function wait_ms()
	local value = tonumber(vim.g.vantage_e2e_wait_ms or "")
	if value and value > 0 then
		return value
	end
	return 120000
end

local function close_floats()
	for _, win in ipairs(vim.api.nvim_list_wins()) do
		if vim.api.nvim_win_get_config(win).relative ~= "" then
			pcall(vim.api.nvim_win_close, win, true)
		end
	end
end

local function float_text()
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
		for _, line in ipairs(details.virt_lines or {}) do
			for _, chunk in ipairs(line) do
				table.insert(texts, chunk[1])
			end
		end
	end
	return texts
end

local function marks()
	return require("vantage.annotations").current_marks(suite.target_buf or 0)
end

local function focus_target_buffer()
	if suite.target_buf and vim.api.nvim_buf_is_valid(suite.target_buf) then
		vim.api.nvim_set_current_buf(suite.target_buf)
	end
end

local function assert_no_error_float(name)
	local text = float_text()
	if text and text:match("^## Error") then
		fail(name .. " produced an error float: " .. text)
	end
end

local function command_record(case_entry, command)
	local entry = {
		case = case_entry.name,
		command = command,
		status = "running",
	}
	table.insert(artifact.commands, entry)
	write_artifact()
	return entry
end

local function run_sync_command(case_entry, command)
	close_floats()
	focus_target_buffer()
	local entry = command_record(case_entry, command)
	local ok, err = pcall(vim.cmd, command)
	if not ok then
		entry.status = "failed"
		entry.error = tostring(err)
		fail(case_entry.name .. " failed immediately: " .. tostring(err))
	end
	entry.status = "ok"
	entry.floatText = float_text()
	write_artifact()
	return entry
end

local function run_float_command(case_entry, command)
	close_floats()
	focus_target_buffer()
	local entry = command_record(case_entry, command)
	local ok, err = pcall(vim.cmd, command)
	if not ok then
		entry.status = "failed"
		entry.error = tostring(err)
		fail(case_entry.name .. " failed immediately: " .. tostring(err))
	end
	vim.wait(wait_ms(), function()
		local text = float_text()
		return text ~= nil and text ~= ""
	end, 100)
	entry.floatText = float_text()
	if not entry.floatText or entry.floatText == "" then
		entry.status = "failed"
		fail(case_entry.name .. " did not produce markdown output")
	end
	if entry.floatText:match("^## Error") then
		entry.status = "failed"
		fail(case_entry.name .. " produced error markdown: " .. entry.floatText)
	end
	entry.status = "ok"
	write_artifact()
	return entry
end

local function run_until(case_entry, command, predicate, failure_message)
	close_floats()
	focus_target_buffer()
	local entry = command_record(case_entry, command)
	local ok, err = pcall(vim.cmd, command)
	if not ok then
		entry.status = "failed"
		entry.error = tostring(err)
		fail(case_entry.name .. " failed immediately: " .. tostring(err))
	end
	vim.wait(wait_ms(), function()
		if predicate() then
			return true
		end
		local text = float_text()
		return text ~= nil and text:match("^## Error") ~= nil
	end, 100)
	entry.floatText = float_text()
	assert_no_error_float(case_entry.name)
	if not predicate() then
		entry.status = "failed"
		fail(failure_message)
	end
	entry.status = "ok"
	write_artifact()
	return entry
end

local function set_cursor_to(pattern)
	local bufnr = suite.target_buf or vim.api.nvim_get_current_buf()
	local lines = vim.api.nvim_buf_get_lines(bufnr, 0, -1, false)
	for index, line in ipairs(lines) do
		if line:find(pattern, 1, true) then
			vim.api.nvim_set_current_buf(bufnr)
			vim.api.nvim_win_set_cursor(0, { index, 0 })
			return index
		end
	end
	fail("could not find fixture line containing: " .. pattern)
end

local function case(name, command_name, use_case, run)
	return {
		name = name,
		commandName = command_name,
		useCase = use_case,
		run = run,
	}
end

local function run_case(case_entry)
	local result = {
		name = case_entry.name,
		commandName = case_entry.commandName,
		useCase = case_entry.useCase,
		status = "running",
	}
	table.insert(artifact.cases, result)
	write_artifact()
	case_entry.run(case_entry)
	result.status = "ok"
	result.floatText = float_text()
	result.quickfixCount = #vim.fn.getqflist()
	result.annotationCount = #marks()
	write_artifact()
end

local cases = {
	case("lens:set-learning", "VantageSetLens", "sets a learning lens with explicit text", function(current)
		run_sync_command(current, "VantageSetLens learning Keep responses short and focus on calculator data flow")
		local lens = require("vantage").get_lens()
		if not lens or lens.mode ~= "learning" then
			fail("VantageSetLens did not set the expected lens")
		end
	end),

	case("explain:current-line", "VantageExplain", "explains the current calculator line", function(current)
		set_cursor_to("local total = value + bonus")
		run_float_command(current, "VantageExplain")
	end),

	case("question:current-line-with-prompt", "VantageQuestion", "answers an explicit question about the current line", function(current)
		run_float_command(current, "VantageQuestion Where does this total get computed?")
	end),

	case("edit:current-line-replacement", "VantageEdit", "applies a one-line replacement returned by the model", function(current)
		set_cursor_to("local total = value + bonus")
		run_until(
			current,
			"VantageEdit Replace this exact line with: local sum = value + bonus",
			function()
				return table.concat(target_lines(), "\n"):find("local sum = value %+ bonus") ~= nil
			end,
			"VantageEdit did not apply the expected one-line replacement"
		)
	end),

	case("annotate:current-line", "VantageAnnotate", "renders at least one annotation on the current line", function(current)
		set_cursor_to("local total = 0")
		run_until(current, "VantageAnnotate", function()
			return #marks() > 0
		end, "VantageAnnotate did not create annotation extmarks")
		artifact.annotationTexts = annotation_texts(marks())
	end),

	case("annotation-clear:after-render", "VantageAnnotationClear", "clears Vantage annotation extmarks", function(current)
		run_sync_command(current, "VantageAnnotationClear")
		if #marks() ~= 0 then
			fail("VantageAnnotationClear did not remove annotation extmarks")
		end
	end),

	case("search:cross-file-usage", "VantageSearch", "finds where calculator.total_score is used from another file", function(current)
		run_until(current, "VantageSearch Find the exact call calculator.total_score(items) in workspace file lua/report.lua. Submit exactly one result for lua/report.lua line 6 startCharacter 15.", function()
			return #vim.fn.getqflist() > 0
		end, "VantageSearch did not populate quickfix")
		artifact.quickfix = vim.fn.getqflist()
		vim.cmd("cclose")
	end),

	case("status:combined", "VantageStatus", "shows agent session, agent context, and annotation status together", function(current)
		local entry = run_float_command(current, "VantageStatus")
		if not entry.floatText:match("### Agent Session") then
			fail("VantageStatus did not include the Agent Session section")
		end
		if not entry.floatText:match("### Agent Context") then
			fail("VantageStatus did not include the Agent Context section")
		end
		if not entry.floatText:match("### Annotations") then
			fail("VantageStatus did not include the Annotations section")
		end
	end),

	case("session-output:live", "VantageSessionOutput", "shows recent session activity", function(current)
		local entry = run_float_command(current, "VantageSessionOutput")
		local saw_output = vim.wait(5000, function()
			entry.floatText = float_text()
			return entry.floatText and entry.floatText:match("Vantage Session Output") ~= nil
		end)
		if not saw_output then
			fail("VantageSessionOutput did not include the session output heading")
		end
	end),

	case("agent-cancel:idle", "VantageAgentCancel", "handles cancel when no request is active", function(current)
		run_float_command(current, "VantageAgentCancel")
	end),

	case("agent-reset:active-session", "VantageAgentReset", "resets the singleton buddy session", function(current)
		run_float_command(current, "VantageAgentReset")
	end),

	case("lens:clear", "VantageClearLens", "clears the active lens", function(current)
		run_sync_command(current, "VantageClearLens")
		if require("vantage").get_lens() ~= nil then
			fail("VantageClearLens did not clear the active lens")
		end
	end),
}

local function setup_fixture()
	suite.root = repo_root()
	suite.codebase = vim.g.vantage_e2e_codebase_path or (suite.root .. "/examples/e2e-codebase")
	suite.calculator = suite.codebase .. "/lua/calculator.lua"

	vim.fn.mkdir(suite.codebase .. "/.git", "p")
	vim.cmd("cd " .. vim.fn.fnameescape(suite.codebase))
	vim.cmd("edit " .. vim.fn.fnameescape(suite.calculator))
	vim.bo.filetype = "lua"
	suite.target_buf = vim.api.nvim_get_current_buf()

	artifact.cwd = vim.fn.getcwd()
	artifact.root = suite.root
	artifact.codebase = suite.codebase
	artifact.model = {
		provider = vim.g.vantage_pi_provider or "openai",
		model = vim.g.vantage_pi_model or "gpt-4o-mini",
	}
	artifact.backend = require("vantage.state").config.backend
	artifact.openedFile = vim.api.nvim_buf_get_name(suite.target_buf)
	write_artifact()

	require("vantage.annotations").clear(suite.target_buf)
end

function M.run()
	setup_fixture()
	for _, current in ipairs(cases) do
		run_case(current)
	end

	artifact.status = "ok"
	artifact.finalBuffer = target_lines()
	artifact.finalLens = require("vantage").get_lens()
	write_artifact()
	vim.cmd("silent! bufdo setlocal nomodified")
end

return M
