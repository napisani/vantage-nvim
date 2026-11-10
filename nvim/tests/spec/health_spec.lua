-- vantage.health checks and :VantageHealth
--
-- Registers into the shared harness; run via nvim/tests/vantage_spec.lua.
local test = require("support.harness").test
local helpers = require("support.helpers")

local eq = helpers.eq
local close_floating_windows = helpers.close_floating_windows

local function run_check()
	local sections, reports = {}, {}
	local original_health = vim.health
	local ok, err = pcall(function()
		local function report(level)
			return function(msg)
				table.insert(reports, { level = level, msg = msg })
			end
		end
		vim.health = { start = function(name)
			table.insert(sections, name)
		end, ok = report("ok"), warn = report("warn"), error = report("error"), info = report("info") }
		require("vantage.health").check()
	end)
	vim.health = original_health
	assert(ok, err)
	return sections, reports
end

test("health reports Neovim and whether an agent answers for the workspace", function()
	require("vantage").setup({})
	local sections, reports = run_check()
	eq(sections, { "vantage.nvim", "Adjacent Pi agent" })
	local warned = false
	for _, report in ipairs(reports) do
		assert(report.level ~= "error", report.msg)
		if report.level == "warn" and report.msg:find("No Pi agent", 1, true) then
			warned = true
		end
	end
	assert(warned, vim.inspect(reports))
end)

test("VantageHealth opens :checkhealth vantage", function()
	require("vantage").setup({})
	close_floating_windows()
	vim.cmd("silent! %bwipeout!")
	vim.cmd("VantageHealth")
	local found = false
	for _, buf in ipairs(vim.api.nvim_list_bufs()) do
		if vim.bo[buf].filetype == "checkhealth" then
			found = true
		end
	end
	assert(found, "expected a checkhealth buffer to open")
end)
