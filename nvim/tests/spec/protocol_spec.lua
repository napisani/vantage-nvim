-- the socket protocol helpers shared with pi-vantage-nvim
--
-- Registers into the shared harness; run via nvim/tests/vantage_spec.lua.
local test = require("support.harness").test
local helpers = require("support.helpers")

local eq = helpers.eq
local protocol = require("vantage.review.protocol")

test("lines split on newlines, keeping a partial tail for the next read", function()
	local lines, rest = protocol.split('{"a":1}\n{"b":2}\n{"c"')
	eq(lines, { '{"a":1}', '{"b":2}' })
	eq(rest, '{"c"')
	lines, rest = protocol.split(rest .. ":3}\n")
	eq(lines, { '{"c":3}' })
	eq(rest, "")
end)

test("encode stamps the protocol version and ends the line", function()
	local line = protocol.encode({ kind = "probe", workspaceRoot = "/w" })
	eq(line:sub(-1), "\n")
	eq(vim.json.decode(line).v, protocol.VERSION)
end)

test("decode rejects other versions and non-messages", function()
	local message = protocol.decode('{"v":1,"kind":"state","state":{"base":null}}')
	eq(message.kind, "state")
	eq(message.state.base, nil)
	local _, err = protocol.decode('{"v":2,"kind":"state"}')
	assert(err and err:find("protocol 2", 1, true), err)
	_, err = protocol.decode("not json")
	assert(err, "expected an error")
end)

test("socket names hash the canonical workspace root like the extension does", function()
	-- sha256("/tmp/ws") first 16 hex digits, as pi-vantage-nvim/server.ts computes them.
	eq(protocol.workspace_prefix("/tmp/ws"), vim.fn.sha256("/tmp/ws"):sub(1, 16) .. "-")
	eq(protocol.socket_directory(), "/tmp/vantage-pi-" .. vim.uv.getuid())
end)
