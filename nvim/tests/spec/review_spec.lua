-- End to end against the real extension: Vantage commands in, agent messages
-- out, scripted agent replies back into Neovim state and views.
local extension = require("support.extension")
local harness = require("support.harness")
local helpers = require("support.helpers")

local test = harness.test
local eq = helpers.eq
local wait = extension.wait

local function fresh()
	helpers.close_floating_windows()
	vim.cmd("silent! only")
	vim.cmd("silent! %bwipeout!")
	require("vantage.review").reset()
	require("vantage").setup({})
	require("vantage").clear_lens()
end

local function with_host(run, files, env)
	fresh()
	local root = extension.workspace(files)
	local host = extension.start(root, env)
	local ok, err = pcall(run, host, root)
	-- Let acks already on the wire land, so stopping the host fails no request.
	vim.wait(1000, function()
		return require("vantage.review").connection().waiting == 0
	end, 10)
	host:stop()
	require("vantage.review").reset()
	assert(ok, err)
end

local function open_file(root, path, line)
	vim.cmd("edit " .. vim.fn.fnameescape(root .. "/" .. path))
	vim.api.nvim_win_set_cursor(0, { line or 1, 0 })
end

local function state()
	return require("vantage.review").state()
end

local function thread(id)
	return require("vantage.review").thread(id)
end

