-- the composition staging buffer: append/separators, persistence, and send
--
-- Registers into the shared harness; run via nvim/tests/vantage_spec.lua.
local test = require("support.harness").test
local helpers = require("support.helpers")

local eq = helpers.eq
local composition = require("vantage.composition")
local lua_buffer = helpers.lua_buffer
local capture_notifications = helpers.capture_notifications
local prompt_buffer_mapped = helpers.prompt_buffer_mapped

---Fresh composition state: wipe any existing composition buffer so each test
---starts from "nothing staged", since the module intentionally keeps one global
---buffer alive across calls.
local function reset_composition(config)
	local vantage = require("vantage")
	local existing = require("vantage.composition").get_bufnr()
	if existing then
		pcall(vim.api.nvim_buf_delete, existing, { force = true })
	end
	lua_buffer({ "local a = 1" })
	vantage.setup(config or {})
	vantage.clear_lens()
	return vantage
end

-- Delegates to the production lookup so these tests exercise its tabpage
-- scoping rather than re-implementing a global scan that would mask it.
local function composition_win()
	local buf = composition.get_bufnr()
	if not buf then
		return nil
	end
	return require("vantage.ui.window").window_in_current_tabpage(buf)
end

test("compose_append into an empty composition sets the content", function()
	local vantage = reset_composition()

	eq(composition.is_empty(), true)
	eq(vantage.compose_append("first entry"), true)

	eq(composition.content(), "first entry")
	eq(composition.is_empty(), false)
end)

test("compose_append ignores nil and blank text", function()
	local vantage = reset_composition()

	eq(vantage.compose_append(nil), false)
	eq(vantage.compose_append(""), false)
	eq(vantage.compose_append("   \n  "), false)
	eq(composition.is_empty(), true)
end)

test("compose_append separates entries with the configured rule", function()
	local vantage = reset_composition()

	vantage.compose_append("first")
	vantage.compose_append("second")

	eq(composition.content(), "first\n\n---\n\nsecond")
end)

test("compose_append honors a configured separator", function()
	local vantage = reset_composition({ composition = { separator = "***" } })

	vantage.compose_append("first")
	vantage.compose_append("second")

	eq(composition.content(), "first\n\n***\n\nsecond")
end)

test("compose_append with separation=blank uses blank-line separation", function()
	local vantage = reset_composition()

	vantage.compose_append("@a.lua", { separation = "blank" })
	vantage.compose_append("@b.lua", { separation = "blank" })

	eq(composition.content(), "@a.lua\n\n@b.lua")
end)

test("staged content survives closing the composition window", function()
	local vantage = reset_composition()
	vantage.compose_append("do not lose me")
	vantage.compose()

	local win = composition_win()
	assert(win, "expected the composition window to be open")
	vim.api.nvim_win_close(win, false)

	-- The dotfiles predecessor used bufhidden="wipe", which destroyed the buffer
	-- (and everything staged) the moment its window closed.
	eq(composition_win(), nil)
	eq(composition.content(), "do not lose me")
end)

test("composition buffer is recoverable while hidden", function()
	local vantage = reset_composition()
	vantage.compose_append("staged")
	local buf = require("vantage.composition").get_bufnr()

	-- Appending never shows the buffer, so it is already hidden here.
	eq(composition_win(), nil)

	-- Recovery scan works only because the buffer still exists when hidden.
	eq(require("vantage.composition").get_bufnr(), buf)
	eq(composition.content(), "staged")
end)

test("compose reopens the composition buffer with its content intact", function()
	local vantage = reset_composition()
	vantage.compose_append("still here")
	vantage.compose()
	vim.api.nvim_win_close(composition_win(), false)

	vantage.compose()

	assert(composition_win(), "expected compose() to reopen the window")
	eq(composition.content(), "still here")
end)

