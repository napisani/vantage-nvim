-- Command implementations: scope the request in the editor, collect text, and
-- hand it to the review core. Every function here backs a public Lua function
-- in init.lua and, where one exists, a user command.
local CommandNames = require("vantage.command_names")
local anchors = require("vantage.review.anchors")
local annotation_command = require("vantage.annotation_command")
local composition = require("vantage.composition")
local context = require("vantage.context")
local history = require("vantage.history")
local input_ui = require("vantage.input")
local monitor = require("vantage.monitor")
local paths = require("vantage.paths")
local prompt_authoring = require("vantage.prompt_authoring")
local review = require("vantage.review")
local state = require("vantage.state")
local ui = require("vantage.ui")

local M = {
	CommandNames = CommandNames,
}

local function trim(text)
	return (text or ""):gsub("^%s+", ""):gsub("%s+$", "")
end

local function report(err)
	vim.notify("Vantage: " .. tostring(err), vim.log.levels.ERROR)
end

local function lens_text()
	local lens = state.get_lens()
	return lens and lens.text or nil
end

---Notifies the outcome of a sent action; `label` names what was sent.
local function sent(label)
	return function(err, ack)
		if err then
			return report(err)
		end
		local id = ack and ack.threadId
		vim.notify("Vantage: " .. (id and (id .. " ") or "") .. label, vim.log.levels.INFO)
	end
end

local function views()
	return {
		signs = require("vantage.review.ui.signs"),
		thread = require("vantage.review.ui.thread"),
		sidebar = require("vantage.review.ui.sidebar"),
		picker = require("vantage.review.ui.picker"),
	}
end

---The thread the cursor is on: a thread buffer, a sidebar row, an anchored line,
---or the thread shown in the split.
---@return string?
function M.thread_at_cursor()
	local v = views()
	return vim.b.vantage_thread_id or v.sidebar.id_at_cursor() or v.signs.at_cursor() or v.thread.open_id()
end

---Resolves the thread a command acts on, picking one when nothing is at the cursor.
---@param opts table
---@param cb fun(id: string)
local function with_thread(opts, cb)
	local id = opts.thread_id or (opts.args and trim(opts.args) ~= "" and trim(opts.args)) or M.thread_at_cursor()
	if id then
		return cb(id)
	end
	views().picker.pick(function(entry)
		cb(entry.id)
	end)
end

local function compose(kind, opts, params, on_text)
	prompt_authoring.resolve({ kind = kind, command_opts = opts, params = params, title = opts.title, on_submit = on_text })
end

function M.ask(opts)
	opts = opts or {}
	local params = context.scoped(opts)
	local anchor = not opts.workspace and anchors.from_context(params) or nil
	compose("question", opts, params, function(text)
		review.ask({ anchor = anchor, text = text, lens = lens_text() }, sent("asked"))
	end)
end

function M.explain(opts)
	opts = opts or {}
	local params = context.scoped(opts)
	local anchor = anchors.from_context(params)
	if not anchor then
		return report("explain needs lines of a file in the workspace")
	end
	review.ask({ anchor = anchor, text = "Explain this code.", lens = lens_text(), preset = "explain" }, sent("explain requested"))
end

local function request(opts, send_now)
	opts = opts or {}
	local params = context.scoped(opts)
	local anchor = not opts.workspace and anchors.from_context(params) or nil
	compose("change", opts, params, function(text)
		review.request({ anchor = anchor, text = text, lens = lens_text(), send_now = send_now }, sent(send_now and "sent to the agent" or "queued; send the round when ready"))
	end)
end

function M.request(opts)
	request(opts, false)
end

function M.request_now(opts)
	request(opts, true)
end

function M.send_round()
	review.send_round(sent("round sent"))
end

function M.recall_round()
	review.recall_round(sent("round recalled to pending"))
end

function M.reply(opts)
	opts = opts or {}
	with_thread(opts, function(id)
		local thread = review.thread(id)
		if not thread then
			return report("no thread " .. id)
		end
		local pending = thread.status == "pending"
		local last_user
		for index = #thread.messages, 1, -1 do
			if thread.messages[index].role == "user" then
				last_user = thread.messages[index].text
				break
			end
		end
		prompt_authoring.resolve({
			kind = pending and "change" or thread.kind,
			command_opts = { args = opts.text },
			params = { workspaceRoot = review.connection().root },
			title = (pending and "Edit " or "Reply to ") .. id,
			default = pending and last_user or nil,
			on_submit = function(text)
				if pending then
					review.edit(id, text, sent("updated"))
				else
					review.follow_up(id, text, lens_text(), sent("follow-up sent"))
				end
			end,
		})
	end)
end

function M.edit_request(id)
	M.reply({ thread_id = id })
