-- The git facts the review base needs: the default branch, a merge base, a
-- commit, and the files changed against the base.
local M = {}

---@param root string
---@param args string[]
---@return string? stdout trimmed
---@return string? err
local function git(root, args)
	local result = vim.system(vim.list_extend({ "git", "-C", root }, args), { text = true }):wait()
	if result.code ~= 0 then
		return nil, vim.trim(result.stderr or "") ~= "" and vim.trim(result.stderr) or ("git " .. table.concat(args, " ") .. " failed")
	end
	return vim.trim(result.stdout or ""), nil
end

---A full 40- or 64-hex commit id. Commits from review state go into Ex
---commands, so callers refuse anything else rather than escape it.
---@param value any
---@return boolean
function M.is_commit(value)
	return type(value) == "string" and (#value == 40 or #value == 64) and value:match("^[0-9a-f]+$") ~= nil
end

---origin's default branch when known, else main or master.
---@param root string
---@return string? ref
function M.default_branch(root)
	local head = git(root, { "symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD" })
	if head and head ~= "" then
		return head
	end
	for _, candidate in ipairs({ "main", "master" }) do
		if git(root, { "rev-parse", "--verify", "--quiet", candidate .. "^{commit}" }) then
			return candidate
		end
	end
	return nil
end

---@param root string
---@param ref string
---@return string? commit
---@return string? err
function M.commit(root, ref)
	if ref:sub(1, 1) == "-" then
		return nil, ref .. " is not a ref"
	end
	return git(root, { "rev-parse", "--verify", "--quiet", ref .. "^{commit}" })
end

---A review base for `ref` (default branch when nil) against the working tree or `target`.
---@param root string
---@param ref string?
---@param target string? a ref; nil or "worktree" for the working tree
---@return table? base
---@return string? err
function M.base(root, ref, target)
	ref = ref or M.default_branch(root)
	if not ref then
		return nil, "no default branch found; name a ref"
	end
	local head = "HEAD"
	local base_target = { kind = "worktree" }
	if target and target ~= "worktree" then
		local commit, err = M.commit(root, target)
		if not commit then
			return nil, err or (target .. " is not a commit")
		end
		head = commit
		base_target = { kind = "commit", commit = commit }
	end
	local ref_commit, ref_err = M.commit(root, ref)
	if not ref_commit then
		return nil, ref_err or (ref .. " is not a commit")
	end
	local merge_base, merge_err = git(root, { "merge-base", ref_commit, head })
	if not merge_base then
		return nil, merge_err
	end
	return { ref = ref, mergeBase = merge_base, target = base_target }, nil
end

---Files changed against the base, untracked ones included for a working-tree target.
---@param root string
---@param base table
---@return string[]? files
---@return string? err
function M.changed_files(root, base)
	local args = { "diff", "--name-only", base.mergeBase }
	if base.target.kind == "commit" then
		args = { "diff", "--name-only", base.mergeBase, base.target.commit }
	end
	local out, err = git(root, args)
	if not out then
		return nil, err
	end
	local files = {}
	local seen = {}
	local function add(text)
		for _, file in ipairs(vim.split(text, "\n", { plain = true, trimempty = true })) do
			if not seen[file] then
				seen[file] = true
				table.insert(files, file)
			end
		end
	end
	add(out)
	if base.target.kind == "worktree" then
		add(git(root, { "ls-files", "--others", "--exclude-standard" }) or "")
	end
	table.sort(files)
	return files, nil
end

return M
