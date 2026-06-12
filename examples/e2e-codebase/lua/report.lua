local calculator = require("lua.calculator")

local M = {}

function M.build_report(items)
	local score = calculator.total_score(items)
	return {
		title = "Weekly score",
		score = score,
	}
end

return M
