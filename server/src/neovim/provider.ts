import type {
	AnnotateRangeParams,
	AnnotationResult,
	ExplainSelectionParams,
	ExplanationResult,
	ReviewCurrentHunkParams,
	ReviewResult,
} from './protocol';

export type ProviderResult<T> = T | Promise<T>;

export interface ProviderRequestContext {
	signal?: AbortSignal;
}

export interface BackendProvider {
	explainSelection(params: ExplainSelectionParams, context?: ProviderRequestContext): ProviderResult<ExplanationResult>;
	annotateRange(params: AnnotateRangeParams, context?: ProviderRequestContext): ProviderResult<AnnotationResult>;
	reviewCurrentHunk(params: ReviewCurrentHunkParams, context?: ProviderRequestContext): ProviderResult<ReviewResult>;
}
