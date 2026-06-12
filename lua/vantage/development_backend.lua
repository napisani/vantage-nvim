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
			replacementText = params.selectedText or params.text or "",
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

	return {
		kind = "error",
		markdown = "## Error\n\nUnknown development backend method: " .. tostring(method),
	}
end

return M
