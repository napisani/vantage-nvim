-- The review core: the latest state from the agent's extension, the actions
-- that change it, and a change event. It never opens windows or places marks;
-- views read it through this API and the `User VantageReviewChanged` event.
local client = require("vantage.review.client")
local paths = require("vantage.paths")
local statuses = require("vantage.review.statuses")

local M = {}

local RECONNECT_TOTAL_MS = 30000
local RECONNECT_MAX_DELAY_MS = 5000

---@type VantageConnection?
local conn = nil
local root = nil
local remembered = nil
-- The socket of the last connection, so a Pi that switched sessions on it is recognised.
local last_socket = nil
local current = nil
-- Set by a new connection: its first state is the baseline whatever its revision,
-- because a reloaded extension rebuilds the revision from the session log.
local fresh_connection = false
local connection_status = "disconnected"
local waiters = {}
local annotate_handlers = {}
local reconnect_generation = 0

local function fire(pattern, data)
	vim.api.nvim_exec_autocmds("User", { pattern = pattern, data = data, modeline = false })
end

local function changed()
	fire("VantageReviewChanged", { revision = current and current.revision or 0, status = connection_status })
end

local function set_status(value)
	if connection_status ~= value then
		connection_status = value
		changed()
	end
end

local function drop_state()
	current = nil
	remembered = nil
	annotate_handlers = {}
	changed()
end

local function on_message(message)
	if message.kind == "state" then
		local state = message.state
		if fresh_connection or not current or state.agent.sessionId ~= current.agent.sessionId or state.revision >= current.revision then
			fresh_connection = false
			current = state
			changed()
		end
	elseif message.kind == "annotations" or message.kind == "annotateFailed" then
		local handler = annotate_handlers[message.annotateId]
		annotate_handlers[message.annotateId] = nil
		if handler then
			handler(message)
		end
	elseif message.kind == "published" then
		fire("VantageTourPublished", { tour_id = message.tourId, unrequested = message.unrequested })
	elseif message.kind == "error" then
		vim.notify("Vantage: " .. tostring(message.message), vim.log.levels.WARN)
	end
end

local function flush(err)
	local pending = waiters
	waiters = {}
	for _, cb in ipairs(pending) do
		cb(err, conn)
	end
end

local open

local function reconnect(started, delay, generation)
	vim.defer_fn(function()
		if generation ~= reconnect_generation or conn then
			return
		end
		client.discover(root, function(_, candidates)
			if generation ~= reconnect_generation or conn then
				return
			end
			local retry = function(err)
				if err then
					reconnect(started, delay, generation)
				end
			end
			for _, candidate in ipairs(candidates or {}) do
				if candidate.session_id == remembered then
					return open(candidate, retry)
				end
			end
			for _, candidate in ipairs(candidates or {}) do
				if candidate.socket == last_socket then
					-- Same Pi, new session (/new, /resume): its threads are not ours.
					drop_state()
					vim.notify("Vantage: the Pi agent moved to another session; showing its threads", vim.log.levels.INFO)
					return open(candidate, retry)
				end
			end
			if vim.uv.now() - started + delay > RECONNECT_TOTAL_MS then
				set_status("disconnected")
				drop_state()
				vim.notify("Vantage: lost the Pi agent for " .. root .. "; the next command looks for one again", vim.log.levels.WARN)
				return
			end
			reconnect(started, math.min(delay * 2, RECONNECT_MAX_DELAY_MS), generation)
		end)
	end, delay)
end

local function on_close(reason)
	-- disconnect() already cleared conn; a later connection must not be cleared here.
	if reason == "replaced" then
		return
	end
	conn = nil
	set_status("reconnecting")
	reconnect_generation = reconnect_generation + 1
	reconnect(vim.uv.now(), 250, reconnect_generation)
end

---@param candidate VantageCandidate
---@param cb fun(err: string?)
open = function(candidate, cb)
	client.connect(root, candidate, { on_message = on_message, on_close = on_close }, function(err, connection, reply)
		if err then
			if reply and reply.code == "session-changed" then
				drop_state()
			end
			return cb(err)
		end
		conn = connection
		remembered = candidate.session_id
		last_socket = candidate.socket
		fresh_connection = true
		set_status("connected")
		cb(nil)
	end)
