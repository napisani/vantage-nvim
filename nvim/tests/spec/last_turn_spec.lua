-- opening the adjacent agent's last-turn doc
--
-- Registers into the shared harness; run via nvim/tests/vantage_spec.lua.
local test = require("support.harness").test
local helpers = require("support.helpers")

local eq = helpers.eq
local fresh_buffer = helpers.fresh_buffer
local temp_workspace = helpers.temp_workspace
local normalized_path = helpers.normalized_path
local set_buffer_path = helpers.set_buffer_path
local writefile = helpers.writefile
local capture_notifications = helpers.capture_notifications

local function enter_workspace(config)
	require("vantage").setup(vim.tbl_extend("force", { backend = { mode = "development" } }, config or {}))
	fresh_buffer()
	local root = temp_workspace()
	set_buffer_path(root .. "/scratch.lua")
	return root
end

test("VantageLastTurn opens the last-turn doc as an editable, autoread buffer", function()
	local root = enter_workspace()
	local path = root .. "/.vantage/last-turn.md"
	writefile(path, "# Plan\n\n1. Do the thing.\n")

	vim.cmd("VantageLastTurn")

	local bufnr = vim.api.nvim_get_current_buf()
	eq(normalized_path(vim.api.nvim_buf_get_name(bufnr)), normalized_path(path))
	eq(vim.api.nvim_buf_get_lines(bufnr, 0, -1, false), { "# Plan", "", "1. Do the thing." })
	eq(vim.bo[bufnr].modifiable, true)
	eq(vim.bo[bufnr].autoread, true)
end)

test("open_last_turn returns nil and points at the skill when the doc is missing", function()
	enter_workspace()
	local before = vim.api.nvim_get_current_buf()

	local opened
	local notifications = capture_notifications(function()
		opened = require("vantage").open_last_turn()
	end)

	eq(opened, nil)
	eq(vim.api.nvim_get_current_buf(), before)
	assert(notifications[1]:find("/vantage-last-turn-to-doc", 1, true), vim.inspect(notifications))
end)

test("open_last_turn honors last_turn.path", function()
	local root = enter_workspace({ last_turn = { path = "notes/turn.md" } })
	vim.fn.mkdir(root .. "/notes", "p")
	writefile(root .. "/notes/turn.md", "custom\n")

	local bufnr = require("vantage").open_last_turn()

	eq(normalized_path(vim.api.nvim_buf_get_name(bufnr)), normalized_path(root .. "/notes/turn.md"))
end)
