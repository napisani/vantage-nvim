local agent_context = require("vantage.agent_context")

local M = {}
local namespace = vim.api.nvim_create_namespace("vantage_diff_tour")
local state = nil

local function notify(message, level)
	vim.notify("Vantage diff tour: " .. message, level or vim.log.levels.WARN)
end

local function safe_path(file)
	return type(file) == "string" and file ~= "" and not file:match("^/") and not file:find("\\", 1, true)
		and not file:find("%z") and not file:find("\n", 1, true)
		and not file:find("//", 1, true) and not file:match("^%a:")
		and not file:match("^%./") and not file:match("/%./")
		and not file:match("^%.%./") and not file:match("/%.%./") and file ~= ".." and file ~= "."
		and not file:match("/%.%.$") and not file:match("/%.$")
end

local function workspace_root()
	local lib = package.loaded["diffview.lib"]
	local view = lib and lib.get_current_view and lib.get_current_view()
	if view and view.adapter and view.adapter.ctx then
		return view.adapter.ctx.toplevel
	end
	return agent_context.workspace_root()
end

local function valid_hash(value)
	return type(value) == "string" and (#value == 40 or #value == 64) and value:match("^[a-f0-9]+$") ~= nil
end

function M.read()
	local root = workspace_root()
	local path = root .. "/.vantage/diff-tour.json"
	if vim.fn.filereadable(path) == 0 then
		return nil, "no tour at " .. path
	end
	local ok, artifact = pcall(vim.json.decode, table.concat(vim.fn.readfile(path), "\n"))
	if not ok or type(artifact) ~= "table" or artifact.version ~= 1 then
		return nil, "invalid or unsupported diff-tour artifact"
	end
	local comparison = artifact.comparison
	if type(comparison) ~= "table" or comparison.vcs ~= "git" or comparison.repoRoot ~= "."
		or type(comparison.base) ~= "table" or not valid_hash(comparison.base.commit)
		or type(comparison.target) ~= "table"
		or (comparison.target.kind == "commit" and not valid_hash(comparison.target.commit))
		or (comparison.target.kind == "worktree" and not valid_hash(comparison.target.headAtAuthoring))
		or (comparison.target.kind ~= "commit" and comparison.target.kind ~= "worktree") then
		return nil, "invalid comparison in diff-tour artifact"
	end
	if type(artifact.points) ~= "table" or #artifact.points == 0 or #artifact.points > 100 then
		return nil, "diff tour must contain 1–100 points"
	end
	for _, point in ipairs(artifact.points) do
		if type(point) ~= "table" or not safe_path(point.file) or (point.side ~= "left" and point.side ~= "right")
			or type(point.line) ~= "number" or point.line < 1 or point.line % 1 ~= 0
			or type(point.anchor) ~= "string" or point.anchor:find("\n", 1, true)
			or type(point.description) ~= "string" or #point.description == 0 or #point.description > 500
			or point.description:find("\n", 1, true) then
			return nil, "invalid point in diff-tour artifact"
		end
	end
	return artifact
end

local function clear_marks()
	for _, bufnr in ipairs(vim.api.nvim_list_bufs()) do
		if vim.api.nvim_buf_is_valid(bufnr) then
			vim.api.nvim_buf_clear_namespace(bufnr, namespace, 0, -1)
		end
	end
end

local function unbind()
	if not state or not state.view then return end
	for event, callback in pairs(state.listeners or {}) do
		state.view.emitter:off(callback, event)
	end
	state.listeners = nil
end

function M.clear()
	unbind()
	clear_marks()
	state = nil
end

local function comparison_matches(view, comparison)
	if not view or not view.left or not view.right or not view.adapter or not view.adapter.ctx
		or vim.loop.fs_realpath(view.adapter.ctx.toplevel) ~= vim.loop.fs_realpath(state.root)
		or view.left.commit ~= comparison.base.commit then
		return false
	end
	if comparison.target.kind == "commit" then
		return view.right.commit == comparison.target.commit
	end
	return view.right.type == require("diffview.vcs.rev").RevType.LOCAL
end

local function ensure_view()
	local comparison = state.artifact.comparison
	if state.view and (not state.view.tabpage or not vim.api.nvim_tabpage_is_valid(state.view.tabpage)) then
		unbind()
		state.view = nil
	end
	if state.view and state.view.tabpage and vim.api.nvim_tabpage_is_valid(state.view.tabpage) then
		if comparison_matches(state.view, comparison) then
			vim.api.nvim_set_current_tabpage(state.view.tabpage)
			return state.view
		end
		unbind()
		state.view = nil
	end
	if vim.fn.exists(":DiffviewOpen") ~= 2 then
		notify("Diffview is unavailable; install/load diffview.nvim to use this tour", vim.log.levels.ERROR)
		return nil
	end
	local arg = comparison.base.commit
	if comparison.target.kind == "commit" then
		arg = arg .. ".." .. comparison.target.commit
	end
	local ok, err = pcall(vim.cmd, "DiffviewOpen -C=" .. vim.fn.fnameescape(state.root) .. " " .. arg .. " --untracked-files=no")
	if not ok then
		notify("could not open Diffview: " .. tostring(err), vim.log.levels.ERROR)
		return nil
	end
	local loaded, lib = pcall(require, "diffview.lib")
	local view = loaded and lib.get_current_view() or nil
	if not comparison_matches(view, comparison) then
		notify("Diffview did not open the artifact's comparison", vim.log.levels.ERROR)
		return nil
	end
	state.view = view
	state.new_view = not view.ready
	return view
end

local function side_window(view, side)
	local layout = view.cur_layout
	if not layout or not layout.name or not layout.name:match("^diff2_") then return nil, "use a two-pane Diffview layout" end
	local win = layout[side == "left" and "a" or "b"]
	if not win or not win:is_file_open() then return nil, "side not available in this diff" end
	return win
end

local function wrap_text(text, width)
	local lines = {}
	local current = ""

	local function flush()
		if current ~= "" then
			lines[#lines + 1] = current
			current = ""
		end
	end

	local function split_prefix(value)
		local chars = vim.fn.strchars(value)
		local length = 0
		for index = 1, chars do
			local candidate = vim.fn.strcharpart(value, 0, index)
			if vim.fn.strdisplaywidth(candidate) > width then break end
			length = index
		end
		if length == 0 then length = 1 end
		return vim.fn.strcharpart(value, 0, length), vim.fn.strcharpart(value, length)
	end

	for word in text:gmatch("%S+") do
		while vim.fn.strdisplaywidth(word) > width do
			flush()
			local prefix
			prefix, word = split_prefix(word)
			lines[#lines + 1] = prefix
		end
		if current == "" then
			current = word
		elseif vim.fn.strdisplaywidth(current .. " " .. word) <= width then
			current = current .. " " .. word
		else
			flush()
			current = word
		end
	end
	flush()
	return lines
end

local function annotate(view, entry)
	for _, win in ipairs(view.cur_layout.windows or {}) do
		if win:is_file_open() then
			vim.api.nvim_buf_clear_namespace(win.file.bufnr, namespace, 0, -1)
		end
	end
	for _, point in ipairs(state.artifact.points) do
		if point.file == entry.path then
			local win = side_window(view, point.side)
			if win then
				local bufnr = win.file.bufnr
				local count = vim.api.nvim_buf_line_count(bufnr)
				local row = math.min(point.line, count)
				local current = vim.api.nvim_buf_get_lines(bufnr, row - 1, row, false)[1]
				local stale = row ~= point.line or vim.trim(current or "") ~= vim.trim(point.anchor)
				local description = wrap_text((stale and "[stale] " or "") .. point.description, 80)
				local virt_lines = {}
				for _, line in ipairs(description) do
					virt_lines[#virt_lines + 1] = { { line, "Comment" } }
				end
				vim.api.nvim_buf_set_extmark(bufnr, namespace, row - 1, 0, {
					virt_lines = virt_lines,
					virt_lines_above = true,
				})
			end
		end
	end
end

local function show_current(view)
	local point = state.artifact.points[state.index]
	local entry = view.cur_entry
	if not entry or entry.path ~= point.file or not view.cur_layout or not view.cur_layout:is_files_loaded() then return end
	local win, err = side_window(view, point.side)
	if not win then
		notify(err)
		return
	end
	annotate(view, entry)
	state.pending = nil
	vim.api.nvim_set_current_win(win.id)
	vim.api.nvim_win_set_cursor(win.id, { math.min(point.line, vim.api.nvim_buf_line_count(win.file.bufnr)), 0 })
	vim.cmd("normal! zz")
end

local function navigate(index)
	if not state then
		local artifact, err = M.read()
		if not artifact then notify(err) return end
		state = { artifact = artifact, index = 1, root = workspace_root() }
	end
	local point = state.artifact.points[index]
	if not point then notify("end of tour", vim.log.levels.INFO) return end
	local view = ensure_view()
	if not view then return end
	if view.ready and view.cur_layout and not view.cur_layout.name:match("^diff2_") and not state.new_view then
		notify("use a two-pane Diffview layout before navigating")
		return
	end
	state.index = index
	state.pending = index
	if not state.listeners then
		local on_file = function(_, entry)
			if not state or state.view ~= view or not entry then return end
			vim.schedule(function()
				if not state or state.view ~= view or view.cur_entry ~= entry
					or vim.api.nvim_get_current_tabpage() ~= view.tabpage then return end
				for _, point in ipairs(state.artifact.points) do
					if point.file == entry.path then
						annotate(view, entry)
						break
					end
				end
				if state.pending == state.index and state.artifact.points[state.index].file == entry.path then
					show_current(view)
				end
			end)
		end
		local on_files = function()
			if state and state.view == view then
				vim.schedule(function() if state and state.view == view then navigate(state.index) end end)
			end
		end
		view.emitter:on("file_open_post", on_file)
		view.emitter:on("files_updated", on_files)
		state.listeners = { file_open_post = on_file, files_updated = on_files }
	end
	if not view.ready then return end
	local entry
	for _, candidate in view.files:iter() do
		if candidate.path == point.file then entry = candidate break end
	end
	if not entry then notify("file absent from this Diffview comparison: " .. point.file) return end
	if state.new_view and not entry.layout.name:match("^diff2_") then
		entry:convert_layout(require("diffview.scene.layouts.diff_2_hor").Diff2Hor)
	end
	state.new_view = nil
	if view.cur_entry == entry and view.cur_layout:is_files_loaded() then
		show_current(view)
	else
		view:set_file_by_path(point.file, true)
	end
end

function M.load()
	local artifact, err = M.read()
	if not artifact then notify(err) return end
	M.clear()
	state = { artifact = artifact, index = 1, root = workspace_root() }
	navigate(1)
end

function M.next()
	if not state then return M.load() end
	navigate(state.index + 1)
end

function M.prev()
	if not state then return M.load() end
	navigate(state.index - 1)
end

return M
