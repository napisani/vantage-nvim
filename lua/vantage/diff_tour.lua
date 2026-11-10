-- A diff tour from review state, shown in Diffview: notes on either side of
-- the comparison, navigated stop by stop.
local is_commit = require("vantage.review.git").is_commit

local M = {}
local namespace = vim.api.nvim_create_namespace("vantage_diff_tour")
local state = nil

local function notify(message, level)
	vim.notify("Vantage diff tour: " .. message, level or vim.log.levels.WARN)
end

---Why a published tour cannot be shown, or nil. Commits go into an Ex command,
---so anything but a plain hash is refused rather than escaped.
---@param tour table a diffTour from review state
---@return string? problem
function M.invalid(tour)
	local comparison = type(tour) == "table" and tour.comparison or nil
	if type(comparison) ~= "table" or not is_commit(comparison.base) or type(comparison.target) ~= "table" then
		return "the tour has no valid comparison"
	end
	local target = comparison.target
	if target.kind == "commit" and is_commit(target.commit) then
		return nil
	end
	if target.kind == "worktree" and is_commit(target.head) then
		return nil
	end
	return "the tour's target is not a commit or the working tree"
end

---The Diffview window for a stop's side: base is the left pane, current the right.
local function side_key(stop)
	return stop.ref.side == "base" and "a" or "b"
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
		or view.left.commit ~= comparison.base then
		return false
	end
	if comparison.target.kind == "commit" then
		return view.right.commit == comparison.target.commit
	end
	return view.right.type == require("diffview.vcs.rev").RevType.LOCAL
end

local function ensure_view()
	local comparison = state.tour.comparison
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
	local arg = comparison.base
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
		notify("Diffview did not open the tour's comparison", vim.log.levels.ERROR)
		return nil
	end
	state.view = view
	state.new_view = not view.ready
	return view
end

local function side_window(view, stop)
	local layout = view.cur_layout
	if not layout or not layout.name or not layout.name:match("^diff2_") then return nil, "use a two-pane Diffview layout" end
	local win = layout[side_key(stop)]
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
	for _, stop in ipairs(state.tour.stops) do
		if stop.ref.path == entry.path then
			local win = side_window(view, stop)
			if win then
				local bufnr = win.file.bufnr
				local row = math.min(stop.ref.startLine, vim.api.nvim_buf_line_count(bufnr))
				local description = wrap_text(stop.title .. ": " .. stop.note, 80)
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
	local stop = state.tour.stops[state.index]
	local entry = view.cur_entry
	if not entry or entry.path ~= stop.ref.path or not view.cur_layout or not view.cur_layout:is_files_loaded() then return end
	local win, err = side_window(view, stop)
	if not win then
		notify(err)
		return
	end
	annotate(view, entry)
	state.pending = nil
	vim.api.nvim_set_current_win(win.id)
	vim.api.nvim_win_set_cursor(win.id, { math.min(stop.ref.startLine, vim.api.nvim_buf_line_count(win.file.bufnr)), 0 })
	vim.cmd("normal! zz")
end

local function navigate(index)
	if not state then
		return
	end
	local stop = state.tour.stops[index]
	if not stop then notify("end of tour", vim.log.levels.INFO) return end
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
				for _, candidate in ipairs(state.tour.stops) do
					if candidate.ref.path == entry.path then
						annotate(view, entry)
						break
					end
				end
				if state.pending == state.index and state.tour.stops[state.index].ref.path == entry.path then
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
		if candidate.path == stop.ref.path then entry = candidate break end
	end
	if not entry then notify("file absent from this Diffview comparison: " .. stop.ref.path) return end
	if state.new_view and not entry.layout.name:match("^diff2_") then
		entry:convert_layout(require("diffview.scene.layouts.diff_2_hor").Diff2Hor)
	end
	state.new_view = nil
	if view.cur_entry == entry and view.cur_layout:is_files_loaded() then
		show_current(view)
	else
		view:set_file_by_path(stop.ref.path, true)
	end
end

---Opens the tour's comparison in Diffview and goes to its first stop.
---@param tour table
---@param root string
function M.load(tour, root)
	M.clear()
	local problem = M.invalid(tour)
	if problem then
		notify(problem, vim.log.levels.ERROR)
		return
	end
	state = { tour = tour, index = 1, root = root }
	navigate(1)
end

---@return string? tour_id the loaded tour
function M.loaded()
	return state and state.tour.id or nil
end

function M.next()
	if state then
		navigate(state.index + 1)
	end
end

function M.prev()
	if state then
		navigate(state.index - 1)
	end
end

return M
