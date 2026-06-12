local M = {}

function M.add(value, bonus)
	local total = value + bonus
	return total
end

function M.total_score(items)
	local total = 0
	for _, item in ipairs(items) do
		total = M.add(total, item.points)
	end
	return total
end

return M
