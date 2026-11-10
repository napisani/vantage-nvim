-- Starts the real pi-vantage-nvim review behind a real socket (via a Node
-- host) so specs drive Vantage end to end, playing the agent themselves.
local M = {}

local HOST = vim.fn.getcwd() .. "/nvim/tests/support/extension_host.ts"
local WAIT_MS = 5000

local Host = {}
Host.__index = Host

local function wait(predicate, what)
	assert(vim.wait(WAIT_MS, predicate, 10), "timed out waiting for " .. what)
end

---A fresh git workspace with one committed file.
---@return string root canonical path
function M.workspace(files)
	local root = vim.uv.fs_realpath(vim.fn.tempname()) or vim.fn.tempname()
	vim.fn.mkdir(root, "p")
	root = vim.uv.fs_realpath(root)
	files = files or { ["src/upload.ts"] = { "function upload() {", "  let retries = 0;", "  if (retries > 3) {", "    throw new Error('x');", "  }", "}" } }
	for path, lines in pairs(files) do
		vim.fn.mkdir(vim.fn.fnamemodify(root .. "/" .. path, ":h"), "p")
		vim.fn.writefile(lines, root .. "/" .. path)
	end
	local function git(args)
		local result = vim.system(vim.list_extend({ "git", "-C", root, "-c", "user.name=t", "-c", "user.email=t@example.invalid" }, args), { text = true }):wait()
		assert(result.code == 0, result.stderr)
	end
	git({ "init", "-q", "-b", "main" })
	git({ "add", "." })
	git({ "commit", "-qm", "init" })
	return root
end

---@param root string
---@param env table? extra environment, e.g. VANTAGE_TEST_SESSION
function M.start(root, env)
	local host = setmetatable({ root = root, events = {}, buffer = "" }, Host)
	host.process = vim.system({ "node", HOST, root }, {
		stdin = true,
		env = env,
		stdout = function(_, data)
			if not data then
				return
			end
			host.buffer = host.buffer .. data
			while true do
				local newline = host.buffer:find("\n", 1, true)
				if not newline then
					break
				end
				local line = host.buffer:sub(1, newline - 1)
				host.buffer = host.buffer:sub(newline + 1)
				local ok, event = pcall(vim.json.decode, line)
				if ok then
					table.insert(host.events, event)
				end
			end
		end,
		stderr = function(_, data)
			if data and data ~= "" then
				host.stderr = (host.stderr or "") .. data
			end
		end,
	})
	wait(function()
		return host:find("ready") ~= nil
	end, "the extension host (" .. tostring(host.stderr) .. ")")
	return host
end

function Host:find(event, from)
	for index = from or 1, #self.events do
		if self.events[index].event == event then
			return self.events[index], index
		end
	end
	return nil
end

---Agent messages the extension sent so far.
function Host:messages()
	local found = {}
	for _, event in ipairs(self.events) do
		if event.event == "message" then
			table.insert(found, event)
		end
	end
	return found
end

---Waits for the `count`th agent message and returns it.
function Host:message(count)
	wait(function()
		return #self:messages() >= count
	end, "agent message " .. count)
	return self:messages()[count]
end

---Plays one agent tool call (or test op) and returns its result event.
function Host:agent(op, params)
	local before = #self.events
	self.process:write(vim.json.encode({ op = op, params = params or vim.empty_dict() }) .. "\n")
	local result
	wait(function()
		for index = before + 1, #self.events do
			if self.events[index].event == "result" and self.events[index].op == op then
				result = self.events[index]
				return true
			end
		end
		return false
	end, "result of " .. op)
	return result
end

function Host:stop()
	pcall(function()
		self.process:write(vim.json.encode({ op = "stop" }) .. "\n")
		self.process:wait(2000)
	end)
	pcall(function()
		self.process:kill(9)
	end)
end

---Waits until `predicate()` holds, failing with `what`.
M.wait = wait

return M