end

local function describe(candidate)
	return string.format("pi · %s · pid %d", candidate.session_name or candidate.session_id, candidate.pid)
end

local function choose(candidates, cb)
	if #candidates == 0 then
		return cb("no Pi agent with pi-vantage-nvim is running in " .. root .. "; start pi there")
	end
	for _, candidate in ipairs(candidates) do
		if candidate.session_id == remembered then
			return cb(nil, candidate)
		end
	end
	if #candidates == 1 then
		return cb(nil, candidates[1])
	end
	vim.ui.select(candidates, { prompt = "Vantage: which Pi agent?", format_item = describe }, function(choice)
		if not choice then
			return cb("no agent chosen")
		end
		cb(nil, choice)
	end)
end

---The workspace the review belongs to: the current file's, or the connected
---one when the current buffer is not a file (a thread buffer, a picker).
---@return string
function M.workspace_root()
	local name = vim.api.nvim_buf_get_name(0)
	if root and (name == "" or name:match("^%a[%w+.-]*://") or vim.bo.buftype ~= "") then
		return root
	end
	return paths.workspace_root()
end

---Closes the connection and stops any reconnect loop. `forget` also drops the
---state, firing the change event.
---@param forget boolean
local function disconnect(forget)
	reconnect_generation = reconnect_generation + 1
	if conn then
		local old = conn
		conn = nil
		old:close("replaced")
	end
	if forget then
		drop_state()
	end
end

---Connects when needed, then calls `cb(err, conn)`.
---@param cb fun(err: string?, conn: VantageConnection?)
function M.ensure(cb)
	local wanted = M.workspace_root()
	if conn and root == wanted then
		return cb(nil, conn)
	end
	table.insert(waiters, cb)
	if #waiters > 1 then
		return
	end
	disconnect(root ~= wanted)
	root = wanted
	set_status("connecting")
	client.discover(root, function(discover_err, candidates)
		if discover_err then
			set_status("disconnected")
			return flush(discover_err)
		end
		choose(candidates or {}, function(err, candidate)
			if err then
				set_status("disconnected")
				return flush(err)
			end
			open(candidate, function(open_err)
				if open_err then
					set_status("disconnected")
				end
				flush(open_err)
			end)
		end)
	end)
end

---Discovers again and lets the user pick, even when connected.
---@param cb fun(err: string?)?
function M.connect(cb)
	disconnect(true)
	M.ensure(function(err)
		if cb then
			cb(err)
		end
	end)
end

---Sends an action, connecting first. `cb(err, ack)`.
---@param action table
---@param cb fun(err: string?, ack: table?)?
function M.send(action, cb)
	cb = cb or function() end
	M.ensure(function(err, connection)
		if err then
			return cb(err, nil)
		end
		connection:request({ kind = "action", action = action }, cb)
	end)
end

---@param cb fun(err: string?, skills: table[]?)
function M.skills(cb)
	M.ensure(function(err, connection)
		if err then
			return cb(err, nil)
		end
		connection:request({ kind = "skills" }, function(request_err, reply)
			cb(request_err, reply and reply.skills or nil)
		end)
	end)
end

---Sends an annotate request; `on_result(message)` gets the agent's blocks or a failure.
---@param request table
---@param cb fun(err: string?, annotate_id: string?)
---@param on_result fun(message: table)
function M.annotate(request, cb, on_result)
	M.send({ type = "annotate", request = request }, function(err, ack)
		if err then
			return cb(err, nil)
		end
		annotate_handlers[ack.annotateId] = on_result
		cb(nil, ack.annotateId)
	end)
end

---Stops waiting for an annotate result and asks the extension to withdraw the
---request, or tell the agent to stop if it already started.
---@param annotate_id string
function M.cancel_annotate(annotate_id)
	annotate_handlers[annotate_id] = nil
	if conn then
		conn:request({ kind = "action", action = { type = "cancelAnnotate", annotateId = annotate_id } })
	end
