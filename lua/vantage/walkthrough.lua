-- A walkthrough from review state: one quickfix entry per stop, with the stop's
-- note drawn above its line whenever the file is open.
local annotations = require("vantage.annotations")
local paths = require("vantage.paths")

local M = {}

local AUGROUP = "vantage_walkthrough"

-- Stops grouped by normalized absolute file path. Populated by M.load, consumed
-- lazily by the BufEnter autocmd and cleared by M.disarm.
local registry = {}
local armed = false
local loaded = nil

local function annotations_for(stops)
	local built = {}
	for _, stop in ipairs(stops) do
		table.insert(built, {
			range = { startLine = stop.line, startCharacter = 1, endLine = stop.line, endCharacter = 1 },
			text = stop.description,
		})
	end
	return built
end

local function render_buffer(bufnr)
	if not vim.api.nvim_buf_is_loaded(bufnr) then
		return
	end
	local key = paths.normalize(vim.api.nvim_buf_get_name(bufnr))
	local entry = key ~= "" and registry[key] or nil
	if entry then
		annotations.render(bufnr, annotations_for(entry.stops))
	end
end

local function arm()
	local group = vim.api.nvim_create_augroup(AUGROUP, { clear = true })
	vim.api.nvim_create_autocmd("BufEnter", {
		group = group,
		callback = function(args)
			render_buffer(args.buf)
		end,
	})
	armed = true
end

-- Drop the registry and the BufEnter hook. Existing extmarks are left to the
-- shared annotation clear so a single clear command covers both features.
function M.disarm()
	registry = {}
	loaded = nil
	if armed then
		pcall(vim.api.nvim_del_augroup_by_name, AUGROUP)
		armed = false
	end
end

---Loads a published walkthrough into quickfix and arms note rendering.
---@param tour table a walkthrough from review state
---@param root string workspace root its paths are relative to
---@param opts { open?: boolean }? open the quickfix window and go to the first stop
function M.load(tour, root, opts)
	opts = opts or {}
	M.disarm()
	local items = {}
	for _, stop in ipairs(tour.stops) do
		local filename = paths.resolve(root, stop.ref.path)
		local key = paths.normalize(filename)
		registry[key] = registry[key] or { stops = {} }
		local description = stop.title .. ": " .. stop.note
		table.insert(registry[key].stops, { line = stop.ref.startLine, description = description })
		table.insert(items, { filename = filename, lnum = stop.ref.startLine, end_lnum = stop.ref.endLine, col = 1, text = description })
	end
	vim.fn.setqflist({}, "r", { title = "Vantage walkthrough: " .. tour.title, items = items })
	loaded = { id = tour.id, index = 0, count = #items }
	arm()
	for _, bufnr in ipairs(vim.api.nvim_list_bufs()) do
		render_buffer(bufnr)
	end
	if opts.open then
		vim.cmd("copen")
		M.go(1)
	end
end

---@return string? tour_id the loaded walkthrough
function M.loaded()
	return loaded and loaded.id or nil
end

---Goes to stop `index` through quickfix, so :cnext and friends stay in step.
---@param index integer
---@return boolean moved
function M.go(index)
	if not loaded or index < 1 or index > loaded.count then
		vim.notify("Vantage: end of walkthrough", vim.log.levels.INFO)
		return false
	end
	loaded.index = index
	local ok = pcall(vim.cmd, "cc " .. index)
	return ok
end

function M.next()
	if loaded then
		M.go(loaded.index + 1)
	end
end

function M.prev()
	if loaded then
		M.go(loaded.index - 1)
	end
end

return M
