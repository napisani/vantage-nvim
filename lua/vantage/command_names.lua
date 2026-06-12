local CommandNames = {
	set_lens = "VantageSetLens",
	clear_lens = "VantageClearLens",
	explain = "VantageExplain",
	question = "VantageQuestion",
	edit = "VantageEdit",
	annotate = "VantageAnnotate",
	annotation_clear = "VantageAnnotationClear",
	annotation_status = "VantageAnnotationStatus",
	context_status = "VantageContextStatus",
	search = "VantageSearch",
	agent_cancel = "VantageAgentCancel",
	agent_reset = "VantageAgentReset",
	agent_status = "VantageAgentStatus",
}

CommandNames.all = {
	CommandNames.set_lens,
	CommandNames.clear_lens,
	CommandNames.explain,
	CommandNames.question,
	CommandNames.edit,
	CommandNames.annotate,
	CommandNames.annotation_clear,
	CommandNames.annotation_status,
	CommandNames.context_status,
	CommandNames.search,
	CommandNames.agent_cancel,
	CommandNames.agent_reset,
	CommandNames.agent_status,
}

return CommandNames