end

function M.delete_request(id)
	review.delete(id, sent("deleted"))
end

function M.cancel(opts)
	opts = opts or {}
	if not opts.thread_id and (not opts.args or trim(opts.args) == "") and not M.thread_at_cursor() and annotation_command.cancel() then
		vim.notify("Vantage: annotation request cancelled", vim.log.levels.INFO)
		return
	end
	with_thread(opts, function(id)
		review.cancel(id, sent("cancelled"))
	end)
end

function M.resolve(opts)
	opts = opts or {}
	with_thread(opts, function(id)
		local thread = review.thread(id)
		local resolved = not (thread and thread.resolved)
		review.resolve(id, resolved, sent(resolved and "resolved" or "reopened"))
	end)
end

function M.clear_resolved()
	review.clear_resolved(sent("resolved threads cleared"))
end

function M.thread_peek()
	local id = M.thread_at_cursor()
	if not id then
		return vim.notify("Vantage: no thread on this line", vim.log.levels.INFO)
	end
	views().thread.peek(id)
end

function M.thread_open(id)
	with_thread({ thread_id = id }, function(thread_id)
		views().thread.open(thread_id)
	end)
end

function M.thread_next()
	views().signs.jump(1)
end

function M.thread_prev()
	views().signs.jump(-1)
end

---Loads the locations from a thread's latest agent answer into quickfix.
function M.thread_refs_to_quickfix(id)
	with_thread({ thread_id = id }, function(thread_id)
		local thread = review.thread(thread_id)
		local root = review.connection().root
		local items = {}
		for index = #(thread and thread.messages or {}), 1, -1 do
			local message = thread.messages[index]
			if message.role == "agent" and message.refs then
				for _, ref in ipairs(message.refs) do
					table.insert(items, { filename = paths.resolve(root, ref.path), lnum = ref.startLine, end_lnum = ref.endLine, col = 1, text = ref.note or "" })
				end
				break
			end
		end
		if #items == 0 then
			return vim.notify("Vantage: " .. thread_id .. " has no code locations", vim.log.levels.INFO)
		end
		vim.fn.setqflist({}, "r", { title = "Vantage " .. thread_id, items = items })
		vim.cmd("copen")
	end)
end

function M.pick_thread()
	views().picker.pick()
end

function M.sidebar()
	return views().sidebar.toggle()
end

function M.walkthrough(opts)
	opts = opts or {}
	local params = context.selected_range(opts)
	local anchor = params and anchors.from_context(params) or nil
	compose("walkthrough", opts, params or { workspaceRoot = paths.workspace_root() }, function(text)
		review.walkthrough({ anchor = anchor, text = text, lens = lens_text() }, sent("walkthrough requested"))
	end)
end

---Splits `[base [target]] -- [prompt]` command args. `--` separates only as a
---standalone word with at most two refs before it, so a prompt may mention
---`--force` freely. A single word with no `--` is a base ref.
---@param args string
---@return string? base, string? target, string prompt
function M.parse_diff_tour_args(args)
	local refs = {}
	for word, finish in args:gmatch("(%S+)()") do
		if word == "--" then
			return refs[1], refs[2], (trim(args:sub(finish)))
		end
		if #refs == 2 then
			break
		end
		table.insert(refs, word)
	end
	if not args:find("%s") and args ~= "" then
		return args, nil, ""
	end
	return nil, nil, (trim(args))
end

function M.diff_tour(opts)
	opts = opts or {}
	local base, target, prompt = opts.base, opts.target, opts.prompt
	if opts.args then
		base, target, prompt = M.parse_diff_tour_args(opts.args)
	end
	compose("diff_tour", { args = prompt }, { workspaceRoot = paths.workspace_root() }, function(text)
		review.diff_tour({ text = text, base = base, target = target, lens = lens_text() }, sent("diff tour requested"))
	end)
end

function M.tour_next()
	require("vantage.tours").next()
end

function M.tour_prev()
	require("vantage.tours").prev()
end

function M.tour_clear()
	require("vantage.tours").clear()
end

function M.set_review_base(opts)
	opts = opts or {}
	local ref, target = opts.ref, opts.target
	if opts.fargs then
		ref, target = opts.fargs[1], opts.fargs[2]
	end
	local root = review.workspace_root()
	local base, err = require("vantage.review.git").base(root, ref, target)
	if not base then
		return report(err)
	end
	review.set_base(base, function(send_err)
		if send_err then
			return report(send_err)
		end
		vim.notify(string.format("Vantage: review base %s (%s)", base.ref, base.mergeBase:sub(1, 12)), vim.log.levels.INFO)
	end)
end

function M.clear_review_base()
	review.clear_base(sent("review base cleared"))
end

