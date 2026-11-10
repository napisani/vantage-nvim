-- The socket side of the review: discovery probes, one persistent connection,
-- request ids, and line framing. Knows nothing about windows or review rules.
local protocol = require("vantage.review.protocol")

local function log(direction, line)
	vim.schedule(function()
		require("vantage.debug_log").frame(direction, line)
	end)
end

local M = {}

local PROBE_TIMEOUT_MS = 2000
local CONNECT_TIMEOUT_MS = 5000

---@class VantageCandidate
---@field socket string
---@field session_id string
---@field session_name string?
---@field pid integer

---Opens a pipe, writes one line, and calls `on_line` for each line received
---until `on_line` returns true, the peer closes, or the timeout fires.
local function exchange(socket, line, timeout_ms, on_line, on_done)
	local pipe = vim.uv.new_pipe(false)
	local timer = vim.uv.new_timer()
	local finished = false
	local buffer = ""
	local function finish(err)
		if finished then
			return
		end
		finished = true
		timer:stop()
		timer:close()
		if not pipe:is_closing() then
			pipe:close()
		end
		vim.schedule(function()
			on_done(err)
		end)
	end
	timer:start(timeout_ms, 0, function()
		finish("timed out")
	end)
	pipe:connect(socket, function(connect_err)
		if connect_err then
			return finish(connect_err)
		end
		pipe:write(line)
		pipe:read_start(function(read_err, data)
			if read_err then
				return finish(read_err)
			end
			if not data then
				return finish(nil)
			end
			local lines
			lines, buffer = protocol.split(buffer .. data)
			for _, text in ipairs(lines) do
				if on_line(text) then
					return finish(nil)
				end
			end
		end)
	end)
end

-- Permission bits for group and other (0o077).
local GROUP_OR_OTHER = 63

---Whether `stat` belongs to this user with no group or other access.
local function owned_privately(stat)
	return stat.uid == vim.uv.getuid() and bit.band(stat.mode, GROUP_OR_OTHER) == 0
end

---Probes every socket for `root` and returns the live ones. Refuses a socket
---directory or socket file another user could have planted: `/tmp` is shared,
---and the directory name and workspace hash are predictable.
---@param root string canonical workspace root
---@param cb fun(err: string?, candidates: VantageCandidate[])
function M.discover(root, cb)
	local directory = protocol.socket_directory()
	local prefix = protocol.workspace_prefix(root)
	local dir_stat = vim.uv.fs_lstat(directory)
	if not dir_stat then
		return cb(nil, {})
	end
	if dir_stat.type ~= "directory" or not owned_privately(dir_stat) then
		return cb(directory .. " is not a private directory owned by you; refusing to connect to sockets in it", {})
	end
	local sockets = {}
	local handle = vim.uv.fs_scandir(directory)
	while handle do
		local name = vim.uv.fs_scandir_next(handle)
		if not name then
			break
		end
		local path = directory .. "/" .. name
		local stat = name:sub(1, #prefix) == prefix and name:match("%-%d+%.sock$") and vim.uv.fs_lstat(path)
		if stat and stat.type == "socket" and stat.uid == vim.uv.getuid() then
			table.insert(sockets, path)
		end
	end
	if #sockets == 0 then
		return cb(nil, {})
	end
	local candidates, remaining = {}, #sockets
	for _, socket in ipairs(sockets) do
		local reply
		exchange(socket, protocol.encode({ kind = "probe", workspaceRoot = root }), PROBE_TIMEOUT_MS, function(text)
			reply = protocol.decode(text)
			return true
		end, function()
			-- A crashed Pi can leave its socket file behind; it simply never answers.
			if reply and reply.kind == "probe" then
				table.insert(candidates, { socket = socket, session_id = reply.sessionId, session_name = reply.sessionName, pid = reply.pid })
			end
			remaining = remaining - 1
			if remaining == 0 then
				table.sort(candidates, function(a, b)
					return a.pid < b.pid
				end)
				cb(nil, candidates)
			end
		end)
	end
end

---@class VantageConnection
---@field socket string
---@field session_id string
---@field closed boolean
local Connection = {}
Connection.__index = Connection

---Sends a request carrying a fresh id; `cb(err, reply)` runs on its ack or error.
---@param message table
---@param cb fun(err: string?, reply: table?)?
function Connection:request(message, cb)
	if self.closed then
		if cb then
			cb("not connected to the agent", nil)
		end
		return
	end
	self.next_id = self.next_id + 1
	message.id = self.next_id
	self.pending[message.id] = cb or function() end
	local line = protocol.encode(message)
	log("out", line)
	self.pipe:write(line)
end

function Connection:close(reason)
	if self.closed then
		return
	end
	self.closed = true
	if not self.pipe:is_closing() then
		self.pipe:close()
	end
	local pending = self.pending
	self.pending = {}
	vim.schedule(function()
		for _, cb in pairs(pending) do
			cb("disconnected from the agent", nil)
		end
		self.on_close(reason)
	end)
end

function Connection:dispatch(message)
	local id = message.id
	if (message.kind == "ack" or message.kind == "skills" or message.kind == "error") and id and self.pending[id] then
		local cb = self.pending[id]
		self.pending[id] = nil
		if message.kind == "error" then
			cb(message.message, message)
		else
			cb(nil, message)
		end
		return
	end
	self.on_message(message)
end

---Opens a persistent connection. `on_message` receives state and push
---messages; `on_close(reason)` runs once when the socket goes away.
---@param root string
---@param candidate VantageCandidate
---@param handlers { on_message: fun(message: table), on_close: fun(reason: string?) }
---@param cb fun(err: string?, conn: VantageConnection?, error_message: table?)
function M.connect(root, candidate, handlers, cb)
	local pipe = vim.uv.new_pipe(false)
	local conn = setmetatable({
		pipe = pipe,
		socket = candidate.socket,
		session_id = candidate.session_id,
		next_id = 0,
		pending = {},
		closed = false,
		on_message = handlers.on_message,
		on_close = handlers.on_close,
	}, Connection)
	local ready = false
	local timer = vim.uv.new_timer()
	local function settle(err, first)
		if ready then
			return
		end
		ready = true
		timer:stop()
		timer:close()
		if err then
			conn.closed = true
			if not pipe:is_closing() then
				pipe:close()
			end
			vim.schedule(function()
				cb(err, nil, first)
			end)
			return
		end
		vim.schedule(function()
			cb(nil, conn)
			conn.on_message(first)
		end)
	end
	timer:start(CONNECT_TIMEOUT_MS, 0, function()
		settle("timed out connecting to the agent")
	end)
	local buffer = ""
	pipe:connect(candidate.socket, function(connect_err)
		if connect_err then
			return settle(connect_err)
		end
		pipe:write(protocol.encode({ kind = "hello", workspaceRoot = root, sessionId = candidate.session_id }))
		pipe:read_start(function(read_err, data)
			if read_err or not data then
				if not ready then
					return settle(read_err or "the agent closed the connection")
				end
				return conn:close(read_err or "the agent closed the connection")
			end
			buffer = buffer .. data
			if #buffer > protocol.MAX_LINE_BYTES then
				return conn:close("message too large")
			end
			local lines
			lines, buffer = protocol.split(buffer)
			for _, text in ipairs(lines) do
				log("in", text)
				local message, decode_err = protocol.decode(text)
				if not ready then
					if not message then
						return settle(decode_err)
					end
					if message.kind == "error" then
						return settle(message.message, message)
					end
					settle(nil, message)
				elseif message then
					vim.schedule(function()
						conn:dispatch(message)
					end)
				end
			end
		end)
	end)
end

return M
