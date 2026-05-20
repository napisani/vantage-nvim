local root = vim.g.vantage_nvim_root

if not root or root == "" then
	local source = debug.getinfo(1, "S").source:gsub("^@", "")
	root = vim.fn.fnamemodify(source, ":p:h:h:h")
end

vim.opt.runtimepath:prepend(root)
vim.opt.packpath:prepend(root)
vim.opt.swapfile = false
vim.opt.updatecount = 0

vim.g.loaded_vantage_nvim = true

local backend = {
	mode = "fake",
}
local provider = {
	name = "fake",
}

local dev_provider = vim.g.vantage_dev_provider
if dev_provider == "codex" or dev_provider == "ollama" or dev_provider == "chatgpt" or dev_provider == "pi" then
	backend = {
		mode = "stdio",
		command = { "node", root .. "/server/out/neovim/stdio-server.js" },
	}
	provider.name = dev_provider
end

provider.codex = {
	command = vim.g.vantage_codex_command,
	model = vim.g.vantage_codex_model,
	timeout_ms = vim.g.vantage_codex_timeout_ms,
	annotation_timeout_ms = vim.g.vantage_codex_annotation_timeout_ms,
	trace_prompt_path = vim.g.vantage_codex_trace_prompt_path,
	trace_response_path = vim.g.vantage_codex_trace_response_path,
}
provider.ollama = {
	base_url = vim.g.vantage_ollama_base_url,
	model = vim.g.vantage_ollama_model,
	timeout_ms = vim.g.vantage_ollama_timeout_ms,
	annotation_timeout_ms = vim.g.vantage_ollama_annotation_timeout_ms,
	trace_prompt_path = vim.g.vantage_ollama_trace_prompt_path,
	trace_response_path = vim.g.vantage_ollama_trace_response_path,
}
provider.chatgpt = {
	model = vim.g.vantage_chatgpt_model,
	timeout_ms = vim.g.vantage_chatgpt_timeout_ms,
	annotation_timeout_ms = vim.g.vantage_chatgpt_annotation_timeout_ms,
	trace_prompt_path = vim.g.vantage_chatgpt_trace_prompt_path,
	trace_response_path = vim.g.vantage_chatgpt_trace_response_path,
}
provider.pi = {
	provider = vim.g.vantage_pi_provider,
	model = vim.g.vantage_pi_model,
	timeout_ms = vim.g.vantage_pi_timeout_ms,
	annotation_timeout_ms = vim.g.vantage_pi_annotation_timeout_ms,
	trace_prompt_path = vim.g.vantage_pi_trace_prompt_path,
	trace_response_path = vim.g.vantage_pi_trace_response_path,
}

local function remove_empty_tables(config)
	for key, value in pairs(config) do
		if type(value) == "table" then
			remove_empty_tables(value)
			if vim.tbl_isempty(value) then
				config[key] = nil
			end
		elseif value == nil or value == "" then
			config[key] = nil
		end
	end
end

remove_empty_tables(provider)

require("vantage").setup({
	backend = backend,
	provider = provider,
})