function M.review_files()
	local current = review.state()
	if not current or not current.base then
		return report("set a review base first (:VantageReviewBase)")
	end
	local root = review.connection().root
	local files, err = require("vantage.review.git").changed_files(root, current.base)
	if not files then
		return report(err)
	end
	if #files == 0 then
		return vim.notify("Vantage: no changes against " .. current.base.ref, vim.log.levels.INFO)
	end
	vim.ui.select(files, { prompt = "Changed against " .. current.base.ref, kind = "vantage_review_file" }, function(file)
		if not file then
			return
		end
		local git = require("vantage.review.git")
		local base_target = current.base.target
		if not git.is_commit(current.base.mergeBase) or (base_target.kind == "commit" and not git.is_commit(base_target.commit)) then
			return report("the review base holds an invalid commit; set it again with :VantageReviewBase")
		end
		if vim.fn.exists(":DiffviewOpen") == 2 then
			local range = current.base.mergeBase
			if current.base.target.kind == "commit" then
				range = range .. ".." .. current.base.target.commit
			end
			vim.cmd("DiffviewOpen " .. range .. " -- " .. vim.fn.fnameescape(file))
		else
			vim.cmd("edit " .. vim.fn.fnameescape(paths.resolve(root, file)))
		end
	end)
end

function M.annotate(opts)
	annotation_command.annotate(opts or {})
end

function M.clear_annotations()
	annotation_command.clear()
end

function M.connect()
	review.connect(function(err)
		if err then
			return report(err)
		end
		vim.notify("Vantage: connected to " .. (review.connection().socket or "the agent"), vim.log.levels.INFO)
	end)
end

function M.show_status()
	local markdown = require("vantage.review.ui.status").markdown(require("vantage.tours").active())
	local annotate = annotation_command.status()
	if annotate then
		markdown = markdown .. "\n- Last annotate: " .. annotate.status .. (annotate.message and (", " .. annotate.message) or "")
	end
	ui.show_markdown(markdown)
end

function M.statusline()
	return review.statusline()
end

function M.set_lens(mode, text)
	state.set_lens(mode, text)
end

local function prompt_lens(mode)
	local active_lens = state.get_lens()
	local default = active_lens and active_lens.mode == mode and active_lens.text or ""
	input_ui.prompt("lens", { default = default }, function(input)
		local text = trim(input)
		if text == "" then
			return
		end
		M.set_lens(mode, text)
	end)
end

function M.prompt_lens(mode)
	prompt_lens(mode or "general")
end

function M.clear_lens()
	state.clear_lens()
end

function M.debug_log()
	require("vantage.debug_log").open()
end

function M.health()
	vim.cmd("checkhealth vantage")
end

function M.compose()
	composition.open()
end

function M.compose_send()
	return composition.send()
end

function M.compose_clear()
	composition.clear()
end

---Whether `buf` is one of Vantage's own authoring surfaces.
---@param buf integer
---@return boolean
local function is_vantage_surface(buf)
	return require("vantage.ui.prompt_buffer").is_prompt_buffer(buf) or composition.is_composition_buffer(buf)
end

---The workspace to scope history to.
---
---Vantage's scratch surfaces stamp `b:vantage_workspace_root` with the root they
---were opened against, because resolving a root from a pathless buffer yields
---the cwd's root instead. A scoped clear run from a prompt float must not purge
---a different project's history.
---@return string
local function current_workspace()
	local buf = vim.api.nvim_get_current_buf()
	local ok, root = pcall(vim.api.nvim_buf_get_var, buf, "vantage_workspace_root")
	if ok and type(root) == "string" and root ~= "" then
		return root
	end
	return paths.workspace_root()
end

---Presents history via vim.ui.select. The chosen entry replaces a cycle-attached
---buffer's content when one is focused; otherwise it goes to the unnamed
---register, so a selection is never silently discarded.
function M.history_pick()
	local entries = history.entries({ workspace = current_workspace() })
	if #entries == 0 then
		vim.notify("Vantage: no prompt history for this workspace", vim.log.levels.INFO)
		return
	end

	local labels = {}
	for _, entry in ipairs(entries) do
		local first_line = vim.split(entry.text, "\n", { plain = true })[1] or ""
		local mark = entry.submitted and " " or "~"
		table.insert(labels, string.format("%s[%s] %s", mark, entry.kind, first_line))
	end

	vim.ui.select(labels, { prompt = "Vantage prompt history" }, function(_, index)
		if not index then
			return
		end
		local text = entries[index].text
		local buf = vim.api.nvim_get_current_buf()
		if is_vantage_surface(buf) then
			require("vantage.ui.window").replace_buffer(buf, text)
			return
		end

		vim.fn.setreg("", text)
		vim.notify("Vantage: prompt yanked to the unnamed register", vim.log.levels.INFO)
	end)
