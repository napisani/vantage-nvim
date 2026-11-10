-- diff tours from review state: the renderer's comparison and points, request
-- args, and (with VANTAGE_DIFFVIEW_PATH set) Diffview navigation
--
-- Registers into the shared harness; run via nvim/tests/vantage_spec.lua.
local test = require("support.harness").test
local helpers = require("support.helpers")

local eq = helpers.eq

local function fixture()
	local root = helpers.temp_workspace()
	vim.fn.system({ "git", "-C", root, "init", "-q" })
	vim.fn.system({ "git", "-C", root, "config", "user.email", "test@example.com" })
	vim.fn.system({ "git", "-C", root, "config", "user.name", "Test" })
	helpers.writefile(root .. "/sample.txt", "before\nretained\n")
	vim.fn.system({ "git", "-C", root, "add", "." })
	vim.fn.system({ "git", "-C", root, "commit", "-qm", "initial" })
	local base = vim.trim(vim.fn.system({ "git", "-C", root, "rev-parse", "HEAD" }))
	helpers.writefile(root .. "/sample.txt", "after\nretained\n")
	helpers.set_buffer_path(root .. "/sample.txt")
	return root, base
end

local function tour(base, stops, target)
	local converted = {}
	for _, stop in ipairs(stops) do
		table.insert(converted, {
			ref = { path = stop.file, startLine = stop.line, endLine = stop.line, side = stop.side },
			title = stop.title,
			note = stop.note,
		})
	end
	return {
		id = "tour-1",
		kind = "diffTour",
		title = "Changes",
		summary = "s",
		comparison = { base = base, target = target and { kind = "commit", commit = target } or { kind = "worktree", head = base } },
		stops = converted,
		createdAt = "",
	}
end

local function with_diffview()
	local plugin = vim.env.VANTAGE_DIFFVIEW_PATH
	if not plugin or vim.fn.isdirectory(plugin) ~= 1 then
		return false
	end
	vim.opt.runtimepath:append(plugin)
	vim.cmd("runtime plugin/diffview.lua")
	require("diffview").setup({ view = { default = { layout = "diff2_horizontal" } } })
	return true
end

test("a tour whose commits are not plain hashes is refused before anything reaches an Ex command", function()
	local diff_tour = require("vantage.diff_tour")
	local stops = { { file = "a.ts", side = "base", line = 3, title = "Removed", note = "Old guard." } }
	eq(diff_tour.invalid(tour(string.rep("b", 40), stops)), nil)
	eq(diff_tour.invalid(tour(string.rep("b", 40), stops, string.rep("c", 40))), nil)
	assert(diff_tour.invalid(tour("abc\n!touch /tmp/pwned", stops)))
	assert(diff_tour.invalid(tour(string.rep("b", 40), stops, "HEAD")))
	local bad = tour(string.rep("b", 40), stops)
	bad.comparison.target.head = "main\necho 'x'"
	assert(diff_tour.invalid(bad))
	local notified = helpers.capture_notifications(function()
		diff_tour.load(tour("abc\n!touch /tmp/pwned", stops), "/tmp")
	end)
	assert(notified[1]:find("no valid comparison", 1, true), notified[1])
	eq(diff_tour.loaded(), nil)
end)

test(":VantageDiffTour parses refs before -- and the prompt after", function()
	local commands = require("vantage.commands")
	eq({ commands.parse_diff_tour_args("main feature -- tour it") }, { "main", "feature", "tour it" })
	eq({ commands.parse_diff_tour_args("main -- tour it") }, { "main", nil, "tour it" })
	eq({ commands.parse_diff_tour_args("tour the last commit") }, { nil, nil, "tour the last commit" })
	eq({ commands.parse_diff_tour_args("explain the --force flag") }, { nil, nil, "explain the --force flag" })
	eq({ commands.parse_diff_tour_args("-- why --dry-run exists") }, { nil, nil, "why --dry-run exists" })
	eq({ commands.parse_diff_tour_args("a b c -- too many refs") }, { nil, nil, "a b c -- too many refs" })
	eq({ commands.parse_diff_tour_args("main") }, { "main", nil, "" })
	local captured = helpers.capture_actions(function()
		require("vantage").setup({})
		vim.cmd("VantageDiffTour HEAD~1 -- what changed")
	end, { threadId = "T1" })
	eq(captured[1], { type = "diffTour", text = "what changed", base = "HEAD~1" })
end)

test("commit-pair tour opens exact pinned revisions rather than the worktree", function()
	if not with_diffview() then
		return
	end
	local root, base = fixture()
	vim.fn.system({ "git", "-C", root, "add", "sample.txt" })
	vim.fn.system({ "git", "-C", root, "commit", "-qm", "changed" })
	local target = vim.trim(vim.fn.system({ "git", "-C", root, "rev-parse", "HEAD" }))
	local diff_tour = require("vantage.diff_tour")
	diff_tour.load(tour(base, { { file = "sample.txt", side = "current", line = 1, title = "Commit", note = "Committed change." } }, target), root)
	local lib = require("diffview.lib")
	assert(vim.wait(5000, function()
		local view = lib.get_current_view()
		return view and view.cur_entry and view.cur_entry.path == "sample.txt" and view.cur_layout:is_files_loaded() and view.right.commit == target
	end), "commit pair did not open")
	diff_tour.clear()
	vim.cmd("DiffviewClose")
end)

test("diff tour focuses the selected side in Diffview and wraps long notes", function()
	if not with_diffview() then
		return
	end
	local root, base = fixture()
	local diff_tour = require("vantage.diff_tour")
	diff_tour.load(tour(base, {
		{ file = "sample.txt", side = "base", line = 1, title = "Old", note = "Original value." },
		{ file = "sample.txt", side = "current", line = 1, title = "New", note = "Changed value with a deliberately long explanation that should wrap before it becomes difficult to read on a narrow screen." },
	}), root)
	local lib = require("diffview.lib")
	assert(vim.wait(5000, function()
		local view = lib.get_current_view()
		return view and view.cur_entry and view.cur_entry.path == "sample.txt" and view.cur_layout:is_files_loaded()
	end), "Diffview did not open sample.txt")
	assert(vim.wait(1000, function()
		return lib.get_current_view().cur_layout.a.id == vim.api.nvim_get_current_win()
	end), "did not focus the old revision")
	diff_tour.next()
	assert(vim.wait(1000, function()
		return lib.get_current_view().cur_layout.b.id == vim.api.nvim_get_current_win()
	end), "did not focus the new revision")
	local view = lib.get_current_view()
	local marks = vim.api.nvim_buf_get_extmarks(view.cur_layout.b.file.bufnr, vim.api.nvim_get_namespaces().vantage_diff_tour, 0, -1, { details = true })
	assert(#marks > 0, vim.inspect(marks))
	for _, line in ipairs(marks[1][4].virt_lines) do
		assert(#line[1][1] <= 80, "diff tour note line exceeds 80 characters: " .. line[1][1])
	end
	diff_tour.clear()
	vim.cmd("DiffviewClose")
end)
