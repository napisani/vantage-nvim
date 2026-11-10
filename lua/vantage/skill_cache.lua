-- The adjacent agent's skills, for `/skill` completion in prompt buffers.
-- Fetched once per connection; an unreachable agent yields an empty list.
local M = {}

local cached = nil
local loading = false
local waiters = {}

local function complete(skills, keep)
	cached = keep and skills or nil
	loading = false
	local callbacks = waiters
	waiters = {}
	for _, callback in ipairs(callbacks) do
		callback(skills)
	end
end

function M.list(callback)
	if cached then
		callback(cached)
		return
	end
	table.insert(waiters, callback)
	if loading then
		return
	end
	loading = true
	require("vantage.review").skills(function(err, skills)
		-- A failed lookup is not cached, so connecting later fills the list.
		complete(not err and skills or {}, not err)
	end)
end

function M.cached()
	return cached or {}
end

function M.clear()
	cached = nil
	loading = false
	waiters = {}
end

return M
