-- the floating prompt buffer, vantage.prompt, and format_reference
--
-- Registers into the shared harness; run via nvim/tests/vantage_spec.lua.
local test = require("support.harness").test
local helpers = require("support.helpers")

local eq = helpers.eq
local lua_buffer = helpers.lua_buffer
local temp_workspace = helpers.temp_workspace
local writefile = helpers.writefile
local submit_prompt_buffer = helpers.submit_prompt_buffer
local prompt_buffer_mapped = helpers.prompt_buffer_mapped
local prompt_buffer_footer_text = helpers.prompt_buffer_footer_text
local capture_actions = helpers.capture_actions

test("prompt entry points skip Markdown document setup and publish metadata before FileType", function()
	local vantage = require("vantage")
	vantage.setup({})
	lua_buffer({ "local a = 1" })

	local markdown_setups = 0
	local prompt_setups = {}
	local autocmd = vim.api.nvim_create_autocmd("FileType", {
		pattern = { "markdown", "vantage_prompt" },
		callback = function(event)
			if event.match == "markdown" then
				markdown_setups = markdown_setups + 1
			else
				table.insert(prompt_setups, {
					marked = require("vantage.ui.prompt_buffer").is_prompt_buffer(event.buf),
					kind = vim.b[event.buf].vantage_prompt_kind,
					root = vim.b[event.buf].vantage_workspace_root,
				})
			end
		end,
	})
	local ok, err = pcall(function()
		for _, method in ipairs({ "ask", "request", "prompt" }) do
			if method == "prompt" then
				vantage.prompt({ kind = "composition-entry", params = { workspaceRoot = "/workspace" } })
			else
				vantage[method]()
			end
			local ui = require("vantage.ui")
			assert(vim.api.nvim_win_is_valid(ui.last_float_win()), "expected prompt float")
			vim.api.nvim_win_close(ui.last_float_win(), true)
		end
	end)
	vim.api.nvim_del_autocmd(autocmd)
	assert(ok, err)

	eq(markdown_setups, 0)
	eq(#prompt_setups, 3)
	for _, setup in ipairs(prompt_setups) do
		eq(setup.marked, true)
		assert(type(setup.root) == "string")
	end
	eq(prompt_setups[1].kind, "question")
	eq(prompt_setups[2].kind, "change")
	eq(prompt_setups[3].kind, "composition-entry")
	eq(prompt_setups[3].root, "/workspace")
end)

test("prompt syntax highlights references without loading embedded document languages", function()
	local vantage = require("vantage")
	vantage.setup({})
	lua_buffer({ "local a = 1" })
	local buf, win = vantage.prompt({})
	vim.api.nvim_buf_set_lines(buf, 0, -1, false, { "@lua/x.lua /review /skill:review", "# Heading", "`code`" })
	vim.api.nvim_buf_call(buf, function()
		vim.cmd("runtime syntax/vantage_prompt.vim")
		eq(vim.b.current_syntax, "vantage_prompt")
		local function group(line, col)
			return vim.fn.synIDattr(vim.fn.synID(line, col, 1), "name")
		end
		eq(group(1, 1), "VantagePromptReference")
		eq(group(1, 12), "VantagePromptSkill")
		eq(group(1, 20), "VantagePromptSkill")
		eq(group(2, 1), "VantagePromptHeading")
		eq(group(3, 2), "VantagePromptCode")
	end)
	vim.api.nvim_win_close(win, true)
end)

test("the prompt footer shows the submit key, and nothing when hints are off", function()
	local vantage = require("vantage")
	capture_actions(function()
		vantage.setup({})
		lua_buffer({ "local a = 1" })
		vim.cmd("VantageAsk")
		eq(prompt_buffer_footer_text(), " submit <CR> ")
		submit_prompt_buffer("what is a?")

		vantage.setup({ ui = { keybind_hints = false } })
		vim.cmd("VantageAsk")
		eq(prompt_buffer_footer_text(), nil)
		submit_prompt_buffer("what is a?")
	end)
	vantage.setup({})
end)

test("vantage.format_reference emits the @ref syntax the prompt buffer parses", function()
	local vantage = require("vantage")

	eq(vantage.format_reference({ path = "lua/x.lua" }), "@lua/x.lua")
	eq(vantage.format_reference({ path = "lua/x.lua", start_line = 12, end_line = 40 }), "@lua/x.lua lines 12-40")
	-- Equal bounds collapse to the singular form rather than "lines 12-12".
	eq(vantage.format_reference({ path = "lua/x.lua", start_line = 12, end_line = 12 }), "@lua/x.lua line 12")
	-- A lone bound is not a range.
	eq(vantage.format_reference({ path = "lua/x.lua", start_line = 12 }), "@lua/x.lua")
	eq(vantage.format_reference({ path = "./lua/x.lua" }), "@lua/x.lua")
	eq(vantage.format_reference({ path = "" }), nil)
	eq(vantage.format_reference({}), nil)
	eq(vantage.format_reference(nil), nil)
end)

test("vantage.prompt collects multi-line input and leaves references for the agent", function()
	local vantage = require("vantage")
	local root = temp_workspace()
	writefile(root .. "/target.lua", "return 1\n")

	vantage.setup({})
	lua_buffer({ "local a = 1" })

	local submitted
	vantage.prompt({
		kind = "memo",
		params = { workspaceRoot = root },
		on_submit = function(text)
			submitted = text
		end,
	})

	submit_prompt_buffer("look at @target.lua with /skill:tdd\nsecond line")
	eq(submitted, "look at @target.lua with /skill:tdd\nsecond line")
end)

test("vantage.prompt does not invoke on_submit when cancelled", function()
	local vantage = require("vantage")
	local ui = require("vantage.ui")

	vantage.setup({})
	lua_buffer({ "local a = 1" })

	local called = false
	vantage.prompt({
		on_submit = function()
			called = true
		end,
	})

	local win = ui.last_float_win()
	vim.api.nvim_set_current_win(win)
	vim.api.nvim_feedkeys("q", "x", false)

	assert(not vim.api.nvim_win_is_valid(win), "expected the prompt to close")
	assert(not called, "expected on_submit not to run on cancel")
end)

test("vantage.prompt renders an optional title on the float border", function()
	local vantage = require("vantage")
	local ui = require("vantage.ui")

	vantage.setup({})
	lua_buffer({ "local a = 1" })

	vantage.prompt({ title = "Instruction", on_submit = function() end })

	local config = vim.api.nvim_win_get_config(ui.last_float_win())
	eq(config.title[1][1], " Instruction ")
	-- Setting a title must not clear the keybind-hint footer.
	eq(config.footer[1][1], " submit <CR> ")

	vim.api.nvim_win_close(ui.last_float_win(), true)
end)

test("Prompt buffer scopes cancel/close to normal mode so insert-mode <Esc> is not stolen", function()
	local vantage = require("vantage")
	local ui = require("vantage.ui")

	vantage.setup({})
	lua_buffer({ "local a = 1" })

	vim.cmd("VantageAsk")
	local buf = ui.last_float_buf()

	-- The bug: <Esc> was bound in insert mode too, so it closed the float
	-- instead of leaving insert mode -- making normal mode, and every
	-- normal-mode-only keymap in this buffer, unreachable.
	assert(not prompt_buffer_mapped(buf, "i", "<Esc>"), "insert-mode <Esc> must stay unmapped")
	assert(prompt_buffer_mapped(buf, "n", "<Esc>"), "normal-mode <Esc> should cancel")

	assert(not prompt_buffer_mapped(buf, "i", "q"), "q must not be mapped in insert mode")
	assert(prompt_buffer_mapped(buf, "n", "q"), "normal-mode q should abort")

	-- submit stays available from both modes; it is not an <Esc>-like key.
	assert(prompt_buffer_mapped(buf, "i", "<CR>"), "insert-mode <CR> should submit")
	assert(prompt_buffer_mapped(buf, "n", "<CR>"), "normal-mode <CR> should submit")

	vim.api.nvim_win_close(ui.last_float_win(), true)
end)

test("Prompt buffer cancels on <Esc> from normal mode", function()
	local vantage = require("vantage")
	local ui = require("vantage.ui")

	vantage.setup({})
	lua_buffer({ "local a = 1" })

	vim.cmd("VantageAsk")
	local win = ui.last_float_win()
	vim.api.nvim_set_current_win(win)

	vim.api.nvim_feedkeys(vim.api.nvim_replace_termcodes("<Esc>", true, false, true), "x", false)

	assert(not vim.api.nvim_win_is_valid(win), "expected normal-mode <Esc> to cancel the prompt")
end)

test("Prompt buffer aborts with q in normal mode", function()
	local vantage = require("vantage")
	local ui = require("vantage.ui")

	vantage.setup({})
	lua_buffer({ "local a = 1" })

	vim.cmd("VantageAsk")
	local win = ui.last_float_win()
	vim.api.nvim_set_current_win(win)

	vim.api.nvim_feedkeys("q", "x", false)

	assert(not vim.api.nvim_win_is_valid(win), "expected q in normal mode to abort the prompt")
end)

test("Prompt buffer close keymap is configurable", function()
	local vantage = require("vantage")
	local ui = require("vantage.ui")

	vantage.setup({
		ui = { prompt = { keymaps = { close = "Q" } } },
	})
	lua_buffer({ "local a = 1" })

	vim.cmd("VantageAsk")
	local win = ui.last_float_win()
	local buf = ui.last_float_buf()
	assert(prompt_buffer_mapped(buf, "n", "Q"), "expected the configured close key to be mapped")
	assert(not prompt_buffer_mapped(buf, "n", "q"), "expected the default close key to be replaced")

	vim.api.nvim_set_current_win(win)
	vim.api.nvim_feedkeys("Q", "x", false)

	assert(not vim.api.nvim_win_is_valid(win), "expected the configured close key to abort the prompt")
end)

