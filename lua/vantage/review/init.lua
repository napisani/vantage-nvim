-- `require("vantage.review")`: the core API views and integrations build on.
-- Every action takes explicit arguments and an optional `cb(err, ack)`; reads
-- are synchronous over the latest state. See core.lua for the rest.
local core = require("vantage.review.core")

local M = setmetatable({}, { __index = core })

---What each thread status means to a view (group, highlight, order).
M.statuses = require("vantage.review.statuses")

---@param spec { anchor?: table, text: string, lens?: string, preset?: "explain" }
function M.ask(spec, cb)
	core.send({ type = "ask", anchor = spec.anchor, text = spec.text, lens = spec.lens, preset = spec.preset }, cb)
end

---@param spec { anchor?: table, text: string, lens?: string, send_now?: boolean }
function M.request(spec, cb)
	core.send({ type = "request", anchor = spec.anchor, text = spec.text, lens = spec.lens, sendNow = spec.send_now }, cb)
end

function M.edit(id, text, cb)
	core.send({ type = "edit", threadId = id, text = text }, cb)
end

function M.delete(id, cb)
	core.send({ type = "delete", threadId = id }, cb)
end

function M.follow_up(id, text, lens, cb)
	core.send({ type = "followUp", threadId = id, text = text, lens = lens }, cb)
end

function M.send_round(cb)
	core.send({ type = "sendRound" }, cb)
end

function M.recall_round(cb)
	core.send({ type = "recallRound" }, cb)
end

function M.cancel(id, cb)
	core.send({ type = "cancel", threadId = id }, cb)
end

function M.resolve(id, resolved, cb)
	core.send({ type = "resolve", threadId = id, resolved = resolved ~= false }, cb)
end

function M.clear_resolved(cb)
	core.send({ type = "clearResolved" }, cb)
end

---@param spec { anchor?: table, text: string, lens?: string }
function M.walkthrough(spec, cb)
	core.send({ type = "walkthrough", anchor = spec.anchor, text = spec.text, lens = spec.lens }, cb)
end

---@param spec { text: string, base?: string, target?: string, lens?: string }
function M.diff_tour(spec, cb)
	core.send({ type = "diffTour", text = spec.text, base = spec.base, target = spec.target, lens = spec.lens }, cb)
end

---@param kind "walkthrough"|"diffTour"|nil
function M.clear_tours(kind, cb)
	core.send({ type = "clearTours", kind = kind }, cb)
end

---@param base { ref: string, mergeBase: string, target: { kind: "worktree" } | { kind: "commit", commit: string } }
function M.set_base(base, cb)
	core.send({ type = "setBase", base = base }, cb)
end

function M.clear_base(cb)
	core.send({ type = "clearBase" }, cb)
end

return M
