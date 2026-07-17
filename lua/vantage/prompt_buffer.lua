local skill_cache = require("vantage.skill_cache")
local state = require("vantage.state")
local ui = require("vantage.ui")

local M = {}

local function trim(text)
	return (text or ""):gsub("^%s+", ""):gsub("%s+$", "")
end

local function as_list(value)
	if type(value) == "table" then
		return value
	end
	if type(value) == "string" and value ~= "" then
		return { value }
	end
	return {}
end

local function keymaps()
	local config = (((state.config.ui or {}).prompt or {}).keymaps or {})
	return {
		submit = as_list(config.submit or "<C-g>"),
		cancel = as_list(config.cancel or "<Esc>"),
	}
end

local function close(buf, win)
	if win and vim.api.nvim_win_is_valid(win) then
		vim.api.nvim_win_close(win, true)
	elseif buf and vim.api.nvim_buf_is_valid(buf) then
		vim.api.nvim_buf_delete(buf, { force = true })
	end
end

local function normalize_path(path)
	return path:gsub("\\", "/"):gsub("^%./", "")
end

local function known_file(root, ref)
	if not root or root == "" then
		return nil
	end
	local candidate = normalize_path(ref)
	if candidate:match("^/") or candidate:match("%.%.") then
		return nil
	end
	local stat = vim.loop.fs_stat(root .. "/" .. candidate)
	if stat and stat.type == "file" then
		return candidate
	end
	return nil
end

local function skill_names(skills)
	local names = {}
	for _, skill in ipairs(skills or {}) do
		if type(skill.name) == "string" then
			names[skill.name] = true
		end
	end
	return names
end

local function references_section(text, params, skills)
	local files = {}
	local seen_files = {}
	for ref in text:gmatch("@([%w%._%-%/%\\]+)") do
		local resolved = known_file(params.workspaceRoot, ref)
		if resolved and not seen_files[resolved] then
			seen_files[resolved] = true
			table.insert(files, resolved)
		end
	end

	local names = skill_names(skills)
	local resolved_skills = {}
	local seen_skills = {}
	for skill in text:gmatch("%f[%s/](/[%w][%w%-]*)") do
		local name = skill:sub(2)
		if names[name] and not seen_skills[name] then
			seen_skills[name] = true
			table.insert(resolved_skills, name)
		end
	end
	for name in text:gmatch("/skill:([%w][%w%-]*)") do
		if names[name] and not seen_skills[name] then
			seen_skills[name] = true
			table.insert(resolved_skills, name)
		end
	end

	if #files == 0 and #resolved_skills == 0 then
		return text
	end

	local lines = { text, "", "## Vantage Prompt References", "" }
	for _, file in ipairs(files) do
		table.insert(lines, "- file: `" .. file .. "`")
	end
	for _, skill in ipairs(resolved_skills) do
		table.insert(lines, "- skill: `skill:" .. skill .. "`")
	end
	return table.concat(lines, "\n")
end

function M.expand_references(text, params, callback)
	skill_cache.list(function(skills)
		callback(references_section(text, params or {}, skills))
	end)
end

function M.open(opts)
	opts = opts or {}
	local kind = opts.kind or "prompt"
	local params = opts.params or {}
	local on_submit = opts.on_submit or function() end

	local buf = vim.api.nvim_create_buf(false, true)
	vim.api.nvim_buf_set_option(buf, "bufhidden", "wipe")
	vim.api.nvim_buf_set_option(buf, "filetype", "markdown")
	vim.api.nvim_buf_set_option(buf, "swapfile", false)
	vim.api.nvim_buf_set_option(buf, "modifiable", true)
	vim.api.nvim_buf_set_name(buf, "VantagePrompt")
	vim.api.nvim_buf_set_var(buf, "vantage_prompt_buffer", true)
	vim.api.nvim_buf_set_var(buf, "vantage_prompt_kind", kind)
	vim.api.nvim_buf_set_lines(buf, 0, -1, false, { "" })

	local win = ui.open_float(buf, { height = 0.42, line_count = 12 })
	vim.api.nvim_win_set_option(win, "wrap", true)
	vim.api.nvim_win_set_option(win, "linebreak", true)
	vim.api.nvim_win_set_option(win, "breakindent", true)

	local function submit()
		local lines = vim.api.nvim_buf_get_lines(buf, 0, -1, false)
		local text = trim(table.concat(lines, "\n"))
		if text == "" then
			vim.notify("Vantage prompt is empty", vim.log.levels.WARN)
			return
		end
		close(buf, win)
		M.expand_references(text, params, function(expanded)
			on_submit(expanded)
		end)
	end

	local function cancel()
		close(buf, win)
	end

	local maps = keymaps()
	for _, lhs in ipairs(maps.submit) do
		vim.keymap.set({ "n", "i" }, lhs, submit, { buffer = buf, silent = true, desc = "Submit Vantage prompt" })
	end
	for _, lhs in ipairs(maps.cancel) do
		vim.keymap.set({ "n", "i" }, lhs, cancel, { buffer = buf, silent = true, desc = "Cancel Vantage prompt" })
	end

	vim.schedule(function()
		if vim.api.nvim_win_is_valid(win) then
			vim.api.nvim_set_current_win(win)
			vim.cmd("startinsert")
		end
	end)
	return buf, win
end

return M
