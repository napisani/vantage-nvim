-- What each thread status means to the views: its group, highlight and order.
-- The extension's reducer (pi-vantage-nvim/state.ts) owns the statuses and their
-- transitions; this is the one Lua table that mirrors them. A status it does not
-- know falls into the "Other" group, so a new one never disappears from view.
local M = {}

---@class VantageStatusGroup
---@field key string
---@field title string

---Groups in the order the sidebar lists them.
---@type VantageStatusGroup[]
M.GROUPS = {
	{ key = "pending", title = "Pending" },
	{ key = "needs_you", title = "Needs you" },
	{ key = "with_agent", title = "With the agent" },
	{ key = "answered", title = "Answered" },
	{ key = "cancelled", title = "Cancelled" },
	{ key = "other", title = "Other" },
}

local INFO = {
	pending = { group = "pending", highlight = "DiagnosticHint" },
	["needs-input"] = { group = "needs_you", highlight = "DiagnosticWarn" },
	declined = { group = "needs_you", highlight = "DiagnosticWarn" },
	failed = { group = "needs_you", highlight = "DiagnosticWarn" },
	sent = { group = "with_agent", highlight = "DiagnosticInfo" },
	working = { group = "with_agent", highlight = "DiagnosticInfo" },
	answered = { group = "answered", highlight = "DiagnosticOk" },
	done = { group = "answered", highlight = "DiagnosticOk" },
	cancelled = { group = "cancelled", highlight = "Comment" },
}

local UNKNOWN = { group = "other", highlight = "Comment" }

---Every known status, in display order.
M.ORDER = { "pending", "needs-input", "declined", "failed", "sent", "working", "answered", "done", "cancelled" }

---@param status string
---@return string group key from M.GROUPS
function M.group(status)
	return (INFO[status] or UNKNOWN).group
end

---@param status string
---@return string highlight group
function M.highlight(status)
	return (INFO[status] or UNKNOWN).highlight
end

---The agent owes a reply: the request is sent or being worked on.
---@param status string
---@return boolean
function M.with_agent(status)
	return M.group(status) == "with_agent"
end

---The user owes the next move: a question, a decline or a failure to answer.
---@param status string
---@return boolean
function M.needs_you(status)
	return M.group(status) == "needs_you"
end

return M
