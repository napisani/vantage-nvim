local root = vim.fn.getcwd()
vim.opt.updatecount = 0
vim.opt.runtimepath:prepend(root)
package.path = root .. "/?.lua;" .. root .. "/?/init.lua;" .. root .. "/nvim/tests/?.lua;" .. package.path
