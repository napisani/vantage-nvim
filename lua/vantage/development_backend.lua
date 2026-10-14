local M = {}

local function title_case(value)
	local text = value or "text"
	return text:gsub("^%l", string.upper)
end

function M.response(method, params)
	params = params or {}

	if method == "explainSelection" then
		local language = title_case(params.language)
		local lens = params.lens and params.lens.text or "No learning lens set."
		local selected_code = params.selectedText or params.text or ""
		local context_summary = params.contextSummary or "Visible editor context."
		if params.agentContext then
			local truncated = params.agentContext.truncated and ", truncated" or ""
			context_summary = "Agent context: "
				.. tostring(params.agentContext.path or "unknown")
				.. " ("
				.. tostring(#(params.agentContext.content or ""))
				.. " chars"
				.. truncated
				.. ")"
		end

		return {
			kind = "explanation",
			markdown = table.concat({
				"## Explanation",
				"",
				"Development agent runtime response for **" .. language .. "**.",
				"",
				"Lens: " .. lens,
				"",
				"```" .. (params.language or ""),
				selected_code,
				"```",
				"",
				"Context: " .. context_summary,
			}, "\n"),
		}
	end

	if method == "questionSelection" then
		return {
			kind = "explanation",
			markdown = table.concat({
				"## Answer",
				"",
				"Development agent runtime response for **" .. title_case(params.language) .. "**.",
				"",
				"Question: " .. tostring(params.question or ""),
				"",
				"```" .. (params.language or ""),
				params.selectedText or params.text or "",
				"```",
			}, "\n"),
		}
	end

	if method == "editSelection" then
		return {
			kind = "edit",
			replacementText = params.scopeText or params.selectedText or params.text or "",
		}
	end

	if method == "annotateRange" then
		local start_line = 0
		if params.visibleRange and params.visibleRange.startLine then
			start_line = params.visibleRange.startLine
		end

		return {
			kind = "annotations",
			annotations = {
				{
					text = "Development annotation.",
					detailMarkdown = "## Annotation\n\nDevelopment annotation detail.",
					severity = "info",
					range = {
						startLine = start_line,
						startCharacter = 0,
						endLine = start_line,
						endCharacter = 0,
					},
				},
			},
		}
	end

	if method == "searchLocations" then
		return {
			kind = "locations",
			locations = {
				{
					filePath = params.filePath or "",
					startLine = params.range and params.range.startLine or params.cursor and params.cursor.line or 1,
					startCharacter = params.range and params.range.startCharacter or params.cursor and params.cursor.character or 1,
					explanation = "Development search result for: " .. tostring(params.query or ""),
				},
			},
		}
	end

	if method == "generateWalkthrough" then
		local root = params.workspaceRoot or vim.fn.getcwd()
		local relative_file = params.filePath or ""
		if root ~= "" and relative_file:sub(1, #root + 1) == root .. "/" then
			relative_file = relative_file:sub(#root + 2)
		end
		local line = params.cursor and params.cursor.line or 1

		vim.fn.mkdir(root .. "/.vantage", "p")
		local walkthrough_path = root .. "/.vantage/walkthrough.json"
		vim.fn.writefile({
			vim.json.encode({
				version = 1,
				pointers = {
					{
						file = relative_file,
						line = line,
						description = "Development walkthrough result for: " .. tostring(params.prompt or ""),
					},
				},
			}),
		}, walkthrough_path)

		return {
			kind = "walkthrough",
			path = walkthrough_path,
			pointerCount = 1,
		}
	end

	if method == "generateDiffTour" then
		local root = params.workspaceRoot or vim.fn.getcwd()
		local base = params.base or "HEAD"
		local target = params.target or "WORKTREE"
		local function git(args)
			local command = { "git", "-C", root }
			vim.list_extend(command, args)
			local result = vim.fn.systemlist(command)
			if vim.v.shell_error ~= 0 then error("Vantage development diff tour: Git comparison unavailable") end
			return result
		end
		local base_hash = git({ "rev-parse", "--verify", "--end-of-options", base .. "^{commit}" })[1]
		local target_hash = target ~= "WORKTREE" and git({ "rev-parse", "--verify", "--end-of-options", target .. "^{commit}" })[1] or nil
		local rev_arg = target_hash and base_hash .. ".." .. target_hash or base_hash
		local file = git({ "diff", "--name-only", "--diff-filter=AM", rev_arg, "--" })[1]
		if not file then error("Vantage development diff tour: no tracked text changes") end
		local lines = target_hash and git({ "show", target_hash .. ":" .. file }) or vim.fn.readfile(root .. "/" .. file)
		local artifact = {
			version = 1,
			comparison = { vcs = "git", repoRoot = ".", base = { label = base, commit = base_hash },
				target = target_hash and { kind = "commit", label = target, commit = target_hash }
					or { kind = "worktree", headAtAuthoring = git({ "rev-parse", "HEAD" })[1] } },
			points = { { file = file, side = "right", line = 1, anchor = lines[1] or "",
				description = "Development diff tour: " .. params.prompt } },
		}
		vim.fn.mkdir(root .. "/.vantage", "p")
		local tour_path = root .. "/.vantage/diff-tour.json"
		vim.fn.writefile({ vim.json.encode(artifact) }, tour_path)
		return { kind = "diffTour", path = tour_path, pointCount = 1, changedFileCount = 1, inspectedFileCount = 1 }
	end

	if method == "agentCancel" then
		return {
			kind = "explanation",
			markdown = "## Vantage Agent\n\nDevelopment agent runtime cancel.",
		}
	end

	if method == "agentSessionReset" then
		return {
			kind = "explanation",
			markdown = "## Vantage Agent Session\n\nDevelopment agent runtime session reset.",
		}
	end

	if method == "agentSessionStatus" then
		return {
			kind = "explanation",
			markdown = "## Vantage Agent Session\n\nDevelopment agent runtime session status.\n\nTurn count: 0",
		}
	end

	if method == "agentSessionOutput" then
		return {
			kind = "explanation",
			markdown = "## Vantage Session Output\n\n### development · completed\n\nDevelopment backend session output.",
		}
	end

	if method == "listSkills" then
		return {
			kind = "skills",
			skills = {
				{
					name = "development-skill",
					description = "Development backend placeholder skill.",
					filePath = "/development/SKILL.md",
					source = "development",
				},
			},
		}
	end

	if method == "complete" then
		local prompt = params.prompt or ""
		return {
			kind = "completion",
			text = "Development completion response for: " .. prompt,
		}
	end

	return {
		kind = "error",
		markdown = "## Error\n\nUnknown development backend method: " .. tostring(method),
	}
end

return M
