-- Turns inline command text or the prompt float into the text sent to the
-- agent. References like @path and /skill:name pass through as typed.
local prompt_buffer = require("vantage.ui.prompt_buffer")

local M = {}

local function trim(text)
	return (text or ""):gsub("^%s+", ""):gsub("%s+$", "")
end

function M.command_text(opts)
	local text = trim(opts and opts.args or "")
	if text:match("%S") == nil then
		return nil
	end
	return text
end

---Uses the command's inline text when present, else opens the prompt float.
---@param opts { kind: string, command_opts?: table, params?: table, title?: string, default?: string, on_submit: fun(text: string) }
---@return boolean inline whether the inline text was used
function M.resolve(opts)
	opts = opts or {}
	local text = M.command_text(opts.command_opts)
	if text then
		-- Inline args bypass the prompt buffer entirely, so this is the only place
		-- that path can be recorded. Excluding it would make history mysteriously
		-- miss the prompts typed fastest.
		pcall(require("vantage.history").record, {
			kind = opts.kind,
			text = text,
			submitted = true,
			workspaceRoot = (opts.params or {}).workspaceRoot,
			filePath = (opts.params or {}).filePath,
		})
		opts.on_submit(text)
		return true
	end

	local _, win = prompt_buffer.open({
		kind = opts.kind or "prompt",
		params = opts.params or {},
		title = opts.title,
		on_submit = function(input)
			local submitted = M.command_text({ args = input })
			if submitted then
				opts.on_submit(submitted)
			end
		end,
	})
	if opts.default and opts.default ~= "" and win and vim.api.nvim_win_is_valid(win) then
		vim.api.nvim_buf_set_lines(vim.api.nvim_win_get_buf(win), 0, -1, false, vim.split(opts.default, "\n", { plain = true }))
	end
	return false
end

return M
