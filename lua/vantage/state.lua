local M = {}

---@class VantageReviewThreadKeymaps
---@field reply? string Follow up on the thread, or edit it while pending. Default "r".
---@field resolve? string Toggle resolved. Default "x".
---@field quickfix? string Load the answer's locations into quickfix. Default "Q".
---@field cancel? string Withdraw or cancel the request. Default "C".
---@field jump? string Go to the anchored code. Default "gd".
---@field close? string Close the thread split. Default "q".

---@class VantageReviewSidebarKeymaps
---@field open? string Default "<CR>".
---@field reply? string Default "r".
---@field resolve? string Default "x".
---@field edit? string Default "e".
---@field delete? string Default "dd".
---@field send? string Send the pending round. Default "S".
---@field recall? string Recall the sent round. Default "R".
---@field cancel? string Default "C".
---@field close? string Default "q".

---@class VantageReviewConfig
---@field sign_text? string Sign on anchored lines. Default "▍".
---@field thread_split_height? integer Default 15.
---@field sidebar_width? integer Default 40.
---@field annotate_timeout_ms? integer Give up on an annotate request after this long. Default 300000.
---@field keymaps? { thread?: VantageReviewThreadKeymaps, sidebar?: VantageReviewSidebarKeymaps }

---@class VantageDebugConfig
---@field log_path? string Absolute path to the NDJSON debug log file. nil = disabled.

---@class VantageInputOptions
---@field prompt? string
---@field default? string
---@field completion? string|function
---@field highlight? function
---@field scope? string

---@class VantageInputConfig
---@field provider? "vim.ui.input"|"ui2" Input provider for prompts. ui2 bypasses vim.ui.input overrides and uses the builtin input path.
---@field lens? VantageInputOptions

---@class VantageOutputActionsConfig
---@field promote? string Keymap to promote float to horizontal split.
---@field promote_vsplit? string Keymap to promote float to vertical split.

---@class VantageOutputConfig
---@field width? number
---@field height? number
---@field border? string|string[]
---@field wrap? boolean
---@field target? "popup"|"buffer"|"buffer_vsplit" Default output destination.
---@field promote_modifiable? boolean Whether promoted/direct buffers are editable.
---@field actions? VantageOutputActionsConfig Keymaps for float promotion.

---@class VantageCompositionKeymapsConfig
---@field send? string|string[] Bound in normal and insert mode.
---@field history_prev? string|string[] Cycle to an older prompt. Default <Up>.
---@field history_next? string|string[] Cycle to a newer prompt. Default <Down>.
---@field close? string|string[] Normal mode only; hides the window, content persists.

---@class VantageCompositionUiConfig
---@field height? number Fraction of editor height for the split.
---@field min_height? integer
---@field max_height? integer
---@field keymaps? VantageCompositionKeymapsConfig

---@class VantageCompositionConfig
---@field clear_on_send? boolean Empty the buffer after a successful send. Default true.
---@field close_on_send? boolean Close the window after a successful send. Default true.
---@field separator? string Rule inserted between appended entries. Default "---".

---@class VantageMonitorConfig
---@field interval_ms? integer Poll cadence in milliseconds. Default 1000.
---@field limit? integer Recent-change entries kept for cycling. Default 50.
---@field self_write_grace_ms? integer Changes to a path this instance wrote within this window are ignored, so your own `:w` never appears in the feed. Default 2000.
---@field poll_timeout_ms? integer How long an unanswered poll may run before it is killed and a fresh one allowed. Default 30000. A poll already in flight always suppresses the next tick, so this only rescues a poll that will never answer.
---@field warn_cooldown_ms? integer How long before a repeated warning of the same kind is announced again. Default 300000 (5 minutes). Suppresses notification storms without letting recurring degradation go silent forever.
---@field source? fun(root: string): table Change-detection seam. Must return `{ poll = fun(cb) }`, optionally with `first_hunk = fun(path, cb)`. Defaults to the git adapter in monitor_source.lua.
---@field render? fun(context: VantageMonitorRenderContext) Presentation seam. Replaces the built-in "open the file" behavior wholesale -- this is how a diff view stays config-supplied and diff-plugin agnostic.
---@field on_stop? fun() Called when the mode stops. Only needed by a custom `render` that opened something it must close; the built-in renderer has nothing to tear down.

---@class VantageMonitorRenderContext
---@field path string Absolute path to the changed file.
---@field status string Two-character `git status --porcelain` code.
---@field workspace string Workspace root being watched.
---@field line integer? First changed line, nil when unknown or not applicable.
---@field deleted boolean The path no longer exists on disk.

