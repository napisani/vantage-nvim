local test = require("support.harness").test
local helpers = require("support.helpers")

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

local function artifact(root, base, points, target)
	helpers.writefile(root .. "/.vantage/diff-tour.json", vim.json.encode({
		version = 1,
		comparison = { vcs = "git", repoRoot = ".", base = { label = "HEAD", commit = base },
			target = target and { kind = "commit", label = "HEAD", commit = target }
				or { kind = "worktree", headAtAuthoring = base } },
		points = points,
	}))
end

test("diff tour rejects unsafe artifact pointers before changing editor state", function()
	local root, base = fixture()
	artifact(root, base, { { file = "../escape", side = "right", line = 1, anchor = "x", description = "No" } })
	local tour, err = require("vantage.diff_tour").read()
	assert(tour == nil and err:match("invalid point"), tostring(err))
end)

test("VantageGenerateDiffTour preserves explicit refs and the user prompt", function()
	local root, base = fixture()
	local vantage = require("vantage")
	vantage.setup({ backend = { mode = "development" } })
	local captured
	helpers.capture_notifications(function()
		captured = helpers.capture_backend_request({
			ok = true, result = { kind = "diffTour", path = root .. "/.vantage/diff-tour.json",
				pointCount = 1, changedFileCount = 1, inspectedFileCount = 1 },
		}, function()
			artifact(root, base, { { file = "sample.txt", side = "right", line = 1,
				anchor = "after", description = "Changed value." } })
			vim.cmd("VantageGenerateDiffTour HEAD WORKTREE -- focus on the behavior")
		end)
	end)
	assert(captured.method == "generateDiffTour", vim.inspect(captured))
	assert(captured.params.base == "HEAD" and captured.params.target == "WORKTREE", vim.inspect(captured.params))
	assert(captured.params.prompt == "focus on the behavior", vim.inspect(captured.params))
	require("vantage.diff_tour").clear()
end)

test("prompt-only diff-tour generation leaves ref selection to the buddy", function()
	local root, base = fixture()
	require("vantage").setup({ backend = { mode = "development" } })
	local captured
	helpers.capture_notifications(function()
		captured = helpers.capture_backend_request({
			ok = true, result = { kind = "diffTour", path = root .. "/.vantage/diff-tour.json",
				pointCount = 1, changedFileCount = 1, inspectedFileCount = 1 },
		}, function()
			artifact(root, base, { { file = "sample.txt", side = "right", line = 1,
				anchor = "after", description = "Changed value." } })
			vim.cmd("VantageGenerateDiffTour -- tour my branch against main")
		end)
	end)
	assert(captured.params.base == nil and captured.params.target == nil, vim.inspect(captured.params))
	assert(captured.params.prompt == "tour my branch against main")
	require("vantage.diff_tour").clear()
end)

test("diff-tour generation without inline prompt keeps its supplied base", function()
	local root, base = fixture()
	local vantage = require("vantage")
	vantage.setup({ backend = { mode = "development" } })
	local captured
	helpers.capture_notifications(function()
		captured = helpers.capture_backend_request({
			ok = true, result = { kind = "diffTour", path = root .. "/.vantage/diff-tour.json",
				pointCount = 1, changedFileCount = 1, inspectedFileCount = 1 },
		}, function()
			artifact(root, base, { { file = "sample.txt", side = "right", line = 1,
				anchor = "after", description = "Changed value." } })
			vim.cmd("VantageGenerateDiffTour HEAD --")
			helpers.submit_prompt_buffer("tour the important changes")
		end)
	end)
	assert(captured.method == "generateDiffTour", vim.inspect(captured))
	assert(captured.params.base == "HEAD" and captured.params.target == nil, vim.inspect(captured.params))
	assert(captured.params.prompt == "tour the important changes", vim.inspect(captured.params))
	require("vantage.diff_tour").clear()
end)

test("commit-pair tour opens exact pinned revisions rather than the worktree", function()
	local plugin = vim.env.VANTAGE_DIFFVIEW_PATH
	if not plugin or vim.fn.isdirectory(plugin) ~= 1 then return end
	vim.opt.runtimepath:append(plugin)
	vim.cmd("runtime plugin/diffview.lua")
	require("diffview").setup({ view = { default = { layout = "diff2_horizontal" } } })
	local root, base = fixture()
	vim.fn.system({ "git", "-C", root, "add", "sample.txt" })
	vim.fn.system({ "git", "-C", root, "commit", "-qm", "changed" })
	local target = vim.trim(vim.fn.system({ "git", "-C", root, "rev-parse", "HEAD" }))
	artifact(root, base, { { file = "sample.txt", side = "right", line = 1,
		anchor = "after", description = "Committed change." } }, target)
	local tour = require("vantage.diff_tour")
	tour.load()
	local lib = require("diffview.lib")
	assert(vim.wait(5000, function()
		local view = lib.get_current_view()
		return view and view.cur_entry and view.cur_entry.path == "sample.txt"
			and view.cur_layout:is_files_loaded() and view.right.commit == target
	end), "commit pair did not open")
	tour.clear()
	vim.cmd("DiffviewClose")
end)

