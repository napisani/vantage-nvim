-- :VantageStatus as markdown: connection, agent, counts, base and active tour.
local review = require("vantage.review")
local statuses = require("vantage.review.statuses")

local M = {}

---@param active_tour table? the tour being navigated, if any
---@return string
function M.markdown(active_tour)
	local connection = review.connection()
	local current = review.state()
	local lines = {
		"## Vantage",
		"",
		"- Connection: " .. connection.status,
		"- Workspace: " .. (connection.root or "(not connected yet)"),
	}
	if connection.socket then
		table.insert(lines, "- Socket: `" .. connection.socket .. "`")
	end
	if current then
		local agent = current.agent
		table.insert(lines, "- Agent: " .. (agent.sessionName or agent.sessionId) .. (agent.busy and " (working)" or " (idle)"))
		local counts = {}
		for _, thread in ipairs(current.threads) do
			counts[thread.status] = (counts[thread.status] or 0) + 1
		end
		local parts = {}
		for _, status in ipairs(statuses.ORDER) do
			if counts[status] then
				table.insert(parts, counts[status] .. " " .. status)
				counts[status] = nil
			end
		end
		for status, count in pairs(counts) do
			table.insert(parts, count .. " " .. status)
		end
		table.insert(lines, "- Threads: " .. (#parts > 0 and table.concat(parts, ", ") or "none"))
		if current.base then
			local target = current.base.target.kind == "worktree" and "working tree" or current.base.target.commit
			table.insert(lines, string.format("- Review base: %s (merge base %s) against %s", current.base.ref, current.base.mergeBase:sub(1, 12), target))
		else
			table.insert(lines, "- Review base: none")
		end
	end
	if active_tour then
		table.insert(lines, string.format("- Tour: %s \"%s\" (%d stops)", active_tour.kind, active_tour.title, #active_tour.stops))
	end
	return table.concat(lines, "\n")
end

return M
