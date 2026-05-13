local root = vim.env.VANTAGE_NVIM_ROOT

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

if
	vim.env.VANTAGE_DEV_PROVIDER == "codex"
	or vim.env.VANTAGE_DEV_PROVIDER == "ollama"
	or vim.env.VANTAGE_DEV_PROVIDER == "chatgpt"
then
	backend = {
		mode = "stdio",
		command = { "node", root .. "/server/out/neovim/stdio-server.js" },
	}
end

require("vantage").setup({
	backend = backend,
})
