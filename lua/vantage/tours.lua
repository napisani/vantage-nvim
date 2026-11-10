-- Which published tour is active, and one pair of next/prev keys for both
-- kinds. Requested tours load when they arrive; ones the agent publishes on its
-- own only announce themselves until you navigate.
local diff_tour = require("vantage.diff_tour")
local review = require("vantage.review")
local walkthrough = require("vantage.walkthrough")

local M = {}

local active = nil

local function root()
	return review.connection().root or review.workspace_root()
end

---@return table? tour the tour being navigated
function M.active()
	return active and review.tour(active) or nil
end

---@param tour table
---@param opts { open?: boolean }?
function M.load(tour, opts)
	active = tour.id
	if tour.kind == "walkthrough" then
		walkthrough.load(tour, root(), opts)
	else
		diff_tour.load(tour, root())
	end
end

local function latest()
	local current = review.state()
	local tours = current and current.tours or {}
	return tours[#tours]
end

local function ensure_active()
	local tour = M.active()
	if tour and (walkthrough.loaded() == tour.id or diff_tour.loaded() == tour.id) then
		return tour, false
	end
	tour = tour or latest()
	if not tour then
		vim.notify("Vantage: no tour yet; request one with :VantageWalkthrough or :VantageDiffTour", vim.log.levels.INFO)
		return nil, false
	end
	M.load(tour, { open = true })
	return tour, true
end

function M.next()
	local tour, fresh = ensure_active()
	if not tour or fresh then
		return
	end
	if tour.kind == "walkthrough" then
		walkthrough.next()
	else
		diff_tour.next()
	end
end

function M.prev()
	local tour, fresh = ensure_active()
	if not tour or fresh then
		return
	end
	if tour.kind == "walkthrough" then
		walkthrough.prev()
	else
		diff_tour.prev()
	end
end

---Clears the active tour's marks here and drops the tours from review state.
function M.clear()
	active = nil
	walkthrough.disarm()
	require("vantage.annotations").clear_all()
	diff_tour.clear()
	review.clear_tours(nil, function(err)
		if err then
			vim.notify("Vantage: " .. err, vim.log.levels.WARN)
		end
	end)
end

local group = vim.api.nvim_create_augroup("vantage_tours", { clear = true })
vim.api.nvim_create_autocmd("User", {
	group = group,
	pattern = "VantageTourPublished",
	callback = function(args)
		local data = args.data or {}
		local tour = review.tour(data.tour_id)
		if not tour then
			return
		end
		local label = tour.kind == "walkthrough" and "walkthrough" or "diff tour"
		if data.unrequested then
			active = tour.id
			vim.notify(string.format('Vantage: new %s from the agent, "%s" (tour next to start)', label, tour.title), vim.log.levels.INFO)
			return
		end
		vim.notify(string.format('Vantage: %s "%s" ready, %d stops', label, tour.title, #tour.stops), vim.log.levels.INFO)
		M.load(tour, { open = true })
	end,
})

return M
