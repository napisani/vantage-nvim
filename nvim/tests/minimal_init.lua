local root = vim.fn.getcwd()
vim.fn.mkdir(root .. "/.nvim-dev/state/nvim", "p")
vim.env.XDG_STATE_HOME = root .. "/.nvim-dev/state"
vim.env.NVIM_LOG_FILE = root .. "/.nvim-dev/state/nvim/test.log"
vim.opt.updatecount = 0
vim.opt.shadafile = "NONE"
vim.opt.runtimepath:prepend(root)
package.path = root .. "/?.lua;" .. root .. "/?/init.lua;" .. root .. "/nvim/tests/?.lua;" .. package.path
