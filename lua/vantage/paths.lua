local M = {}

-- Resolve a (possibly workspace-relative) file path to the path nvim should
-- open. Absolute paths are returned unchanged; relative paths are joined to the
-- workspace root when one is known. Shared by quickfix-producing commands.
function M.resolve(workspace_root, file_path)
	file_path = file_path or ""
	if file_path:sub(1, 1) == "/" or file_path:match("^%a:[/\\]") then
		return file_path
	end
	if workspace_root and workspace_root ~= "" then
		return workspace_root .. "/" .. file_path
	end
	return file_path
end

-- Normalize a path for stable comparison against buffer names.
function M.normalize(path)
	if not path or path == "" then
		return ""
	end
	local resolved = vim.loop.fs_realpath(path) or vim.fn.fnamemodify(path, ":p")
	return (resolved:gsub("/+$", ""))
end

local function parent(dir)
	local up = vim.fn.fnamemodify(dir, ":h")
	if up ~= "/" then
		up = up:gsub("/+$", "")
	end
	return up
end

---The git root above `start_dir`, else the cwd, canonicalized. It must equal
---the Pi agent's canonical cwd for the agent's socket to be found.
---@param start_dir string?
---@return string
function M.workspace_root(start_dir)
	if not start_dir then
		local name = vim.api.nvim_buf_get_name(0)
		local ok, scheme = pcall(string.match, name, "^(%a[%w+.-]*)://")
		start_dir = (name ~= "" and not (ok and scheme)) and vim.fn.fnamemodify(name, ":p:h") or vim.fn.getcwd()
	end
	local dir = M.normalize(start_dir)
	while dir ~= "" do
		local git = dir .. (dir == "/" and "" or "/") .. ".git"
		if vim.fn.isdirectory(git) == 1 or vim.fn.filereadable(git) == 1 then
			return dir
		end
		local up = parent(dir)
		if up == dir then
			break
		end
		dir = up
	end
	return M.normalize(vim.fn.getcwd())
end

---`path` relative to `root`, or nil when it lies outside it.
---@param root string
---@param path string
---@return string?
function M.relative(root, path)
	local absolute = M.normalize(path)
	if absolute == root then
		return nil
	end
	local prefix = root == "/" and "/" or root .. "/"
	if absolute:sub(1, #prefix) == prefix then
		return absolute:sub(#prefix + 1)
	end
	return nil
end

return M
