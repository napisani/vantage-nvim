local CommandNames = {
	set_lens = "VantageSetLens",
	clear_lens = "VantageClearLens",
	ask = "VantageAsk",
	explain = "VantageExplain",
	request = "VantageRequest",
	request_now = "VantageRequestNow",
	send_round = "VantageSendRound",
	recall_round = "VantageRecallRound",
	reply = "VantageReply",
	cancel = "VantageCancel",
	resolve = "VantageResolve",
	clear_resolved = "VantageClearResolved",
	thread_peek = "VantageThreadPeek",
	thread_open = "VantageThreadOpen",
	thread_next = "VantageThreadNext",
	thread_prev = "VantageThreadPrev",
	thread_quickfix = "VantageThreadQuickfix",
	threads = "VantageThreads",
	sidebar = "VantageSidebar",
	walkthrough = "VantageWalkthrough",
	diff_tour = "VantageDiffTour",
	tour_next = "VantageTourNext",
	tour_prev = "VantageTourPrev",
	tour_clear = "VantageTourClear",
	review_base = "VantageReviewBase",
	review_base_clear = "VantageReviewBaseClear",
	review_files = "VantageReviewFiles",
	annotate = "VantageAnnotate",
	annotation_clear = "VantageAnnotationClear",
	connect = "VantageConnect",
	status = "VantageStatus",
	health = "VantageHealth",
	debug_log = "VantageDebugLog",
	compose = "VantageCompose",
	compose_send = "VantageComposeSend",
	compose_clear = "VantageComposeClear",
	history = "VantageHistory",
	history_clear_workspace = "VantageHistoryClearWorkspace",
	history_clear_all = "VantageHistoryClearAll",
	monitor = "VantageMonitor",
}

CommandNames.all = {}
for _, name in pairs(CommandNames) do
	if type(name) == "string" then
		table.insert(CommandNames.all, name)
	end
end
table.sort(CommandNames.all)

return CommandNames
