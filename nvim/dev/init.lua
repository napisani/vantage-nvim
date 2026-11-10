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

require("vantage").setup({
	debug = { log_path = vim.g.vantage_debug_log_path },
})
