-- anchor resolution after edits: extmarks, quoted text, moved
--
-- Registers into the shared harness; run via nvim/tests/vantage_spec.lua.
local test = require("support.harness").test
local helpers = require("support.helpers")

local eq = helpers.eq
local anchors = require("vantage.review.anchors")

local function workspace_file(lines)
	local root = vim.uv.fs_realpath(helpers.temp_workspace())
	helpers.writefile(root .. "/a.lua", table.concat(lines, "\n") .. "\n")
	helpers.fresh_buffer()
	vim.cmd("edit " .. root .. "/a.lua")
	return root, vim.api.nvim_get_current_buf()
end

test("an anchor follows lines inserted above it in an open buffer", function()
	local root, buf = workspace_file({ "local a = 1", "local b = a + 1", "return b" })
	local anchor = { path = "a.lua", startLine = 2, endLine = 2, side = "current", text = "local b = a + 1" }
	eq(anchors.resolve(root, "Q1", anchor).start_line, 2)
	vim.api.nvim_buf_set_lines(buf, 0, 0, false, { "-- one", "-- two" })
	local where = anchors.resolve(root, "Q1", anchor)
	eq(where.start_line, 4)
	eq(where.moved, false)
end)

test("after a reload the quoted text finds the lines again", function()
	local root = workspace_file({ "local a = 1", "local b = a + 1" })
	local anchor = { path = "a.lua", startLine = 2, endLine = 2, side = "current", text = "local b = a + 1" }
	anchors.resolve(root, "Q2", anchor)
	helpers.writefile(root .. "/a.lua", "-- header\nlocal a = 1\nlocal b = a + 1\n")
	vim.cmd("edit!")
	eq(anchors.resolve(root, "Q2", anchor).start_line, 3)
end)

test("text that is gone leaves the old lines marked as moved", function()
	local root = workspace_file({ "local a = 1", "local c = 3" })
	local where = anchors.resolve(root, "Q3", { path = "a.lua", startLine = 2, endLine = 2, side = "current", text = "local b = a + 1" })
	eq(where.start_line, 2)
	eq(where.moved, true)
end)

test("an anchor for a file nobody has open keeps its stored lines", function()
	local where = anchors.resolve("/nowhere", "Q4", { path = "x.lua", startLine = 7, endLine = 9, side = "current", text = "x" })
	eq({ where.start_line, where.end_line, where.bufnr }, { 7, 9, nil })
end)

test("anchors from context are workspace-relative with the selected text", function()
	local root = workspace_file({ "local a = 1", "local b = a + 1" })
	local params = require("vantage.context").line_range(1, 2)
	local anchor = anchors.from_context(params)
	eq(anchor, { path = "a.lua", startLine = 1, endLine = 2, side = "current", text = "local a = 1\nlocal b = a + 1" })
	eq(params.workspaceRoot, root)
end)