test("ask sends the anchored question and the agent's answer reaches the thread, signs and thread view", function()
	with_host(function(host, root)
		open_file(root, "src/upload.ts", 3)
		require("vantage").ask({ args = "why retried?" })
		local message = host:message(1)
		assert(message.content:match("^Vantage · question Q1 about src/upload%.ts:3 %(current code%)"), message.content)
		assert(message.content:find("| %s*if %(retries > 3%) {") ~= nil, message.content)
		eq(message.details.ids, { "Q1" })
		wait(function()
			return thread("Q1") ~= nil
		end, "Q1 in state")
		local result = host:agent("answer", { threadId = "Q1", text = "The lock can race.", refs = { { path = "src/upload.ts", startLine = 2, endLine = 2, note = "counter" } } })
		assert(result.ok, result.error)
		wait(function()
			return thread("Q1").status == "answered"
		end, "answered")
		local marks = vim.api.nvim_buf_get_extmarks(0, vim.api.nvim_get_namespaces().vantage_review_signs, 0, -1, { details = true })
		eq(#marks, 1)
		eq(marks[1][2], 2)
		assert(marks[1][4].virt_text[1][1]:match("^Q1 answered: The lock can race%."), vim.inspect(marks[1][4].virt_text))
		local buf = require("vantage.review.ui.thread").open("Q1")
		local text = table.concat(vim.api.nvim_buf_get_lines(buf, 0, -1, false), "\n")
		assert(text:find("## agent", 1, true) and text:find("The lock can race.", 1, true), text)
		assert(text:find("- src/upload.ts:2 · counter", 1, true), text)
		eq(vim.bo[buf].modifiable, false)
		require("vantage").thread_refs_to_quickfix("Q1")
		eq(vim.fn.getqflist()[1].lnum, 2)
		vim.cmd("cclose")
	end)
end)

test("without an agent for the workspace, commands say how to start one", function()
	fresh()
	local root = extension.workspace()
	open_file(root, "src/upload.ts", 1)
	local notified = helpers.capture_notifications(function(notifications)
		require("vantage").ask({ args = "anyone?" })
		wait(function()
			return #notifications > 0
		end, "a notification")
	end)
	assert(notified[1]:find("no Pi agent with pi%-vantage%-nvim is running in"), notified[1])
	eq(require("vantage.review").connection().status, "disconnected")
end)

test("change requests queue, go out as one round, and come back with outcomes", function()
	with_host(function(host, root)
		open_file(root, "src/upload.ts", 3)
		require("vantage").request({ args = "use backoff" })
		require("vantage").request({ args = "rename the module", workspace = true })
		wait(function()
			return thread("R2") ~= nil
		end, "R2")
		eq(#host:messages(), 0)
		eq(require("vantage").statusline(), "vantage ○ · 2 pending")
		require("vantage").send_round()
		local message = host:message(1)
		assert(message.content:match("^Vantage · change requests, round 1"), message.content)
		eq(message.details.ids, { "R1", "R2" })
		local missing = host:agent("requestUpdate", { updates = { { requestId = "R1", status = "done", reply = "done" } } })
		assert(not missing.ok and missing.error:find("missing R2"), vim.inspect(missing))
		assert(host:agent("requestUpdate", {
			updates = {
				{ requestId = "R1", status = "done", reply = "Added backoff." },
				{ requestId = "R2", status = "needs-input", reply = "Which module?" },
			},
		}).ok)
		wait(function()
			return thread("R2").status == "needs-input"
		end, "outcomes")
		eq(thread("R1").status, "done")
		eq(require("vantage").statusline(), "vantage ○ · 1 need you")
	end)
end)

test("request now sends only that request; cancel withdraws a queued one", function()
	with_host(function(host, root)
		open_file(root, "src/upload.ts", 1)
		require("vantage").request({ args = "queued" })
		require("vantage").request_now({ args = "urgent" })
		local message = host:message(1)
		eq(message.details.ids, { "R2" })
		require("vantage").cancel({ thread_id = "R2" })
		wait(function()
			return thread("R2").status == "cancelled"
		end, "cancelled")
		eq(thread("R1").status, "pending")
		eq(#host:messages(), 1)
	end)
end)

test("the sidebar groups threads by status and opens one in the bottom split", function()
	with_host(function(_, root)
		open_file(root, "src/upload.ts", 3)
		require("vantage").request({ args = "use backoff" })
		require("vantage").ask({ args = "why?" })
		wait(function()
			return thread("Q1") ~= nil
		end, "Q1")
		eq(require("vantage").sidebar(), true)
		local lines = vim.api.nvim_buf_get_lines(0, 0, -1, false)
		local text = table.concat(lines, "\n")
		assert(text:find("Pending (1)", 1, true) and text:find("With the agent (1)", 1, true), text)
		for index, line in ipairs(lines) do
			if line:find("R1", 1, true) then
				vim.api.nvim_win_set_cursor(0, { index, 0 })
			end
		end
		eq(require("vantage.review.ui.sidebar").id_at_cursor(), "R1")
		vim.api.nvim_feedkeys(vim.api.nvim_replace_termcodes("<CR>", true, false, true), "x", false)
		eq(require("vantage.review.ui.thread").open_id(), "R1")
		eq(vim.api.nvim_buf_get_name(0):match("vantage://review$") ~= nil, true)
		require("vantage").sidebar()
		require("vantage.review.ui.thread").close()
	end)
end)

test("a walkthrough the agent publishes on its own is announced and loads on tour next", function()
	with_host(function(host, root)
		open_file(root, "src/upload.ts", 1)
		require("vantage.review").ensure(function() end)
		wait(function()
			return state() ~= nil
		end, "connected")
		local notified = helpers.capture_notifications(function(notifications)
			local result = host:agent("walkthrough", {
				title = "Upload flow",
				summary = "Where retries happen.",
				stops = {
					{ ref = { path = "src/upload.ts", startLine = 2, endLine = 2, side = "current" }, title = "Counter", note = "Starts at zero." },
					{ ref = { path = "src/upload.ts", startLine = 3, endLine = 5, side = "current" }, title = "Limit", note = "Gives up after three." },
				},
			})
			assert(result.ok, result.error)
			wait(function()
				for _, message in ipairs(notifications) do
					if message:find("new walkthrough from the agent", 1, true) then
						return true
					end
				end
				return false
			end, "announcement")
		end)
		assert(#notified > 0)
		require("vantage").tour_next()
		local qf = vim.fn.getqflist({ title = 1, items = 1 })
		eq(qf.title, "Vantage walkthrough: Upload flow")
		eq(#qf.items, 2)
		eq(qf.items[1].text, "Counter: Starts at zero.")
		vim.cmd("cclose")
	end)
end)

test("annotate sends candidate lines with a budget and draws the agent's blocks", function()
	with_host(function(host, root)
		open_file(root, "src/upload.ts", 1)
		require("vantage").annotate({ fargs = { "buffer" } })
		local message = host:message(1)
		assert(message.content:match("^Vantage · annotate A1 in src/upload%.ts %(buffer%)"), message.content)
		assert(message.content:find("at most 3 annotations", 1, true), message.content)
		local bad = host:agent("annotate", { annotateId = "A1", blocks = { { line = 99, text = "nope" } } })
		assert(not bad.ok)
		assert(host:agent("annotate", { annotateId = "A1", blocks = { { line = 3, text = "Retries stop here." } } }).ok)
		local ns = vim.api.nvim_get_namespaces().vantage_annotations
		wait(function()
			return #vim.api.nvim_buf_get_extmarks(0, ns, 0, -1, {}) == 1
		end, "annotation block")
		local mark = vim.api.nvim_buf_get_extmarks(0, ns, 0, -1, { details = true })[1]
		eq(mark[2], 2)
		eq(mark[4].virt_lines[1][1][1], "Retries stop here.")
		eq(#state().threads, 0)
	end)
end)

test("diff tour requests carry typed refs and the review base adds the diff to messages", function()
	with_host(function(host, root)
		open_file(root, "src/upload.ts", 1)
		require("vantage").set_review_base({ ref = "main" })
		wait(function()
			return state() and state().base ~= nil
		end, "base")
		eq(state().base.ref, "main")
		eq(state().base.target.kind, "worktree")
		require("vantage").diff_tour({ args = "main -- walk me through it" })
		local message = host:message(1)
		assert(message.content:match("^Vantage · diff tour T1"), message.content)
		assert(message.content:find("Compare main against the working tree, as the user asked.", 1, true), message.content)
		assert(message.content:find("Diff: git diff " .. state().base.mergeBase, 1, true), message.content)
	end)
end)

test("compose send asks the agent about the workspace", function()
	with_host(function(host, root)
		open_file(root, "src/upload.ts", 1)
		require("vantage").compose_append("Compare @src/upload.ts with /skill:tdd")
		require("vantage.composition").send({ kind = "question" })
		local message = host:message(1)
		assert(message.content:find("about the workspace as a whole", 1, true), message.content)
		assert(message.content:find("Question: Compare @src/upload.ts with /skill:tdd", 1, true), message.content)
	end)
end)

test("skills come from the agent", function()
	with_host(function(_, root)
		open_file(root, "src/upload.ts", 1)
		local skills
		require("vantage.review").skills(function(_, found)
			skills = found
		end)
		wait(function()
			return skills ~= nil
		end, "skills")
		eq(skills[1].name, "tdd")
	end)
end)

test("a different Pi session on reconnect drops the old threads", function()
	fresh()
	local root = extension.workspace()
	local host = extension.start(root, { VANTAGE_TEST_SESSION = "session-1" })
	open_file(root, "src/upload.ts", 1)
	require("vantage").ask({ args = "why?" })
	wait(function()
		return thread("Q1") ~= nil and require("vantage.review").connection().waiting == 0
	end, "Q1")
	host:stop()
	local next_host = extension.start(root, { VANTAGE_TEST_SESSION = "session-2" })
	local ok, err = pcall(function()
		wait(function()
			return require("vantage.review").connection().status == "reconnecting"
		end, "reconnecting")
		-- The new session never matches, so the next command starts fresh.
		require("vantage.review").reset()
		require("vantage").ask({ args = "again" })
		wait(function()
			return thread("Q1") ~= nil and state().agent.sessionId == "session-2" and require("vantage.review").connection().waiting == 0
		end, "new session")
		eq(#state().threads, 1)
	end)
	next_host:stop()
	require("vantage.review").reset()
	assert(ok, err)
end)

test("after Pi reloads the same session, Neovim takes the reloaded state whatever its revision", function()
	fresh()
	local root = extension.workspace()
	local host = extension.start(root, { VANTAGE_TEST_SESSION = "session-1" })
	open_file(root, "src/upload.ts", 1)
	require("vantage").ask({ args = "why?" })
	wait(function()
		return thread("Q1") ~= nil and require("vantage.review").connection().waiting == 0
	end, "Q1")
	-- Busy changes raise the live revision but never reach the session log.
	host:agent("busy", true)
	host:agent("busy", false)
	wait(function()
		return state().revision >= 4
	end, "busy revisions")
	host:stop()
	local reloaded = extension.start(root, { VANTAGE_TEST_SESSION = "session-1" })
	local ok, err = pcall(function()
		wait(function()
			local current = state()
			return require("vantage.review").connection().status == "connected" and current ~= nil and #current.threads == 0
		end, "the reloaded state")
		require("vantage").ask({ args = "again" })
		wait(function()
			return thread("Q1") ~= nil and thread("Q1").messages[1].text == "again"
		end, "updates after the reload")
	end)
	reloaded:stop()
	require("vantage.review").reset()
	assert(ok, err)
end)

test("when Pi moves to a new session on the same socket, Neovim follows it", function()
	with_host(function(host, root)
		open_file(root, "src/upload.ts", 1)
		require("vantage").ask({ args = "why?" })
		wait(function()
			return thread("Q1") ~= nil and require("vantage.review").connection().waiting == 0
		end, "Q1")
		local result = host:agent("switchSession", "session-2")
		assert(result.ok, result.error)
		wait(function()
			local current = state()
			return current ~= nil and current.agent.sessionId == "session-2"
		end, "the new session")
		eq(#state().threads, 0)
		eq(require("vantage.review").connection().status, "connected")
	end)
end)

test("when the agent reports a change request done, unmodified buffers reload from disk", function()
	with_host(function(host, root)
		open_file(root, "src/upload.ts", 3)
		require("vantage").request_now({ args = "use backoff" })
		host:message(1)
		vim.fn.writefile({ "function upload() {", "  backoff();", "}" }, root .. "/src/upload.ts")
		assert(host:agent("requestUpdate", { updates = { { requestId = "R1", status = "done", reply = "Added backoff." } } }).ok)
		wait(function()
			return vim.api.nvim_buf_get_lines(0, 1, 2, false)[1] == "  backoff();"
		end, "the buffer to reload")
	end)
end)

test("a declined request counts as needing you in the statusline, like the sidebar", function()
	with_host(function(host, root)
		open_file(root, "src/upload.ts", 1)
		require("vantage").request_now({ args = "rename it" })
		host:message(1)
		assert(host:agent("requestUpdate", { updates = { { requestId = "R1", status = "declined", reply = "Breaks callers." } } }).ok)
		wait(function()
			return thread("R1").status == "declined"
		end, "declined")
		eq(require("vantage").statusline(), "vantage ○ · 1 need you")
	end)
end)

test("discovery refuses a socket directory other users can reach", function()
	fresh()
	local protocol = require("vantage.review.protocol")
	local original = protocol.socket_directory
	local directory = vim.fn.tempname()
	vim.fn.mkdir(directory, "p", tonumber("755", 8))
	protocol.socket_directory = function()
		return directory
	end
	local result
	local ok, err = pcall(function()
		require("vantage.review.client").discover("/tmp/anywhere", function(discover_err, candidates)
			result = { err = discover_err, candidates = candidates }
		end)
		eq(result.candidates, {})
		assert(result.err and result.err:find("not a private directory owned by you", 1, true), vim.inspect(result))
		vim.uv.fs_chmod(directory, tonumber("700", 8))
		require("vantage.review.client").discover("/tmp/anywhere", function(discover_err, candidates)
			result = { err = discover_err, candidates = candidates }
		end)
		eq(result, { candidates = {} })
	end)
	protocol.socket_directory = original
	assert(ok, err)
end)

test("the review core opens no windows", function()
	with_host(function(_, root)
		open_file(root, "src/upload.ts", 1)
		local original = vim.api.nvim_open_win
		vim.api.nvim_open_win = function()
			error("core opened a window")
		end
		local ok, err = pcall(function()
			local review = require("vantage.review")
			local done
			review.ask({ text = "headless?" }, function(e)
				done = e or true
			end)
			wait(function()
				return done ~= nil
			end, "ack")
			eq(done, true)
			eq(#review.threads(), 1)
		end)
		vim.api.nvim_open_win = original
		assert(ok, err)
	end)
end)
