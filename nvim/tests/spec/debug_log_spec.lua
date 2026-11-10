-- the socket-frame debug log
--
-- Registers into the shared harness; run via nvim/tests/vantage_spec.lua.
local test = require("support.harness").test
local helpers = require("support.helpers")

local eq = helpers.eq

test("frames go to a log only you can read", function()
	local path = vim.fn.tempname()
	require("vantage").setup({ debug = { log_path = path } })
	require("vantage.debug_log").frame("in", '{"v":1,"kind":"state"}\n')
	local stat = assert(vim.uv.fs_stat(path))
	eq(bit.band(stat.mode, tonumber("777", 8)), tonumber("600", 8))
	local entry = vim.json.decode(vim.fn.readfile(path)[1])
	eq(entry.direction, "in")
	eq(entry.frame, '{"v":1,"kind":"state"}')
	require("vantage").setup({})
end)