test("compose_append stages without opening or focusing the window", function()
	local vantage = reset_composition()
	local origin = vim.api.nvim_get_current_win()

	vantage.compose_append("staged")

	-- Staging happens constantly while you work, so it must not put a split on
	-- screen or move the cursor. Visibility is the toggle's job.
	eq(vim.api.nvim_get_current_win(), origin)
	eq(composition_win(), nil)
	eq(composition.content(), "staged")
end)

test("compose toggles the window closed when it is already visible", function()
	local vantage = reset_composition()
	vantage.compose_append("staged")

	vantage.compose()
	assert(composition_win(), "expected the toggle to open the window")

	vantage.compose()
	eq(composition_win(), nil)
	-- Toggling closed only hides it; the content survives.
	eq(composition.content(), "staged")
end)

test("compose focuses the composition window", function()
	local vantage = reset_composition()
	vantage.compose_append("staged")

	vantage.compose()

	eq(vim.api.nvim_get_current_win(), composition_win())
end)

test("compose_clear empties the buffer without destroying it", function()
	local vantage = reset_composition()
	vantage.compose_append("throwaway")
	local buf = require("vantage.composition").get_bufnr()

	vantage.compose_clear()

	eq(composition.is_empty(), true)
	assert(vim.api.nvim_buf_is_valid(buf), "expected the buffer to survive clearing")
	eq(require("vantage.composition").get_bufnr(), buf)
end)

local function capture_sends(run, respond)
	local core = require("vantage.review.core")
	local original = core.send
	local sent = {}
	core.send = function(action, cb)
		table.insert(sent, action)
		if respond then
			respond(action, cb)
		else
			cb(nil, { threadId = action.type == "ask" and "Q1" or "R1" })
		end
	end
	local ok, err = pcall(run)
	core.send = original
	assert(ok, err)
	return sent
end

