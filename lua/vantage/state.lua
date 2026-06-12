local M = {}

local function plugin_root()
	local source = debug.getinfo(1, "S").source:gsub("^@", "")
	return vim.fn.fnamemodify(source, ":p:h:h:h")
end

---@class VantageBackendConfig
---@field mode? "stdio"|"development"
---@field command? string[]

---@class VantageAgentOptions
---@field apiKey? string
---@field temperature? number
---@field maxTokens? integer
---@field timeoutMs? integer
---@field maxRetries? integer
---@field maxRetryDelayMs? integer
---@field reasoning? "minimal"|"low"|"medium"|"high"|"xhigh"
---@field metadata? table<string, any>
---@field headers? table<string, string>

---@class VantageAgentTraceConfig
---@field prompt_path? string
---@field response_path? string

---@class VantageAgentAuthConfig
---@field path? string Path to a Pi OAuth auth.json file. Relative paths resolve from the workspace root in the backend.

---@class VantageAgentSessionConfig
---@field enabled? boolean
---@field max_turns? integer
---@field cacheRetention? "none"|"short"|"long"

---@class VantageAgentConfig
---@field runtime? "pi"|"development" Internal; development is for tests/local harnesses.
---@field provider? string
---@field model? string
---@field auth? VantageAgentAuthConfig
---@field options? VantageAgentOptions
---@field session? VantageAgentSessionConfig
---@field trace? VantageAgentTraceConfig

---@class VantageCommandConfig
---@field include_lens? boolean
---@field options? VantageAgentOptions

---@class VantageSearchCommandConfig: VantageCommandConfig
---@field default_prompt? string

---@class VantageAnnotateCommandConfig: VantageCommandConfig
---@field waiting_message_ms? integer

---@class VantageCommandsConfig
---@field explain? VantageCommandConfig
---@field question? VantageCommandConfig
---@field edit? VantageCommandConfig
---@field annotate? VantageAnnotateCommandConfig
---@field search? VantageSearchCommandConfig

---@class VantageAgentContextConfig
---@field enabled? boolean
---@field path? string
---@field max_bytes? integer
---@field max_age_ms? integer

---@class VantageInputOptions
---@field prompt? string
---@field default? string
---@field completion? string|function
---@field highlight? function
---@field scope? string

---@class VantageInputConfig
---@field provider? "vim.ui.input"|"ui2" Input provider for prompts. ui2 bypasses vim.ui.input overrides and uses the builtin input path.
---@field lens? VantageInputOptions
---@field question? VantageInputOptions
---@field edit? VantageInputOptions
---@field search? VantageInputOptions

---@class VantageUiConfig
---@field input? VantageInputConfig

---@class VantageConfig
---@field backend? VantageBackendConfig Advanced backend transport settings.
---@field agent? VantageAgentConfig Agent runtime and model target settings.
---@field commands? VantageCommandsConfig Command behavior and command-specific agent options.
---@field ui? VantageUiConfig UI hints passed to Neovim's standard UI APIs.
---@field agent_context? VantageAgentContextConfig

local function default_config()
	return {
		backend = {
			mode = "stdio",
			command = { "node", plugin_root() .. "/server/out/neovim/stdio-server.js" },
		},
		agent = {
			runtime = "pi",
			provider = "openai",
			model = "gpt-4o-mini",
			options = {
				temperature = 0.1,
				maxTokens = 1024,
				timeoutMs = 300000,
			},
			session = {
				enabled = true,
				max_turns = 12,
				cacheRetention = "short",
			},
		},
		commands = {
			explain = {
				include_lens = true,
				options = {},
			},
			question = {
				include_lens = false,
				options = {},
			},
			edit = {
				include_lens = false,
				options = {},
			},
			annotate = {
				include_lens = true,
				waiting_message_ms = 30000,
				options = {
					maxTokens = 256,
					timeoutMs = 300000,
				},
			},
			search = {
				include_lens = true,
				default_prompt = "Find related code paths and explain why they matter.",
				options = {},
			},
		},
		ui = {
			input = {
				provider = "vim.ui.input",
				lens = {
					prompt = "Vantage lens: ",
				},
				question = {
					prompt = "Vantage question: ",
				},
				edit = {
					prompt = "Vantage edit: ",
				},
				search = {
					prompt = "Vantage search: ",
				},
			},
		},
		agent_context = {
			enabled = true,
			path = ".vantage/agent-context.md",
			max_bytes = 12000,
			max_age_ms = nil,
		},
	}
end

M.config = default_config()

M.lens = nil

---@param config? VantageConfig
function M.setup(config)
	M.config = vim.tbl_deep_extend("force", default_config(), config or {})
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
