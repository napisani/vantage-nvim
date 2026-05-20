local M = {}

local function plugin_root()
	local source = debug.getinfo(1, "S").source:gsub("^@", "")
	return vim.fn.fnamemodify(source, ":p:h:h:h")
end

---@alias VantageProviderName "fake"|"codex"|"ollama"|"chatgpt"|"pi"

---@class VantageBackendConfig
---@field mode? "stdio"|"fake"
---@field command? string[]

---@class VantageCodexConfig
---@field command? string
---@field model? string
---@field timeout_ms? integer
---@field annotation_timeout_ms? integer
---@field trace_prompt_path? string
---@field trace_response_path? string

---@class VantageOllamaConfig
---@field base_url? string
---@field model? string
---@field timeout_ms? integer
---@field annotation_timeout_ms? integer
---@field trace_prompt_path? string
---@field trace_response_path? string

---@class VantageChatGptConfig
---@field api_key? string
---@field model? string
---@field timeout_ms? integer
---@field annotation_timeout_ms? integer
---@field trace_prompt_path? string
---@field trace_response_path? string

---@class VantagePiConfig
---@field api_key? string
---@field provider? string
---@field model? string
---@field timeout_ms? integer
---@field annotation_timeout_ms? integer
---@field trace_prompt_path? string
---@field trace_response_path? string

---@class VantageProviderConfig
---@field name? VantageProviderName
---@field codex? VantageCodexConfig
---@field ollama? VantageOllamaConfig
---@field chatgpt? VantageChatGptConfig
---@field pi? VantagePiConfig

---@class VantageAnnotationsConfig
---@field waiting_message_ms? integer

---@class VantageConfig
---@field backend? VantageBackendConfig Advanced backend transport settings.
---@field provider? VantageProviderConfig Model provider settings sent to the bundled backend.
---@field annotations? VantageAnnotationsConfig

local function default_config()
	return {
		backend = {
			mode = "stdio",
			command = { "node", plugin_root() .. "/server/out/neovim/stdio-server.js" },
		},
		provider = {
			name = "fake",
		},
		annotations = {
			waiting_message_ms = 30000,
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
