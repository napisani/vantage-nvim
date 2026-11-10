-- Public Lua API. Every user command is a thin wrapper over one of these.
local commands = require("vantage.commands")
local state = require("vantage.state")

local M = {
	CommandNames = commands.CommandNames,
}

-- Config keys from the Vantage that ran its own model. Named so a stale setup()
-- says what changed instead of silently doing nothing.
local REMOVED = {
	agent = "Vantage no longer runs a model; the adjacent Pi agent answers everything",
	backend = "there is no Node backend; Lua talks to the pi-vantage-nvim extension",
	completion = "one-shot completions were removed",
	commands = "per-command runtimes were removed",
	agent_context = "the agent context file was removed",
	last_turn = "the last-turn doc was removed",
}

local function warn_removed(config)
	local found = {}
	for key, reason in pairs(REMOVED) do
		if config[key] ~= nil then
			table.insert(found, key .. " (" .. reason .. ")")
		end
	end
	if type(config.composition) == "table" and config.composition.on_send ~= nil then
		table.insert(found, "composition.on_send (sends go to the agent as a thread)")
	end
	if #found > 0 then
		table.sort(found)
		vim.notify("Vantage: ignoring removed setup keys: " .. table.concat(found, "; "), vim.log.levels.WARN)
	end
end

function M.setup(config)
	config = config or {}
	warn_removed(config)
	state.setup(config)
	commands.register()
	-- Views register their autocmds on load, so they follow the review from the start.
	require("vantage.review.ui.signs")
	require("vantage.review.ui.thread")
	require("vantage.review.ui.sidebar")
	require("vantage.review.ui.reload")
	require("vantage.tours")
end

function M.set_lens(mode, text)
	commands.set_lens(mode, text)
end

function M.get_lens()
	return state.get_lens()
end

function M.clear_lens()
	commands.clear_lens()
end

function M.prompt_lens(mode)
	commands.prompt_lens(mode)
end

---`:VantageAsk`. A question thread on the range, visual selection or cursor
---line; `opts.workspace = true` asks about the workspace as a whole.
---`opts.args` is the inline question; without it the prompt float opens.
function M.ask(opts)
	commands.ask(opts or {})
end

---`:VantageExplain`. A preset question: explain the scoped lines.
function M.explain(opts)
	commands.explain(opts or {})
end

---`:VantageRequest`. Queues a change request; nothing reaches the agent until
---the round is sent.
function M.request(opts)
	commands.request(opts or {})
end

---`:VantageRequestNow`. A change request sent at once as its own round.
function M.request_now(opts)
	commands.request_now(opts or {})
end

---`:VantageSendRound`. Sends every pending change request in one message.
function M.send_round()
	commands.send_round()
end

---`:VantageRecallRound`. Pulls sent requests back to pending before the agent starts them.
function M.recall_round()
	commands.recall_round()
end

---`:VantageReply`. Follows up on the thread at the cursor (`opts.thread_id`
---names one), or edits it while it is still pending.
function M.reply(opts)
	commands.reply(opts or {})
end

---Edits a pending change request's text.
---@param id string
function M.edit_request(id)
	commands.edit_request(id)
end

---Deletes a pending change request.
---@param id string
function M.delete_request(id)
	commands.delete_request(id)
end

---`:VantageCancel`. Withdraws the thread's request, or tells the agent to stop
---if it already started. Never aborts the agent's turn.
function M.cancel(opts)
	commands.cancel(opts or {})
end

---`:VantageResolve`. Toggles resolved: resolved threads hide their signs.
function M.resolve(opts)
	commands.resolve(opts or {})
end

---`:VantageClearResolved`.
function M.clear_resolved()
	commands.clear_resolved()
end

---`:VantageThreadPeek`. A read-only float for the thread on the cursor line.
function M.thread_peek()
	commands.thread_peek()
end

---`:VantageThreadOpen`. Shows a thread in the bottom split.
---@param id string?
function M.thread_open(id)
	commands.thread_open(id)
end

---`:VantageThreadNext` / `:VantageThreadPrev`. Moves between threads in this buffer.
function M.thread_next()
	commands.thread_next()
end

function M.thread_prev()
	commands.thread_prev()
end

---`:VantageThreadQuickfix`. Loads a thread's answer locations into quickfix.
---@param id string?
function M.thread_refs_to_quickfix(id)
	commands.thread_refs_to_quickfix(id)
end

---Every thread as a flat entry list for a picker of your choice.
---@param filter { status?: string, kind?: string, resolved?: boolean, path?: string }?
---@return VantageThreadEntry[]
function M.threads(filter)
	return require("vantage.review").threads(filter)
end

---`:VantageThreads`. Picks a thread through vim.ui.select.
function M.pick_thread()
	commands.pick_thread()
end

---`:VantageSidebar`. Toggles the review sidebar; returns whether it is open.
---@return boolean
function M.sidebar()
	return commands.sidebar()
end

---`:VantageWalkthrough`. Asks the agent for a walkthrough, starting from the
---selected lines when there are any.
function M.walkthrough(opts)
	commands.walkthrough(opts or {})
end

---`:VantageDiffTour [base [target]] -- [prompt]`. `opts.base`, `opts.target`
---and `opts.prompt` from Lua.
function M.diff_tour(opts)
	commands.diff_tour(opts or {})
end

---`:VantageTourNext` / `:VantageTourPrev` / `:VantageTourClear`.
function M.tour_next()
	commands.tour_next()
