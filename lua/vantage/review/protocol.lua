-- Mirrors pi-vantage-nvim/protocol.ts: one JSON object per line over the
-- extension's Unix socket.
local M = {}

M.VERSION = 1
M.MAX_LINE_BYTES = 4 * 1024 * 1024

---@param message table
---@return string
function M.encode(message)
	message.v = M.VERSION
	return vim.json.encode(message) .. "\n"
end

---Splits buffered socket input into complete lines.
---@param buffer string
---@return string[] lines, string rest
function M.split(buffer)
	local lines = {}
	local start = 1
	while true do
		local newline = buffer:find("\n", start, true)
		if not newline then
			break
		end
		local line = buffer:sub(start, newline - 1)
		if line:match("%S") then
			table.insert(lines, line)
		end
		start = newline + 1
	end
	return lines, buffer:sub(start)
end

---@param line string
---@return table? message
---@return string? error
function M.decode(line)
	local ok, message = pcall(vim.json.decode, line, { luanil = { object = true, array = true } })
	if not ok or type(message) ~= "table" or type(message.kind) ~= "string" then
		return nil, "invalid message from the extension"
	end
	if message.v ~= M.VERSION then
		return nil, "the extension speaks protocol " .. tostring(message.v) .. "; Vantage speaks " .. M.VERSION
	end
	return message
end

---The socket directory the extension listens in; owner-only, short for macOS.
---@return string
function M.socket_directory()
	return "/tmp/vantage-pi-" .. tostring(vim.uv.getuid())
end

---The socket-name prefix for a canonical workspace root.
---@param root string
---@return string
function M.workspace_prefix(root)
	return vim.fn.sha256(root):sub(1, 16) .. "-"
end

return M
