if vim.g.loaded_learn_nvim then
	return
end

vim.g.loaded_learn_nvim = true
require("learn").setup({})