test("deleted-file stops survive closing and reopening the Diffview tab", function()
	local plugin = vim.env.VANTAGE_DIFFVIEW_PATH
	if not plugin or vim.fn.isdirectory(plugin) ~= 1 then return end
	vim.opt.runtimepath:append(plugin)
	vim.cmd("runtime plugin/diffview.lua")
	require("diffview").setup({ view = { default = { layout = "diff2_horizontal" } } })
	local root, base = fixture()
	vim.fn.delete(root .. "/sample.txt")
	artifact(root, base, {
		{ file = "sample.txt", side = "left", line = 1, anchor = "before", description = "Removed first line." },
		{ file = "sample.txt", side = "left", line = 2, anchor = "retained", description = "Removed second line." },
	})
	local tour = require("vantage.diff_tour")
	tour.load()
	local lib = require("diffview.lib")
	assert(vim.wait(5000, function()
		local view = lib.get_current_view()
		return view and view.cur_entry and view.cur_entry.path == "sample.txt" and view.cur_layout:is_files_loaded()
	end), "deleted file did not open")
	vim.cmd("DiffviewClose")
	tour.next()
	assert(vim.wait(5000, function()
		local view = lib.get_current_view()
		return view and view.cur_entry and view.cur_entry.path == "sample.txt"
			and view.cur_layout:is_files_loaded() and view.cur_layout.a.id == vim.api.nvim_get_current_win()
			and vim.api.nvim_win_get_cursor(view.cur_layout.a.id)[1] == 2
	end), "did not reopen on the next deleted-file stop")
	tour.clear()
	vim.cmd("DiffviewClose")
end)

test("diff tour focuses the selected side in Diffview and marks drift as stale", function()
	local plugin = vim.env.VANTAGE_DIFFVIEW_PATH
	if not plugin or vim.fn.isdirectory(plugin) ~= 1 then return end
	vim.opt.runtimepath:append(plugin)
	vim.cmd("runtime plugin/diffview.lua")
	require("diffview").setup({ view = { default = { layout = "diff2_horizontal" } } })
	local root, base = fixture()
	artifact(root, base, {
		{ file = "sample.txt", side = "left", line = 1, anchor = "before", description = "Original value." },
		{ file = "sample.txt", side = "right", line = 1, anchor = "wrong anchor",
			description = "Changed value with a deliberately long explanation that should wrap before it becomes difficult to read on a narrow screen." },
	})
	local tour = require("vantage.diff_tour")
	tour.load()
	local lib = require("diffview.lib")
	assert(vim.wait(5000, function()
		local view = lib.get_current_view()
		return view and view.cur_entry and view.cur_entry.path == "sample.txt" and view.cur_layout:is_files_loaded()
	end), "Diffview did not open sample.txt")
	assert(vim.wait(1000, function()
		local view = lib.get_current_view()
		return view and view.cur_layout.a.id == vim.api.nvim_get_current_win()
	end), "did not focus the old revision")
	tour.next()
	assert(vim.wait(1000, function()
		local view = lib.get_current_view()
		return view and view.cur_layout.b.id == vim.api.nvim_get_current_win()
	end), "did not focus the new revision")
	local view = lib.get_current_view()
	local marks = vim.api.nvim_buf_get_extmarks(view.cur_layout.b.file.bufnr,
		vim.api.nvim_get_namespaces().vantage_diff_tour, 0, -1, { details = true })
	assert(#marks > 0 and marks[1][4].virt_lines[1][1][1]:match("%[stale%]"), vim.inspect(marks))
	for _, line in ipairs(marks[1][4].virt_lines) do
		assert(#line[1][1] <= 80, "diff tour explanation line exceeds 80 characters: " .. line[1][1])
	end
	local current_win = vim.api.nvim_get_current_win()
	helpers.capture_notifications(function() tour.next() end)
	assert(vim.api.nvim_get_current_win() == current_win, "next should stay at the final stop")
	tour.prev()
	assert(vim.wait(1000, function() return lib.get_current_view().cur_layout.a.id == vim.api.nvim_get_current_win() end))
	tour.clear()
	vim.cmd("DiffviewClose")
end)
