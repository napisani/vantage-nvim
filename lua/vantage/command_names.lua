local CommandNames = {
	set_lens = "VantageSetLens",
	clear_lens = "VantageClearLens",
	explain = "VantageExplain",
	question = "VantageQuestion",
	edit = "VantageEdit",
	annotate = "VantageAnnotate",
	annotation_clear = "VantageAnnotationClear",
	status = "VantageStatus",
	session_output = "VantageSessionOutput",
	search = "VantageSearch",
	agent_cancel = "VantageAgentCancel",
	agent_reset = "VantageAgentReset",
}

CommandNames.all = {
	CommandNames.set_lens,
	CommandNames.clear_lens,
	CommandNames.explain,
	CommandNames.question,
	CommandNames.edit,
	CommandNames.annotate,
	CommandNames.annotation_clear,
	CommandNames.status,
	CommandNames.session_output,
	CommandNames.search,
	CommandNames.agent_cancel,
	CommandNames.agent_reset,
}

return CommandNames
