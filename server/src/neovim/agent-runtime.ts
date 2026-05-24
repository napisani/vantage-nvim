import type {
	AnnotateRangeParams,
	AnnotationResult,
	BaseRequestParams,
	ExplainSelectionParams,
	ExplanationResult,
	ReviewCurrentHunkParams,
	ReviewResult,
} from './protocol';

export type AgentRuntimeResult<T> = T | Promise<T>;

export interface AgentRuntimeRequestContext {
	signal?: AbortSignal;
}

export interface AgentRuntime {
	explainSelection(params: ExplainSelectionParams, context?: AgentRuntimeRequestContext): AgentRuntimeResult<ExplanationResult>;
	annotateRange(params: AnnotateRangeParams, context?: AgentRuntimeRequestContext): AgentRuntimeResult<AnnotationResult>;
	reviewCurrentHunk(params: ReviewCurrentHunkParams, context?: AgentRuntimeRequestContext): AgentRuntimeResult<ReviewResult>;
	agentSessionReset(params: BaseRequestParams, context?: AgentRuntimeRequestContext): AgentRuntimeResult<ExplanationResult>;
	agentSessionStatus(params: BaseRequestParams, context?: AgentRuntimeRequestContext): AgentRuntimeResult<ExplanationResult>;
}