end

function M.history_clear_workspace()
	local removed = history.clear({ workspace = current_workspace() })
	vim.notify("Vantage: cleared " .. removed .. " history entr" .. (removed == 1 and "y" or "ies") .. " for this workspace", vim.log.levels.INFO)
end

function M.history_clear_all()
	local removed = history.clear()
	vim.notify("Vantage: cleared all " .. removed .. " history entr" .. (removed == 1 and "y" or "ies"), vim.log.levels.INFO)
end

---Toggles monitor mode: a live feed of workspace edits made by something other
---than this Neovim instance. Wiring lives here rather than in `monitor.lua`,
---which stays free of any knowledge of presentation or git.
---@return boolean active
function M.monitor()
	if monitor.is_active() then
		monitor.stop()
		vim.notify("Vantage monitor stopped", vim.log.levels.INFO)
		return false
	end

	local monitor_config = state.config.monitor or {}
	local root = current_workspace()

	local started = monitor.start({
		workspace = root,
		source = monitor.resolve_source(root),
		-- The built-in renderer opens the file in the current window, which Vim
		-- records as a jump -- so <C-o>/<C-i> walk recent edits with no keymaps
		-- of ours. A configured `render` replaces that wholesale.
		render = monitor_config.render or require("vantage.ui.navigate").open,
		-- Only a custom renderer can have something to tear down; opening a
		-- buffer leaves nothing behind. Same key name end to end, so grepping
		-- `on_stop` finds the whole path.
		on_stop = monitor_config.on_stop,
	})

	if started then
		vim.notify("Vantage monitor watching " .. root, vim.log.levels.INFO)
	end
	return started
end

local function command(name, fn, opts)
	pcall(vim.api.nvim_del_user_command, name)
	vim.api.nvim_create_user_command(name, fn, opts or {})
end

function M.register()
	local N = CommandNames
	command(N.set_lens, function(opts)
		local active_lens = state.get_lens()
		local mode = opts.fargs[1] or (active_lens and active_lens.mode) or "general"
		local text = trim(table.concat(vim.list_slice(opts.fargs, 2), " "))
		if text == "" then
			prompt_lens(mode)
			return
		end
		M.set_lens(mode, text)
	end, { nargs = "*" })
	command(N.clear_lens, M.clear_lens)

	command(N.ask, M.ask, { range = true, nargs = "*" })
	command(N.explain, M.explain, { range = true })
	command(N.request, M.request, { range = true, nargs = "*" })
	command(N.request_now, M.request_now, { range = true, nargs = "*" })
	command(N.send_round, M.send_round)
	command(N.recall_round, M.recall_round)
	command(N.reply, function(opts)
		M.reply({ text = opts.args ~= "" and opts.args or nil })
	end, { nargs = "*" })
	command(N.cancel, M.cancel, { nargs = "?" })
	command(N.resolve, M.resolve, { nargs = "?" })
	command(N.clear_resolved, M.clear_resolved)
	command(N.thread_peek, M.thread_peek)
	command(N.thread_open, function(opts)
		M.thread_open(opts.args ~= "" and opts.args or nil)
	end, { nargs = "?" })
	command(N.thread_next, M.thread_next)
	command(N.thread_prev, M.thread_prev)
	command(N.thread_quickfix, function(opts)
		M.thread_refs_to_quickfix(opts.args ~= "" and opts.args or nil)
	end, { nargs = "?" })
	command(N.threads, M.pick_thread)
	command(N.sidebar, function()
		M.sidebar()
	end)

	command(N.walkthrough, M.walkthrough, { range = true, nargs = "*" })
	command(N.diff_tour, M.diff_tour, { nargs = "*" })
	command(N.tour_next, M.tour_next)
	command(N.tour_prev, M.tour_prev)
	command(N.tour_clear, M.tour_clear)

	command(N.review_base, M.set_review_base, { nargs = "*" })
	command(N.review_base_clear, M.clear_review_base)
	command(N.review_files, M.review_files)

	command(N.annotate, M.annotate, { range = true, nargs = "*" })
	command(N.annotation_clear, M.clear_annotations)

	command(N.connect, M.connect)
	command(N.status, M.show_status)
	command(N.health, M.health)
	command(N.debug_log, M.debug_log)

	command(N.compose, M.compose)
	command(N.compose_send, function()
		M.compose_send()
	end)
	command(N.compose_clear, M.compose_clear)
	command(N.history, M.history_pick)
	command(N.history_clear_workspace, M.history_clear_workspace)
	command(N.history_clear_all, M.history_clear_all)
	command(N.monitor, function()
		M.monitor()
	end)
end

return M