end

---@return table? state the latest review state, nil before connecting
function M.state()
	return current
end

---@return { status: string, root: string?, socket: string?, session_id: string?, waiting: integer }
function M.connection()
	local waiting = 0
	for _ in pairs(conn and conn.pending or {}) do
		waiting = waiting + 1
	end
	return { status = connection_status, root = root, socket = conn and conn.socket or nil, session_id = remembered, waiting = waiting }
end

---@param id string
---@return table? thread
function M.thread(id)
	for _, thread in ipairs(current and current.threads or {}) do
		if thread.id == id then
			return thread
		end
	end
	return nil
end

---@param id string
---@return table? tour
function M.tour(id)
	for _, tour in ipairs(current and current.tours or {}) do
		if tour.id == id then
			return tour
		end
	end
	return nil
end

local function first_line(text)
	local line = vim.split(text or "", "\n", { plain = true })[1] or ""
	if #line > 80 then
		line = line:sub(1, 77) .. "..."
	end
	return line
end

---@class VantageThreadEntry
---@field id string
---@field kind string
---@field status string
---@field resolved boolean
---@field path string?
---@field line integer?
---@field title string the first user message, one line
---@field text string the latest message

---Every thread as a flat entry for pickers.
---@param filter { status?: string, kind?: string, resolved?: boolean, path?: string }?
---@return VantageThreadEntry[]
function M.threads(filter)
	filter = filter or {}
	local entries = {}
	for _, thread in ipairs(current and current.threads or {}) do
		local anchor = thread.anchor
		local entry = {
			id = thread.id,
			kind = thread.kind,
			status = thread.status,
			resolved = thread.resolved == true,
			path = anchor and anchor.path or nil,
			line = anchor and anchor.startLine or nil,
			title = first_line(thread.messages[1] and thread.messages[1].text),
			text = thread.messages[#thread.messages] and thread.messages[#thread.messages].text or "",
		}
		if
			(filter.status == nil or filter.status == entry.status)
			and (filter.kind == nil or filter.kind == entry.kind)
			and (filter.resolved == nil or filter.resolved == entry.resolved)
			and (filter.path == nil or filter.path == entry.path)
		then
			table.insert(entries, entry)
		end
	end
	return entries
end

---Runs `fn(data)` on every change; returns the autocmd id.
---@param fn fun(data: table)
---@return integer
function M.on_change(fn)
	return vim.api.nvim_create_autocmd("User", {
		pattern = "VantageReviewChanged",
		callback = function(args)
			fn(args.data or {})
		end,
	})
end

---One line for a status line: connection, busy state, counts, base.
---@return string
function M.statusline()
	if connection_status ~= "connected" then
		if connection_status == "disconnected" and not current then
			return ""
		end
		return "vantage ✕ " .. connection_status
	end
	local counts = { pending = 0, sent = 0, input = 0 }
	for _, thread in ipairs(current and current.threads or {}) do
		if thread.status == "pending" then
			counts.pending = counts.pending + 1
		elseif statuses.with_agent(thread.status) then
			counts.sent = counts.sent + 1
		elseif statuses.needs_you(thread.status) and not thread.resolved then
			counts.input = counts.input + 1
		end
	end
	local parts = { (current and current.agent.busy) and "vantage ●" or "vantage ○" }
	if counts.pending > 0 then
		table.insert(parts, counts.pending .. " pending")
	end
	if counts.sent > 0 then
		table.insert(parts, counts.sent .. " sent")
	end
	if counts.input > 0 then
		table.insert(parts, counts.input .. " need you")
	end
	if current and current.base ~= vim.NIL and current.base then
		table.insert(parts, "base " .. current.base.ref)
	end
	return table.concat(parts, " · ")
end

---Closes the connection and forgets everything, as if Vantage had just loaded.
function M.reset()
	disconnect(true)
	root = nil
	last_socket = nil
	waiters = {}
	set_status("disconnected")
end

return M
