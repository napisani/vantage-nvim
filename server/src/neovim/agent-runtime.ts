import type {
	AnnotateRangeParams,
	AnnotationResult,
	BaseRequestParams,
	EditResult,
	EditSelectionParams,
	ExplainSelectionParams,
	ExplanationResult,
	QuestionSelectionParams,
	ReviewCurrentHunkParams,
	ReviewResult,
	AgentRuntimeProgress,
} from './protocol';

export type AgentRuntimeResult<T> = T | Promise<T>;

export interface AgentRuntimeRequestContext {
	signal?: AbortSignal;
	reportProgress?: (progress: AgentRuntimeProgress) => void;
}

export interface AgentRuntime {
	explainSelection(params: ExplainSelectionParams, context?: AgentRuntimeRequestContext): AgentRuntimeResult<ExplanationResult>;
	questionSelection(params: QuestionSelectionParams, context?: AgentRuntimeRequestContext): AgentRuntimeResult<ExplanationResult>;
	editSelection(params: EditSelectionParams, context?: AgentRuntimeRequestContext): AgentRuntimeResult<EditResult>;
	annotateRange(params: AnnotateRangeParams, context?: AgentRuntimeRequestContext): AgentRuntimeResult<AnnotationResult>;
	reviewCurrentHunk(params: ReviewCurrentHunkParams, context?: AgentRuntimeRequestContext): AgentRuntimeResult<ReviewResult>;
	agentSessionReset(params: BaseRequestParams, context?: AgentRuntimeRequestContext): AgentRuntimeResult<ExplanationResult>;
	agentSessionStatus(params: BaseRequestParams, context?: AgentRuntimeRequestContext): AgentRuntimeResult<ExplanationResult>;
}
