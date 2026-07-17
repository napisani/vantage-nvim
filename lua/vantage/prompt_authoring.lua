local prompt_buffer = require("vantage.prompt_buffer")

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

function M.resolve(opts)
	opts = opts or {}
	local text = M.command_text(opts.command_opts)
	if text then
		opts.on_submit(text)
		return true
	end

	prompt_buffer.open({
		kind = opts.kind or "prompt",
		params = opts.params or {},
		on_submit = function(input)
			local submitted = M.command_text({ args = input })
			if not submitted then
				if opts.empty_message then
					vim.notify(opts.empty_message, vim.log.levels.WARN)
				end
				return
			end
			opts.on_submit(submitted)
		end,
	})
	return false
end

return M