test("compose_send on an empty composition warns and sends nothing", function()
	local vantage = reset_composition()
	local sent = capture_sends(function()
		local notifications = capture_notifications(function()
			vantage.compose_send()
		end)
		assert(notifications[1] and notifications[1]:match("empty"), vim.inspect(notifications))
	end)
	eq(#sent, 0)
end)

test("compose_send asks which kind of thread, then sends the staged text about the workspace", function()
	local vantage = reset_composition()
	vantage.compose_append("first")
	vantage.compose_append("second")
	local offered
	local original_select = vim.ui.select
	vim.ui.select = function(items, opts, on_choice)
		offered = vim.tbl_map(opts.format_item, items)
		on_choice(items[1])
	end
	local sent = capture_sends(function()
		vantage.compose_send()
	end)
	vim.ui.select = original_select
	eq(offered, { "Ask a question", "Queue a change request", "Send a change request now" })
	eq(sent[1], { type = "ask", text = "first\n\n---\n\nsecond" })
	eq(composition.is_empty(), true)
	eq(composition_win(), nil)
end)

test("compose_send can send a change request now", function()
	local vantage = reset_composition()
	vantage.compose_append("rename the module")
	local sent = capture_sends(function()
		composition.send({ kind = "change_now" })
	end)
	eq(sent[1], { type = "request", text = "rename the module", sendNow = true })
end)

test("compose_send leaves content staged when the agent cannot be reached", function()
	local vantage = reset_composition()
	vantage.compose_append("keep me on failure")
	capture_sends(function()
		capture_notifications(function()
			composition.send({ kind = "question" })
		end)
	end, function(_, cb)
		cb("no Pi agent", nil)
	end)
	eq(composition.content(), "keep me on failure")
end)

test("compose_send only clears once the agent's extension accepts the thread", function()
	local vantage = reset_composition()
	vantage.compose_append("staged")
	local respond
	capture_sends(function()
		composition.send({ kind = "question" })
		eq(composition.content(), "staged")
		respond({ threadId = "Q1" })
	end, function(_, cb)
		respond = function(ack)
			cb(nil, ack)
		end
	end)
	eq(composition.is_empty(), true)
end)

test("compose_send respects clear_on_send and close_on_send being disabled", function()
	local vantage = reset_composition({ composition = { clear_on_send = false, close_on_send = false } })
	vantage.compose_append("persist")
	vantage.compose()
	capture_sends(function()
		composition.send({ kind = "question" })
	end)
	eq(composition.content(), "persist")
	assert(composition_win(), "expected the window to stay open")
end)

test("is_composition_buffer identifies the composition buffer only", function()
	local vantage = reset_composition()
	vantage.compose_append("staged")
	local buf = require("vantage.composition").get_bufnr()

	eq(vantage.is_composition_buffer(buf), true)
	eq(vantage.is_composition_buffer(vim.api.nvim_create_buf(false, true)), false)
	eq(vantage.is_composition_buffer(99999), false)
end)

test("composition keymaps scope send to both modes and close to normal only", function()
	local vantage = reset_composition()
	vantage.compose_append("staged")
	local buf = require("vantage.composition").get_bufnr()

	eq(prompt_buffer_mapped(buf, "n", "<C-g>"), true)
	eq(prompt_buffer_mapped(buf, "i", "<C-g>"), true)

	-- `q` must stay literal in insert mode: this is a buffer users type prose into.
	eq(prompt_buffer_mapped(buf, "n", "q"), true)
	eq(prompt_buffer_mapped(buf, "i", "q"), false)
end)

test("composition window shows a keybind hint statusline", function()
	local vantage = reset_composition()
	vantage.compose_append("staged")
	vantage.compose()

	eq(vim.api.nvim_get_option_value("statusline", { win = composition_win() }), " send <C-g>  close q ")
end)

test("composition window has no statusline hint when ui.keybind_hints is false", function()
	local vantage = reset_composition({ ui = { keybind_hints = false } })
	vantage.compose_append("staged")
	vantage.compose()

	local statusline = vim.api.nvim_get_option_value("statusline", { win = composition_win() })
	assert(not statusline:match("send"), "expected no keybind hint, got: " .. statusline)
end)

test("compose_append warns on an unknown separation and falls back to the rule", function()
	local vantage = reset_composition()
	vantage.compose_append("first")

	local notifications = capture_notifications(function()
		vantage.compose_append("second", { separation = "***" })
	end)

	-- "***" is a rule *string*, not a style: config.separator owns the text.
	assert(notifications[1] and notifications[1]:match("unknown composition separation"), vim.inspect(notifications))
	eq(composition.content(), "first\n\n---\n\nsecond")
end)

test("composition window lookup is scoped to the current tabpage", function()
	local vantage = reset_composition()
	vantage.compose_append("staged")
	vantage.compose()
	local buf = composition.get_bufnr()
	assert(composition_win(), "expected a window in this tabpage")

	vim.cmd("tabnew")
	-- The other tab's window must not be treated as this tab's.
	eq(composition_win(), nil)

	vantage.compose()
	local win = composition_win()
	assert(win, "expected compose() to open a window in the new tabpage")
	eq(vim.api.nvim_win_get_buf(win), buf)
	eq(vim.api.nvim_get_current_tabpage(), vim.api.nvim_win_get_tabpage(win))

	vim.cmd("tabclose")
end)

test("composition refresh rebinds keymaps after a later setup", function()
	local vantage = reset_composition()
	vantage.compose_append("staged")
	local buf = composition.get_bufnr()
	eq(prompt_buffer_mapped(buf, "n", "<C-g>"), true)

	vantage.setup({ ui = { composition = { keymaps = { send = "<C-s>" } } } })

	eq(prompt_buffer_mapped(buf, "n", "<C-s>"), true)
	eq(prompt_buffer_mapped(buf, "n", "<C-g>"), false)
end)

test("composition warns on exit when content is still staged", function()
	local vantage = reset_composition()
	vantage.compose_append("unsent work")

	local notifications = capture_notifications(function()
		vim.cmd("doautocmd VimLeavePre")
	end)

	assert(
		notifications[1] and notifications[1]:match("still staged"),
		"expected an exit warning, got: " .. vim.inspect(notifications)
	)
end)
