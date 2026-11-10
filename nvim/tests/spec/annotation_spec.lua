-- :VantageAnnotate scopes, budgets, the request sent to the agent, and the
-- request lifecycle (result, cancel, timeout).
--
-- Registers into the shared harness; run via nvim/tests/vantage_spec.lua.
local test = require("support.harness").test
local helpers = require("support.helpers")

local eq = helpers.eq
local lua_buffer = helpers.lua_buffer
local capture_actions = helpers.capture_actions

local function code_buffer(lines)
	lua_buffer(lines)
	vim.api.nvim_buf_set_name(0, vim.fn.getcwd() .. "/nvim/tests/annotate-fixture.lua")
end

local function annotate_request(run)
	local captured = capture_actions(function()
		require("vantage").setup({})
		run()
		require("vantage.annotation_command").cancel()
	end, { annotateId = "A1" })
	eq(#captured, 1)
	eq(captured[1].type, "annotate")
	return captured[1].request
end

test("annotate defaults to the current line with a budget of one", function()
	local request = annotate_request(function()
		code_buffer({ "-- heading", "", "local total = 0", "for index = 1, 3 do", "end" })
		vim.api.nvim_win_set_cursor(0, { 3, 0 })
		require("vantage").annotate({})
	end)
	eq(request.scope, "line")
	eq(request.budget, 1)
	eq(request.lines, { { line = 3, text = "local total = 0" } })
	assert(request.path:match("nvim/tests/annotate%-fixture%.lua$"), request.path)
end)

test("buffer scope skips comments and blank lines and uses a percentage budget", function()
	local lines = { "-- comment" }
	for index = 1, 40 do
		table.insert(lines, "local v" .. index .. " = " .. index)
	end
	local request = annotate_request(function()
		code_buffer(lines)
		vim.cmd("VantageAnnotate buffer")
	end)
	eq(request.scope, "buffer")
	eq(#request.lines, 40)
	eq(request.lines[1], { line = 2, text = "local v1 = 1" })
	eq(request.budget, 6)
end)

test("a numeric argument sets the budget and an explicit range scopes the lines", function()
	local request = annotate_request(function()
		code_buffer({ "local a = 1", "local b = 2", "local c = 3", "local d = 4" })
		vim.cmd("2,3VantageAnnotate 5")
	end)
	eq(request.scope, "range")
	eq(request.budget, 5)
	eq(request.lines, { { line = 2, text = "local b = 2" }, { line = 3, text = "local c = 3" } })
end)

test("the lens rides along with the annotate request", function()
	local request = annotate_request(function()
		code_buffer({ "local a = 1" })
		require("vantage").set_lens("learning", "explain for a learner")
		require("vantage").annotate({})
		require("vantage").clear_lens()
	end)
	eq(request.lens, "explain for a learner")
end)

test("unsupported options and buffers outside the workspace send nothing", function()
	local notified
	local captured = capture_actions(function()
		require("vantage").setup({})
		notified = helpers.capture_notifications(function()
			code_buffer({ "local a = 1" })
			vim.cmd("VantageAnnotate sideways")
			lua_buffer({ "local a = 1" })
			require("vantage").annotate({})
		end)
	end)
	eq(#captured, 0)
	assert(notified[1]:find('unsupported annotation option "sideways"', 1, true), notified[1])
	assert(notified[2]:find("needs a file inside the workspace", 1, true), notified[2])
end)

-- Stubs the core's annotate calls. `holder.fire` delivers the agent's reply;
-- `holder.cancelled` lists the ids withdrawn from the extension.
local function with_annotate(holder, run)
	local core = require("vantage.review.core")
	local original_annotate, original_cancel = core.annotate, core.cancel_annotate
	holder.cancelled = {}
	core.annotate = function(_, cb, on_result)
		holder.fire = on_result
		if holder.defer_ack then
			holder.ack = function()
				cb(nil, "A1")
			end
		else
			cb(nil, "A1")
		end
	end
	core.cancel_annotate = function(id)
		table.insert(holder.cancelled, id)
	end
	local ok, err = pcall(run)
	core.annotate, core.cancel_annotate = original_annotate, original_cancel
	assert(ok, err)
end

test("the agent's blocks render above their lines; a cancelled request ignores a late reply", function()
	require("vantage").setup({})
	local annotations = require("vantage.annotations")
	local holder = {}
	with_annotate(holder, function()
		code_buffer({ "local a = 1", "local b = a + 1" })
		require("vantage").annotate({ fargs = { "buffer" } })
		holder.fire({ kind = "annotations", annotateId = "A1", path = "x", blocks = { { line = 2, text = "Adds one." } } })
		local marks = annotations.current_marks(0)
		eq(#marks, 1)
		eq(marks[1][2], 1)
		eq(marks[1][4].virt_lines[1][1][1], "Adds one.")
		eq(require("vantage.annotation_command").status().status, "rendered")
		annotations.clear(0)

		require("vantage").annotate({ fargs = { "buffer" } })
		eq(require("vantage.annotation_command").status().status, "waiting")
		require("vantage").cancel({})
		holder.fire({ kind = "annotations", annotateId = "A1", path = "x", blocks = { { line = 1, text = "Late." } } })
		eq(#annotations.current_marks(0), 0)
		eq(require("vantage.annotation_command").status().status, "cancelled")
	end)
end)

test("an unanswered annotate request times out", function()
	require("vantage").setup({ review = { annotate_timeout_ms = 20 } })
	local holder = {}
	with_annotate(holder, function()
		code_buffer({ "local a = 1" })
		require("vantage").annotate({})
		assert(vim.wait(1000, function()
			return require("vantage.annotation_command").status().status == "timed_out"
		end, 10), "expected a timeout")
	end)
	require("vantage").setup({})
end)

test("cancelling or replacing an annotate request withdraws it from the agent; an answered one is not", function()
	require("vantage").setup({})
	local holder = {}
	with_annotate(holder, function()
		code_buffer({ "local a = 1" })
		require("vantage").annotate({})
		holder.fire({ kind = "annotations", annotateId = "A1", path = "x", blocks = {} })
		eq(holder.cancelled, {})
		require("vantage").annotate({})
		require("vantage").annotate({})
		eq(holder.cancelled, { "A1" })
		require("vantage").cancel({})
		eq(holder.cancelled, { "A1", "A1" })
	end)
end)

test("an annotate request cancelled before the extension acknowledges it is withdrawn on the ack", function()
	require("vantage").setup({})
	local holder = { defer_ack = true }
	with_annotate(holder, function()
		code_buffer({ "local a = 1" })
		require("vantage").annotate({})
		require("vantage").cancel({})
		eq(holder.cancelled, {})
		holder.ack()
		eq(holder.cancelled, { "A1" })
	end)
end)

test("a timed-out annotate request is withdrawn from the agent", function()
	require("vantage").setup({ review = { annotate_timeout_ms = 20 } })
	local holder = {}
	with_annotate(holder, function()
		code_buffer({ "local a = 1" })
		require("vantage").annotate({})
		assert(vim.wait(1000, function()
			return #holder.cancelled == 1
		end, 10), "expected the timed-out request to be withdrawn")
	end)
	require("vantage").setup({})
end)