---@class VantageHistoryConfig
---@field enabled? boolean Record and cycle prompt history. Default true.
---@field limit? integer Entries kept. Default 50.
---@field max_entry_bytes? integer Entries larger than this are skipped, never truncated. Default 1 MiB.
---@field path? string NDJSON file. Defaults under stdpath("state") so prompt text never lands in a project repo.

---@class VantagePromptKeymapsConfig
---@field submit? string|string[]
---@field history_prev? string|string[] Cycle to an older prompt. Default <Up>.
---@field history_next? string|string[] Cycle to a newer prompt. Default <Down>.
---@field cancel? string|string[] Normal mode only, so <Esc> still leaves insert mode.
---@field close? string|string[] Normal mode only; second way to abort, defaults to `q`.

---@class VantagePromptConfig
---@field keymaps? VantagePromptKeymapsConfig

---@class VantageUiConfig
---@field input? VantageInputConfig
---@field output? VantageOutputConfig
---@field prompt? VantagePromptConfig
---@field composition? VantageCompositionUiConfig

---@class VantageConfig
---@field review? VantageReviewConfig Threads, the sidebar, and annotate timing.
---@field composition? VantageCompositionConfig Staging-buffer behavior.
---@field history? VantageHistoryConfig Prompt history recording and cycling.
---@field monitor? VantageMonitorConfig Monitor-mode change detection and presentation.
---@field ui? VantageUiConfig UI hints passed to Neovim's standard UI APIs.
---@field debug? VantageDebugConfig

local function default_config()
	return {
		review = {
			sign_text = "▍",
			thread_split_height = 15,
			sidebar_width = 40,
			annotate_timeout_ms = 300000,
			keymaps = {
				thread = {},
				sidebar = {},
			},
		},
		composition = {
			clear_on_send = true,
			close_on_send = true,
			separator = "---",
		},
		history = {
			enabled = true,
			limit = 50,
			max_entry_bytes = 1048576,
			-- User-global on purpose: `.vantage/` is git-ignored per artifact in
			-- consumer repos, so a workspace-scoped file would be committable.
			path = vim.fn.stdpath("state") .. "/vantage/prompt-history.ndjson",
		},
		monitor = {
			interval_ms = 1000,
			limit = 50,
			self_write_grace_ms = 2000,
			poll_timeout_ms = 30000,
			warn_cooldown_ms = 300000,
			-- nil = the git adapter / the built-in renderer that opens each
			-- changed file in the current window. Both are seams so consumers can
			-- swap detection or presentation without a fork.
			source = nil,
			render = nil,
			on_stop = nil,
		},
		ui = {
			keybind_hints = true,
			output = {
				width = 0.82,
				height = 0.72,
				border = "rounded",
				wrap = true,
				target = "popup",
				promote_modifiable = false,
				actions = {
					promote = '<leader>"',
					promote_vsplit = "<leader>%",
				},
			},
			composition = {
				height = 0.32,
				min_height = 10,
				max_height = 32,
				keymaps = {
					send = "<C-g>",
					close = "q",
					history_prev = "<Up>",
					history_next = "<Down>",
				},
			},
			prompt = {
				keymaps = {
					submit = "<CR>",
					cancel = "<Esc>",
					close = "q",
					history_prev = "<Up>",
					history_next = "<Down>",
				},
			},
			input = {
				provider = "vim.ui.input",
				lens = {
					prompt = "Vantage lens: ",
				},
			},
		},
		debug = {
			log_path = nil,
		},
	}
end

M.config = default_config()

M.lens = nil

---@param config? VantageConfig
function M.setup(config)
	M.config = vim.tbl_deep_extend("force", default_config(), config or {})
	-- The composition buffer outlives setup(), so its keymaps and hints must be
	-- re-derived from the new config rather than frozen at creation time.
	pcall(function()
		require("vantage.composition").refresh()
	end)
	-- History's store adapter and loaded ring latch for the process lifetime,
	-- so a second setup() with a different history.path would keep writing to
	-- the old file.
	pcall(function()
		require("vantage.history").reset()
	end)
	if not M.config.debug or not M.config.debug.log_path then
		if vim.g.vantage_debug_log_path then
			M.config.debug = M.config.debug or {}
			M.config.debug.log_path = vim.g.vantage_debug_log_path
		end
	end
end

function M.set_lens(mode, text)
	M.lens = { mode = mode, text = text }
end

function M.get_lens()
	return M.lens
end

function M.clear_lens()
	M.lens = nil
end

return M