end

function M.tour_prev()
	commands.tour_prev()
end

function M.tour_clear()
	commands.tour_clear()
end

---`:VantageReviewBase [ref [target]]`. `opts = { ref?, target? }`; the default
---ref is the default branch, the default target the working tree.
function M.set_review_base(opts)
	commands.set_review_base(opts or {})
end

---`:VantageReviewBaseClear`.
function M.clear_review_base()
	commands.clear_review_base()
end

---`:VantageReviewFiles`. Picks a file changed against the base and opens it.
function M.review_files()
	commands.review_files()
end

---`:VantageAnnotate [scope] [max]`.
function M.annotate(opts)
	commands.annotate(opts or {})
end

---`:VantageAnnotationClear`.
function M.clear_annotations()
	commands.clear_annotations()
end

---`:VantageConnect`. Finds the agent again, asking which when several run.
function M.connect()
	commands.connect()
end

---`:VantageStatus`.
function M.status()
	commands.show_status()
end

---One line for a status line, empty before the first connection.
---@return string
function M.statusline()
	return commands.statusline()
end

---`:VantageHealth`, the same as `:checkhealth vantage`.
function M.health()
	commands.health()
end

---`:VantageDebugLog`. Shows the socket frames logged to `debug.log_path`.
function M.debug_log()
	commands.debug_log()
end

---`:VantageCompose`. Toggles the composition buffer.
function M.compose()
	commands.compose()
end

---`:VantageComposeSend`. Sends the staged text as a workspace thread: a
---question or a change request, chosen when sending.
function M.compose_send()
	return commands.compose_send()
end

---`:VantageComposeClear`.
function M.compose_clear()
	commands.compose_clear()
end

function M.compose_append(text, opts)
	return require("vantage.composition").append(text, opts)
end

---Whether `buf` is Vantage's composition buffer. Use this rather than reading
---`b:vantage_composition` directly -- integrations that scope behavior to the
---composition buffer (completion sources, statusline, keymaps) should depend on
---this predicate.
---@param buf integer? defaults to the current buffer
---@return boolean
function M.is_composition_buffer(buf)
	return require("vantage.composition").is_composition_buffer(buf)
end

---Opens Vantage's floating prompt buffer to collect multi-line input, without
---issuing a request of its own. Intended for integrations that compose their
---own prompt text and then either dispatch it through another Vantage function
---(`vantage.ask({ args = text })`) or use it however they like.
---
---The submitted text is returned as typed; `@path` and `/skill` references are
---left for the agent to resolve. `opts.params.workspaceRoot` scopes history.
---`opts.title` renders a centered caption on the float's border, so a caller
---driving several distinct flows through this one surface can label them.
---`on_submit` is not called when the prompt is cancelled.
---@param opts { on_submit: fun(text: string), kind?: string, title?: string, params?: table }
---@return integer buf
---@return integer win
function M.prompt(opts)
	return require("vantage.ui.prompt_buffer").open(opts or {})
end

---Formats an `@`-reference the way Vantage's prompt buffer parses them, so
---integrations inserting references stay consistent with that contract.
---Returns nil when `spec.path` is missing or empty.
---@param spec { path: string, start_line?: integer, end_line?: integer }
---@return string? reference
function M.format_reference(spec)
	return require("vantage.ui.prompt_buffer").format_reference(spec)
end

---Recorded prompts, newest first. Defaults to every workspace; pass
---`{ workspace = root }` to scope. Exposed so integrations can build their own
---picker rather than Vantage owning one.
---@param opts { workspace?: string }?
---@return table[] entries
function M.history(opts)
	return require("vantage.history").entries(opts)
end

---`:VantageHistory`. Selects an entry, then replaces a cycle-attached buffer's
---content or yanks to the unnamed register.
function M.history_pick()
	commands.history_pick()
end

---`:VantageHistoryClearWorkspace`.
function M.history_clear_workspace()
	commands.history_clear_workspace()
end

---`:VantageHistoryClearAll`.
function M.history_clear_all()
	commands.history_clear_all()
end

---Toggles monitor mode: a live feed of workspace edits made by something other
---than this Neovim instance. Each changed file opens in the current window with
---the cursor on its first changed hunk. Because opening a file is a Vim jump,
---`<C-o>` and `<C-i>` walk the trail of recent edits natively -- monitor mode
---binds no keys of its own.
---@return boolean active
function M.monitor()
	return commands.monitor()
end

---Recently changed files in the monitor feed, newest first. Exposed so
---integrations can build their own picker rather than Vantage owning one.
---@return table[] entries
function M.monitor_entries()
	return require("vantage.monitor").entries()
end

---The line range of the visual selection that is live right now, or nil when
---not in visual mode. Exposed for integrations that need the range without a
---full context capture -- reading the `'<` / `'>` marks instead is wrong from a
---Lua-function keymap, since those marks hold the *previous* selection.
---@return integer? start_line
---@return integer? end_line
function M.visual_range()
	return require("vantage.visual").live_range()
end

---Context params for the current scope: an explicit command range, else a live
---visual selection, else the cursor line. Exposed so integrations building
---their own prompts can capture the same context Vantage's own commands use.
---@param opts table? a user-command callback's opts (range/line1/line2)
---@return table params
function M.context(opts)
	return require("vantage.context").scoped(opts or {})
end

return M
